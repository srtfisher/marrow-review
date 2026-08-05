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

function toCheck(node: Record<string, unknown>): CheckRun | null {
  if (node['__typename'] === 'CheckRun') {
    return {
      name: String(node['name'] ?? 'check'),
      status: lower(node['status']) ?? 'unknown',
      conclusion: lower(node['conclusion']) as CheckConclusion,
      detailsUrl: (node['detailsUrl'] as string | null) ?? null,
      output: (node['summary'] as string | null) ?? null,
    };
  }
  if (node['__typename'] === 'StatusContext') {
    return {
      name: String(node['context'] ?? 'status'),
      status: 'completed',
      conclusion: lower(node['state']) as CheckConclusion,
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
