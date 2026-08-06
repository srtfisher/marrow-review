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
 * leading ones are the contextual verbs — `c comment on this line` is the one
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

export function detailHints(
  row: DetailRow | undefined,
  fullDiff: boolean,
  findingCount = 0,
): Hint[] {
  const hints: Hint[] = [{ keys: '↑↓', label: 'move' }];

  if (row?.kind === 'comment') {
    // Your own comment, sitting in the diff. What you can do to it is edit it
    // or take it back — authoring a second one on the same line is not it.
    hints.push(
      { keys: '⏎', label: 'edit this comment', short: 'edit' },
      { keys: 'x', label: 'delete' },
    );
  } else if (row?.kind === 'finding') {
    // Triage first: a finding under the cursor is a decision waiting to be made,
    // and the reviewer came here to make it.
    hints.push(
      { keys: 'a', label: 'accept' },
      { keys: 'x', label: 'drop' },
      { keys: 'e', label: 'rewrite' },
    );
  } else {
    // Naming the line is the point: the cursor is on one, and `c` used to
    // comment on the hunk instead, which is not what the reviewer meant.
    hints.push(
      { keys: 'c', label: 'comment on this line', short: 'comment' },
      { keys: 's', label: 'suggest' },
    );

    // Only worth offering when there is somewhere to go, and only away from a
    // finding — with the cursor already on one, the decision in front of the
    // reviewer outranks getting to the next one. `p` is not given its own hint:
    // it is `n` inverted, help documents it, and this bar earns its keep by
    // being short enough to read.
    if (findingCount > 0) hints.push({ keys: 'n', label: 'next finding', short: 'finding' });
  }

  // Ordered so that what degrades away first matters least: `fitHints` drops
  // from the back. `d` sits ahead of the rest because it is how a reviewer
  // learns the diff in front of them is abridged at all — losing that is worse
  // than losing `!`, which help and the submit screen both still name.
  hints.push(
    { keys: 'd', label: fullDiff ? 'meat only' : 'full diff', short: fullDiff ? 'meat' : 'full' },
    { keys: '!', label: 'approve / request changes', short: 'approve' },
    { keys: ']', label: 'next file', short: 'file' },
    { keys: 'm', label: 'mark reviewed', short: 'reviewed' },
    { keys: '?', label: 'all keys', short: 'keys' },
  );

  return hints;
}
