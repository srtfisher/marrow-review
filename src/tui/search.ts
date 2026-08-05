import type { PullRequestSummary } from '../core/github/types.js';

/**
 * Case-insensitive substring match across title, author, and number.
 * Deliberately not fuzzy: when scanning a team's pull requests, a predictable
 * substring is easier to steer than a ranker that reshuffles as you type.
 */
export function matchesQuery(pr: PullRequestSummary, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (q.length === 0) return true;
  return (
    pr.title.toLowerCase().includes(q) ||
    pr.author.toLowerCase().includes(q) ||
    String(pr.number).includes(q)
  );
}

export function filterPrs(
  prs: PullRequestSummary[],
  query: string,
): PullRequestSummary[] {
  return prs.filter((pr) => matchesQuery(pr, query));
}
