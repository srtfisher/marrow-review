export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
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
