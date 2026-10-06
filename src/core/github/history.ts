import type { GraphQlFn } from './graphql.js';

export interface HistoryCommit {
  sha: string;
  headline: string;
  author: string;
  date: string;
  pr: { number: number; title: string } | null;
}

export interface PriorComment {
  pr: number;
  author: string;
  body: string;
}

export interface FileHistory {
  path: string;
  commits: HistoryCommit[];
  /** Review comments on this same file in the pull requests those commits came from. */
  priorComments: PriorComment[];
}

export const HISTORY_FILES = 15;
const COMMITS_PER_FILE = 5;
const COMMENT_CHARS = 600;

export function buildHistoryQuery(count: number): string {
  const vars = Array.from({ length: count }, (_, i) => `$p${i}: String!`).join(', ');
  const fields = Array.from({ length: count }, (_, i) => `
        f${i}: history(first: ${COMMITS_PER_FILE}, path: $p${i}) {
          nodes {
            abbreviatedOid messageHeadline committedDate
            author { name user { login } }
            associatedPullRequests(first: 1) {
              nodes {
                number title
                reviewThreads(first: 20) {
                  nodes { path comments(first: 3) { nodes { body author { login } } } }
                }
              }
            }
          }
        }`).join('');
  return `
query FileHistory($owner: String!, $repo: String!, $oid: GitObjectID!, ${vars}) {
  repository(owner: $owner, name: $repo) {
    object(oid: $oid) {
      ... on Commit {${fields}
      }
    }
  }
}`;
}

type Node = Record<string, unknown>;
const nodes = (v: unknown): Node[] => ((v as { nodes?: Node[] } | null | undefined)?.nodes ?? []);

/**
 * Recent history of each changed file at the base commit, and what reviewers said about it
 * in the pull requests that history came from. One request for every file, so the history
 * and prior-comments reviewers cost GitHub one round trip and the model nothing to fetch.
 */
export async function fetchFileHistory(
  graphql: GraphQlFn,
  owner: string,
  repo: string,
  baseSha: string,
  paths: readonly string[],
  currentPr: number,
): Promise<FileHistory[]> {
  const chosen = paths.slice(0, HISTORY_FILES);
  if (chosen.length === 0 || !baseSha) return [];
  const vars: Record<string, unknown> = { owner, repo, oid: baseSha };
  chosen.forEach((p, i) => { vars[`p${i}`] = p; });
  const raw = (await graphql(buildHistoryQuery(chosen.length), vars)) as { repository?: { object?: Node | null } };
  const commitNode = raw.repository?.object ?? {};

  return chosen.map((path, i) => {
    const commits: HistoryCommit[] = [];
    const priorComments: PriorComment[] = [];
    const seen = new Set<string>();
    for (const c of nodes(commitNode[`f${i}`])) {
      const author = c['author'] as { name?: string; user?: { login?: string } | null } | null;
      const pr = nodes(c['associatedPullRequests'])[0];
      const number = typeof pr?.['number'] === 'number' ? pr['number'] : null;
      commits.push({
        sha: String(c['abbreviatedOid'] ?? ''),
        headline: String(c['messageHeadline'] ?? ''),
        author: author?.user?.login ?? author?.name ?? 'unknown',
        date: String(c['committedDate'] ?? '').slice(0, 10),
        pr: number !== null ? { number, title: String(pr?.['title'] ?? '') } : null,
      });
      if (number === null || number === currentPr) continue;
      for (const thread of nodes(pr?.['reviewThreads'])) {
        if (thread['path'] !== path) continue;
        for (const comment of nodes(thread['comments'])) {
          const body = String(comment['body'] ?? '').trim();
          const key = `${number}:${body}`;
          if (!body || seen.has(key)) continue;
          seen.add(key);
          const login = (comment['author'] as { login?: string } | null)?.login ?? 'unknown';
          priorComments.push({ pr: number, author: login, body: body.length > COMMENT_CHARS ? `${body.slice(0, COMMENT_CHARS)}…` : body });
        }
      }
    }
    return { path, commits, priorComments };
  });
}
