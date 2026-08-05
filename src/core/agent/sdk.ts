import {
  query,
  USAGE_LIMIT_ERROR_PREFIXES,
  USAGE_WARNING_PREFIXES,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { MARROW_VERSION } from '../version.js';
import type { AgentRequest, AgentRun, AgentTransport } from './types.js';

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

/** The shape of the SDK's `query`, narrowed to what this transport calls. */
export type QueryFn = (args: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface SdkTransportOptions {
  useApiKey?: boolean;
  env?: NodeJS.ProcessEnv;
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

export function buildQueryOptions(
  req: AgentRequest,
  env: Record<string, string | undefined>,
): Options {
  return {
    model: req.model,
    cwd: req.cwd,
    systemPrompt: req.systemPrompt,
    allowedTools: req.allowedTools,
    disallowedTools: req.disallowedTools,
    maxTurns: req.maxTurns,
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

  constructor(options: SdkTransportOptions = {}) {
    this.env = buildSubprocessEnv(options.env ?? process.env, options.useApiKey === true);
    this.query = options.query ?? query;
  }

  async run(req: AgentRequest): Promise<AgentRun> {
    const stream = this.query({
      prompt: req.prompt,
      options: buildQueryOptions(req, this.env),
    });

    let text = '';
    let structured: unknown = null;
    let sessionId = '';
    let usageWarning: string | null = null;
    let usage: { inputTokens: number; outputTokens: number; numTurns: number } = {
      inputTokens: 0,
      outputTokens: 0,
      numTurns: 0,
    };

    for await (const message of stream) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            text += block.text;
            const notice = matchUsageNotice(block.text);
            if (notice) usageWarning = notice;
          }
        }
        continue;
      }

      if (message.type === 'result') {
        sessionId = message.session_id;
        if (message.subtype === 'success') {
          structured = message.structured_output ?? null;
          if (text.length === 0) text = message.result;
          usage = {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            numTurns: message.num_turns,
          };
        } else {
          throw new Error(`Agent run failed: ${message.subtype}`);
        }
      }
    }

    if (req.schema && structured === null) {
      throw new Error('Agent returned no structured output despite a schema being set.');
    }

    return { text, structured, sessionId, usage, usageWarning };
  }
}
