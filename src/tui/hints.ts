import type { DetailRow } from './rows.js';

export interface Hint {
  keys: string;
  label: string;
  /** Used when the full label will not fit. Falls back to `label`. */
  short?: string;
}

/** Rendered as `keys label`, joined by three spaces. */
const GAP = 3;

function widthOf(hints: readonly Hint[]): number {
  return hints.reduce(
    (sum, h, i) => sum + (i > 0 ? GAP : 0) + h.keys.length + 1 + h.label.length,
    0,
  );
}

/**
 * The widest set of hints that fits, degrading from the back.
 *
 * Back-first is the whole point. The hints are in priority order, and the
 * leading ones are the contextual verbs — `C comment on this line` is the one
 * that told a reviewer line-level comments exist at all, so it keeps its full
 * wording until every hint behind it has already given up its own.
 *
 * The last hint always survives: it is `?`, the way out of not knowing any of
 * the others, and plain truncation ate it first. Nothing is ever cut mid-word —
 * a bar ending in `! appro…` is worse than a bar with one hint fewer.
 */
export function fitHints(hints: readonly Hint[], width: number): Hint[] {
  if (hints.length === 0) return [];

  const fitted = hints.map((h) => ({ keys: h.keys, label: h.label }));

  for (let i = fitted.length - 1; i >= 0 && widthOf(fitted) > width; i -= 1) {
    fitted[i]!.label = hints[i]!.short ?? hints[i]!.label;
  }

  // Still over: drop whole hints from the back, keeping `?`.
  const last = fitted[fitted.length - 1]!;
  while (fitted.length > 1 && widthOf(fitted) > width) {
    fitted.splice(fitted.length - 2, 1);
  }
  return widthOf(fitted) > width ? [last] : fitted;
}

/**
 * What the reviewer can do right now, in the order they are likely to want it.
 *
 * Deliberately short. A bar listing twenty keys is a help screen pinned to the
 * bottom of the window, and gets read exactly as often as one — which is never.
 * Six or so verbs, changing with the cursor, is a bar people actually read.
 * `?` is always last because it is the way out of not knowing.
 */
export function listHints(): Hint[] {
  return [
    { keys: '↑↓', label: 'move' },
    { keys: '⏎', label: 'review this one', short: 'review' },
    { keys: '/', label: 'search' },
    { keys: '1 2 3', label: 'filter' },
    { keys: 'q', label: 'quit' },
    { keys: '?', label: 'all keys', short: 'keys' },
  ];
}

export function detailHints(row: DetailRow | undefined, fullDiff: boolean): Hint[] {
  const hints: Hint[] = [{ keys: '↑↓', label: 'move' }];

  if (row?.kind === 'finding') {
    // Triage first: a finding under the cursor is a decision waiting to be made,
    // and the reviewer came here to make it.
    hints.push(
      { keys: 'a', label: 'accept' },
      { keys: 'x', label: 'drop' },
      { keys: 'e', label: 'rewrite' },
    );
  } else {
    // Naming the line is the point: the cursor is on one, and `C` used to
    // comment on the hunk instead, which is not what the reviewer meant.
    hints.push(
      { keys: 'C', label: 'comment on this line', short: 'comment' },
      { keys: 'S', label: 'suggest' },
    );
  }

  // Ordered so that what degrades away first matters least: `fitHints` drops
  // from the back, and losing `d` costs a view toggle while losing `!` would
  // cost the reviewer the only visible way to approve.
  hints.push(
    { keys: ']', label: 'next file', short: 'file' },
    { keys: '!', label: 'approve / request changes', short: 'approve' },
    { keys: 'm', label: 'mark reviewed', short: 'reviewed' },
    { keys: 'd', label: fullDiff ? 'meat only' : 'full diff', short: fullDiff ? 'meat' : 'full' },
    { keys: '?', label: 'all keys', short: 'keys' },
  );

  return hints;
}
