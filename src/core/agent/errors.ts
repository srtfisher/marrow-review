/**
 * Turns an agent failure into something a reviewer can act on.
 *
 * The model passes are additive, so a failure is never fatal — but "Model pass
 * failed — press R to retry" is advice that cannot work when Claude Code never
 * started, and a reviewer pressing R forever is worse served than one told to
 * reinstall. Hence `retryable`: the offer is made only when it means something.
 *
 * Claude Code is not a separate install. It ships with marrow as a platform
 * package of the agent SDK, so "not installed" here means an install that
 * skipped optional dependencies, or a platform the SDK has no binary for —
 * which is why the remedy is reinstalling marrow rather than installing Claude.
 */
export interface AgentFailure {
  /** One line, remedy first, for a note that may be truncated at the end. */
  summary: string;
  /** The failure's own words, for anywhere with room for them. */
  detail: string;
  /** False when the cause is structural and the same call will fail again. */
  retryable: boolean;
}

/**
 * The SDK's own wording when its bundled binary is absent or will not spawn.
 *
 * Loose about what sits between the noun and "not found" on purpose: the SDK
 * has said both "Claude Code native binary not found at <path>" and "Native CLI
 * binary for darwin-arm64 not found", and a pattern matching the exact phrase
 * of the day quietly stops matching on an SDK bump — degrading to the raw text,
 * which tells the reviewer to reinstall the SDK rather than marrow.
 */
const NOT_INSTALLED =
  /(binary|executable)[^.]{0,80}?not found|failed to launch|ENOENT|EACCES/i;

/** Claude Code exits rather than prompting, so this arrives as a message. */
const NOT_AUTHENTICATED =
  /not authenticated|not logged in|no credentials|invalid api key|authentication_error|unauthorized|\b401\b|please run \/login/i;

export function agentErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // A dead subprocess quotes its whole stderr; the first line names the fault.
  return text.split('\n')[0]?.trim() ?? '';
}

export function describeAgentFailure(error: unknown): AgentFailure {
  const detail = agentErrorMessage(error);

  if (NOT_INSTALLED.test(detail)) {
    return {
      summary: 'Claude Code could not start — reinstall marrow to restore it (npm install -g marrow-review).',
      detail,
      retryable: false,
    };
  }

  if (NOT_AUTHENTICATED.test(detail)) {
    return {
      summary: 'Claude Code could not authenticate — run `claude` once to sign in, or check ANTHROPIC_API_KEY (--use-api-key).',
      detail,
      retryable: false,
    };
  }

  // Unrecognised is the common case — a crash, a rate limit, a network blip —
  // and every one of those is worth another go. Guessing at a cause would be
  // worse than quoting the failure.
  return {
    summary: detail.length > 0 ? detail : 'The model pass failed without saying why.',
    detail,
    retryable: true,
  };
}
