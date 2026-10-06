import type { AgentProgress } from './progress.js';
export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** The SDK's API-equivalent estimate; a subscription is not billed per token. */
  costUsd: number;
  durationMs: number;
  numTurns: number;
}

export const EMPTY_USAGE: UsageSummary = {
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, durationMs: 0, numTurns: 0,
};

/** A run that failed after spending tokens; the spend is still worth counting. */
export class AgentRunError extends Error {
  constructor(message: string, readonly usage: UsageSummary) {
    super(message);
  }
}

export interface AgentRequest {
  prompt: string;
  systemPrompt?: string;
  /** Model alias, e.g. 'opus' or 'sonnet'. */
  model: string;
  /** Working directory the agent's file tools are scoped to. */
  cwd?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  /** JSON Schema. When set, the run must return structured output. */
  schema?: Record<string, unknown>;
  /** Session id to resume, for follow-up turns. */
  resume?: string;
  maxTurns?: number;
  /**
   * How hard the model reasons. Left unset, the SDK uses 'high', which spends
   * most of a short structured answer's tokens on thinking.
   */
  effort?: 'low' | 'medium' | 'high';
  /**
   * In-process tools served to this run only. Their names reach the model as
   * `toolName(name)`, which is also what `allowedTools` must list to permit them.
   */
  tools?: AgentTool[];
  /** Called as the run's tool calls arrive, so a long pass can say what it is doing. */
  onProgress?: (progress: AgentProgress) => void;
}

export interface AgentToolParam {
  type: 'string' | 'string[]';
  description: string;
}

/**
 * A read-only capability handed to one run — reading a file through the GitHub
 * API, or fetching hunks by id. Deliberately narrow: every parameter is a
 * string or a list of strings, and the answer is text.
 */
export interface AgentTool {
  name: string;
  description: string;
  params: Record<string, AgentToolParam>;
  handler(args: Record<string, string | string[]>): Promise<string>;
}

export const AGENT_TOOL_SERVER = 'marrow';

/** The name the model and `allowedTools` see for an in-process tool. */
export function toolName(name: string): string {
  return `mcp__${AGENT_TOOL_SERVER}__${name}`;
}

export interface AgentRun {
  text: string;
  /** Parsed structured output when a schema was supplied, else null. */
  structured: unknown;
  sessionId: string;
  usage: UsageSummary;
  /**
   * Set when the SDK reported a subscription usage warning or limit, so the UI
   * can surface it instead of failing opaquely.
   */
  usageWarning: string | null;
}

export interface AgentTransport {
  run(req: AgentRequest): Promise<AgentRun>;
}
