import type { GitHubStatus } from './status.js';

/** What a failed GitHub call looked like, in terms a reviewer can act on. */
export interface GitHubFailure {
  /** The best message available; never blank. */
  message: string;
  /** The HTTP status, or null when no response arrived. */
  status: number | null;
  /** GitHub's x-github-request-id, worth quoting to GitHub support. */
  requestId: string | null;
  /** True when GitHub itself, or the way to it, is failing: worth checking its status page. */
  onGitHubsSide: boolean;
}

/**
 * Octokit takes its message from the response body, which GitHub sometimes sends
 * empty, and reports a request that never got a response as a fake HTTP 500 whose
 * message comes from a cause that can be blank too (Node's AggregateError).
 */
export function describeGitHubError(error: unknown): GitHubFailure {
  const e = (error ?? {}) as { status?: unknown; response?: { status?: unknown; headers?: Record<string, unknown> }; cause?: unknown };
  const responded = typeof e.response?.status === 'number';
  const status = responded ? (e.response!.status as number) : typeof e.status === 'number' && e.status !== 500 ? e.status : null;
  const header = e.response?.headers?.['x-github-request-id'];
  const requestId = typeof header === 'string' ? header : null;
  const own = error instanceof Error ? error.message.trim() : typeof error === 'string' ? error.trim() : '';
  const cause = describeCause(e.cause);
  // Octokit always sets a numeric status; anything else is marrow's own failure, not GitHub's.
  const fromRequest = responded || typeof e.status === 'number';

  let message: string;
  if (fromRequest && !responded && cause) message = `Could not reach GitHub (${own && own !== cause ? `${own}: ` : ''}${cause}).`;
  else if (own) message = own;
  else if (fromRequest && status !== null) message = `GitHub answered HTTP ${status} without saying why.`;
  else message = fromRequest ? 'The request to GitHub failed without an error message.' : 'Failed without an error message.';

  return { message, status, requestId, onGitHubsSide: fromRequest && (status === null || status >= 500 || status === 429) };
}

function describeCause(cause: unknown, depth = 0): string {
  if (!(cause instanceof Error) || depth > 4) return '';
  const own = cause as Error & { code?: unknown; errors?: unknown };
  const parts = [own.message.trim() || cause.name, typeof own.code === 'string' ? own.code : ''];
  if (Array.isArray(own.errors)) parts.push(...own.errors.map((x) => describeCause(x, depth + 1)));
  parts.push(describeCause(cause.cause, depth + 1));
  return [...new Set(parts.filter(Boolean))].join(': ');
}

/** A failed GitHub call, carrying what the page needs to explain it. */
export class GitHubError extends Error {
  readonly failure: GitHubFailure;
  constructor(error: unknown) {
    const failure = describeGitHubError(error);
    super(failure.message, { cause: error });
    this.failure = failure;
  }
}

/** What the page shows beside a GitHub failure: the failure, plus GitHub's own account when it is GitHub's fault. */
export interface GitHubProblem extends GitHubFailure {
  /** githubstatus.com at the time of the failure; null when not asked or unreachable. */
  report: GitHubStatus | null;
}

export async function explainGitHubFailure(
  failure: GitHubFailure,
  status: () => Promise<GitHubStatus | null>,
): Promise<GitHubProblem> {
  return { ...failure, report: failure.onGitHubsSide ? await status() : null };
}
