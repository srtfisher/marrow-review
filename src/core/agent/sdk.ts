import { accessSync, constants } from 'node:fs';
import { describeToolUse, isRead } from './progress.js';
import {
  createSdkMcpServer,
  query,
  tool,
  USAGE_LIMIT_ERROR_PREFIXES,
  USAGE_WARNING_PREFIXES,
  type McpServerConfig,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { MARROW_VERSION } from '../version.js';
import {
  AGENT_TOOL_SERVER, AgentRunError, EMPTY_USAGE, type AgentRequest, type AgentRun, type AgentTool,
  type AgentTransport, type UsageSummary,
} from './types.js';

/**
 * Builds the environment for the Claude Code subprocess.
 *
 * Claude Code resolves credentials ANTHROPIC_API_KEY -> ANTHROPIC_AUTH_TOKEN ->
 * OAuth profile. A stray key in the shell would silently move every review onto
 * metered API billing, so both are removed unless the user explicitly opts in.
 */
export function buildSubprocessEnv(
  source: NodeJS.ProcessEnv,
  useApiKey: boolean,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...source,
    CLAUDE_AGENT_SDK_CLIENT_APP: `marrow/${MARROW_VERSION}`,
  };

  if (!useApiKey) {
    env.ANTHROPIC_API_KEY = undefined;
    env.ANTHROPIC_AUTH_TOKEN = undefined;
  }

  return env;
}

function matchUsageNotice(text: string): string | null {
  for (const prefix of [...USAGE_LIMIT_ERROR_PREFIXES, ...USAGE_WARNING_PREFIXES]) {
    if (text.startsWith(prefix)) return text;
  }
  return null;
}

const SCHEMA_REJECTION = /^Output does not match required schema: (.+)$/;

/** The shape of the SDK's `query`, narrowed to what this transport calls. */
export type QueryFn = (args: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface SdkTransportOptions {
  useApiKey?: boolean;
  env?: NodeJS.ProcessEnv;
  /** A Claude Code on the machine, used instead of the SDK's bundled binary. */
  claudePath?: string | null;
  /** Injectable for tests; production always uses the SDK's own `query`. */
  query?: QueryFn;
}

/**
 * DO NOT REMOVE `settingSources: []`, and do not "restore CLAUDE.md loading" by
 * relaxing it.
 *
 * `cwd` here is a git worktree checked out at the PULL REQUEST'S HEAD — content
 * the pull request's author controls. When `settingSources` is omitted the SDK
 * loads every source the CLI would, including `'project'`, which reads
 * `.claude/settings.json` relative to `cwd`. That file can define **hooks**, and
 * hooks are shell commands rather than tools, so `disallowedTools` never sees
 * them: reviewing a malicious pull request would run the author's shell commands
 * on the reviewer's machine.
 *
 * The cost is real and accepted — this repository's own CLAUDE.md no longer
 * reaches the agent. We are reading untrusted code; that is the correct trade.
 */
const ISOLATED_SETTINGS: Options['settingSources'] = [];

function toolServer(tools: AgentTool[]): McpServerConfig {
  return createSdkMcpServer({
    name: AGENT_TOOL_SERVER,
    tools: tools.map((t) => {
      const shape = Object.fromEntries(
        Object.entries(t.params).map(([key, p]) => [
          key,
          (p.type === 'string' ? z.string() : z.array(z.string())).describe(p.description),
        ]),
      );
      return tool(t.name, t.description, shape, async (args) => {
        // A thrown handler would end the whole run; the model can recover from
        // an error it is told about, so it is told.
        try {
          const text = await t.handler(args as Record<string, string | string[]>);
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true };
        }
      });
    }),
  });
}

export function buildQueryOptions(
  req: AgentRequest,
  env: Record<string, string | undefined>,
  claudePath: string | null = null,
): Options {
  return {
    ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
    ...(req.tools && req.tools.length > 0
      ? { mcpServers: { [AGENT_TOOL_SERVER]: toolServer(req.tools) } }
      : {}),
    model: req.model,
    cwd: req.cwd,
    systemPrompt: req.systemPrompt,
    allowedTools: req.allowedTools,
    disallowedTools: req.disallowedTools,
    maxTurns: req.maxTurns,
    ...(req.effort ? { effort: req.effort } : {}),
    resume: req.resume,
    env,
    settingSources: ISOLATED_SETTINGS,
    ...(req.schema
      ? { outputFormat: { type: 'json_schema' as const, schema: req.schema } }
      : {}),
  };
}

export class SdkTransport implements AgentTransport {
  private readonly env: Record<string, string | undefined>;
  private readonly query: QueryFn;
  private readonly claudePath: string | null;

  constructor(options: SdkTransportOptions = {}) {
    this.env = buildSubprocessEnv(options.env ?? process.env, options.useApiKey === true);
    this.query = options.query ?? query;
    this.claudePath = options.claudePath ?? null;
  }

  async run(req: AgentRequest): Promise<AgentRun> {
    // Checked here rather than left to the SDK, whose "not found" reads as a
    // broken install of marrow; this one is the user's to install.
    if (this.claudePath) {
      try {
        accessSync(this.claudePath, constants.X_OK);
      } catch {
        throw new Error(`Claude Code is not installed at ${this.claudePath}.`);
      }
    }
    const stream = this.query({
      prompt: req.prompt,
      options: buildQueryOptions(req, this.env, this.claudePath),
    });

    let text = '';
    let structured: unknown = null;
    let sessionId = '';
    let usageWarning: string | null = null;
    // The CLI rejects bad structured output inside the conversation and ends
    // with only a subtype, so the last rejection is the only record of why.
    let schemaRejection: string | null = null;
    let usage: UsageSummary = EMPTY_USAGE;
    let turns = 0;
    let reads = 0;

    for await (const message of stream) {
      if (message.type === 'assistant') {
        turns += 1;
        for (const block of message.message.content) {
          if (block.type === 'tool_use' && req.onProgress) {
            if (isRead(block.name)) reads += 1;
            req.onProgress({ turns, reads, activity: describeToolUse(block.name, block.input as Record<string, unknown>, req.cwd) });
          }
          if (block.type === 'text') {
            text += block.text;
            const notice = matchUsageNotice(block.text);
            if (notice) usageWarning = notice;
          }
        }
        continue;
      }

      if (message.type === 'user' && Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if (block.type !== 'tool_result' || typeof block.content !== 'string') continue;
          const match = SCHEMA_REJECTION.exec(block.content);
          if (match?.[1]) schemaRejection = match[1];
        }
        continue;
      }

      if (message.type === 'result') {
        sessionId = message.session_id;
        usage = {
          inputTokens: message.usage?.input_tokens ?? 0,
          outputTokens: message.usage?.output_tokens ?? 0,
          cacheReadTokens: message.usage?.cache_read_input_tokens ?? 0,
          cacheCreationTokens: message.usage?.cache_creation_input_tokens ?? 0,
          costUsd: message.total_cost_usd ?? 0,
          durationMs: message.duration_ms ?? 0,
          numTurns: message.num_turns ?? 0,
        };
        if (message.subtype === 'success') {
          structured = message.structured_output ?? null;
          if (text.length === 0) text = message.result;
        } else {
          const why = schemaRejection ? ` (${schemaRejection})` : '';
          throw new AgentRunError(`Agent run failed: ${message.subtype}${why}`, usage);
        }
      }
    }

    if (req.schema && structured === null) {
      throw new AgentRunError('Agent returned no structured output despite a schema being set.', usage);
    }

    return { text, structured, sessionId, usage, usageWarning };
  }
}
