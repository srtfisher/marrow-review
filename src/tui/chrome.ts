import type { PullFilter } from '../core/github/types.js';

/** Lowercase: the chrome row is ambient state, not a heading. */
export function chromeFilterLabel(filter: PullFilter): string {
  if (filter === 'review-requested') return 'needs my review';
  if (filter === 'all') return 'all';
  return 'open';
}

export interface ChromeLine { left: string; right: string }

/**
 * The one row that frames every settled screen: app, repository, filter on
 * the left; the warm review on the right. Fitting degrades in the order of
 * what a reviewer can most spare — the reminder first, the repository's name
 * second, the app's name never: an unlabelled full-screen program is exactly
 * the "stray text" the design system exists to prevent.
 */
export function chromeLine(opts: {
  repoLabel: string;
  filter: PullFilter;
  warm: number | null;
  width: number;
}): ChromeLine {
  const { repoLabel, filter, warm, width } = opts;
  const filterLabel = chromeFilterLabel(filter);
  const left = `marrow · ${repoLabel} · ${filterLabel}`;
  const right = warm === null ? '' : `reviewing #${warm}`;

  if (right !== '' && left.length + 1 + right.length <= width) return { left, right };
  if (left.length <= width) return { left, right: '' };

  const fixed = `marrow · `.length + ` · ${filterLabel}`.length;
  const room = Math.max(1, width - fixed);
  const cut = `${repoLabel.slice(0, Math.max(0, room - 1))}…`;
  return { left: `marrow · ${cut} · ${filterLabel}`, right: '' };
}
