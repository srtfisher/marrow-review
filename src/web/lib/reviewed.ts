/** When each pull request was reviewed in this session, keyed by `pullKey`. */
export type Reviewed = ReadonlyMap<string, number>;

// GitHub's search index, which answers review-requested:@me, lags a submitted
// review by up to a minute or so; past this the search is trusted again, so a
// re-requested review shows up.
export const REVIEWED_GRACE_MS = 5 * 60_000;

export const pullKey = (owner: string, repo: string, number: number): string => `${owner}/${repo}#${number}`;

/** Drops pull requests reviewed within the grace period from a review-request list. */
export function withoutReviewed<T extends { number: number }>(
  pulls: T[],
  where: (p: T) => { owner: string; repo: string },
  reviewed: Reviewed,
  now: number = Date.now(),
): T[] {
  if (reviewed.size === 0) return pulls;
  return pulls.filter((p) => {
    const { owner, repo } = where(p);
    const at = reviewed.get(pullKey(owner, repo, p.number));
    return at === undefined || now - at >= REVIEWED_GRACE_MS;
  });
}
