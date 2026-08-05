import type { CheckConclusion, CheckRun, ReviewThread } from './types.js';

export type GraphQlFn = (
  query: string,
  vars: Record<string, unknown>,
) => Promise<unknown>;

export interface PullContext {
  threads: ReviewThread[];
  checks: CheckRun[];
  /** Non-null when the viewer already has an unsubmitted review from the web UI. */
  viewerPendingReviewId: string | null;
}

export const PULL_CONTEXT_QUERY = `
query PullContext($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          path
          line
          isResolved
          isOutdated
          comments(first: 50) {
            nodes { author { login } body createdAt }
          }
        }
      }
      reviews(first: 20, states: [PENDING]) { nodes { id state } }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    name status conclusion detailsUrl
                    summary: title
                  }
                  ... on StatusContext {
                    context state targetUrl
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

function lower(value: unknown): string | null {
  return typeof value === 'string' ? value.toLowerCase() : null;
}

/**
 * GraphQL `CheckConclusionState` mapped onto our union. STARTUP_FAILURE and the
 * legacy StatusContext ERROR state both collapse to `failure`: they are not
 * members of the union, and a check that a caller cannot recognize as failing is
 * a check whose failure is hidden. STALE means superseded, not failed.
 */
const CONCLUSIONS: Record<string, CheckConclusion> = {
  success: 'success',
  failure: 'failure',
  error: 'failure',
  startup_failure: 'failure',
  timed_out: 'timed_out',
  cancelled: 'cancelled',
  action_required: 'action_required',
  neutral: 'neutral',
  skipped: 'skipped',
  stale: 'neutral',
  // Legacy commit statuses that have not concluded yet.
  pending: null,
  expected: null,
};

function toConclusion(value: unknown): CheckConclusion {
  const raw = lower(value);
  if (raw === null) return null;
  const mapped = CONCLUSIONS[raw];
  // An unrecognized conclusion is reported as a failure rather than swallowed:
  // over-reporting costs a glance, under-reporting hides a broken build.
  return mapped === undefined ? 'failure' : mapped;
}

/** A legacy commit status has no status field; its state implies one. */
function statusFromState(value: unknown): string {
  const raw = lower(value);
  return raw === 'pending' || raw === 'expected' ? raw : 'completed';
}

function toCheck(node: Record<string, unknown>): CheckRun | null {
  if (node['__typename'] === 'CheckRun') {
    return {
      name: String(node['name'] ?? 'check'),
      status: lower(node['status']) ?? 'unknown',
      conclusion: toConclusion(node['conclusion']),
      detailsUrl: (node['detailsUrl'] as string | null) ?? null,
      output: (node['summary'] as string | null) ?? null,
    };
  }
  if (node['__typename'] === 'StatusContext') {
    return {
      name: String(node['context'] ?? 'status'),
      status: statusFromState(node['state']),
      conclusion: toConclusion(node['state']),
      detailsUrl: (node['targetUrl'] as string | null) ?? null,
      output: null,
    };
  }
  return null;
}

export async function fetchPullContext(
  graphql: GraphQlFn,
  owner: string,
  repo: string,
  number: number,
): Promise<PullContext> {
  const raw = (await graphql(PULL_CONTEXT_QUERY, { owner, repo, number })) as {
    repository?: {
      pullRequest?: {
        reviewThreads?: { nodes?: unknown[] };
        reviews?: { nodes?: { id: string }[] };
        commits?: { nodes?: { commit?: { statusCheckRollup?: { contexts?: { nodes?: unknown[] } } } }[] };
      };
    };
  };

  const pr = raw.repository?.pullRequest;

  const threads: ReviewThread[] = (pr?.reviewThreads?.nodes ?? []).map((n) => {
    const node = n as Record<string, unknown>;
    const comments = (node['comments'] as { nodes?: unknown[] } | undefined)?.nodes ?? [];
    return {
      path: String(node['path'] ?? ''),
      line: typeof node['line'] === 'number' ? node['line'] : null,
      isResolved: node['isResolved'] === true,
      isOutdated: node['isOutdated'] === true,
      comments: comments.map((c) => {
        const comment = c as Record<string, unknown>;
        const author = comment['author'] as { login?: string } | null;
        return {
          author: author?.login ?? 'unknown',
          body: String(comment['body'] ?? ''),
          createdAt: String(comment['createdAt'] ?? ''),
        };
      }),
    };
  });

  const contexts =
    pr?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const checks = contexts
    .map((c) => toCheck(c as Record<string, unknown>))
    .filter((c): c is CheckRun => c !== null);

  return {
    threads,
    checks,
    viewerPendingReviewId: pr?.reviews?.nodes?.[0]?.id ?? null,
  };
}
