export interface Window {
  start: number;
  /** Exclusive. */
  end: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Largest valid scrollTop: the offset that puts the last row at the bottom. */
function maxScrollTop(total: number, height: number): number {
  return Math.max(0, total - height);
}

export function computeWindow(
  total: number,
  height: number,
  _cursor: number,
  scrollTop: number,
): Window {
  const usableHeight = Math.max(0, height);
  const start = clamp(scrollTop, 0, maxScrollTop(total, usableHeight));
  const end = Math.min(total, start + usableHeight);
  return { start, end };
}

/**
 * Minimal scroll adjustment keeping the cursor at least `margin` rows from both
 * edges. Returns the current scrollTop unchanged when no adjustment is needed,
 * so the view stays still while the cursor moves within the comfortable band.
 *
 * Both panes measure in the same unit as their cursor: the pull-request list in
 * entries, the detail pane in rows.
 *
 * The detail pane used to window on whole units instead — a file header, a
 * whole hunk — and that rule could not hold. A single hunk of a thousand lines
 * is one unit, so a forty-row pane obeying "whole units only" showed either
 * that hunk alone or, at the top of a diff where the first unit is a one-row
 * file header that fits while the hunk after it does not, one row of content
 * and thirty-nine blank. That was the bug where opening a large pull request
 * rendered a single file path into an empty screen. Rows have no such failure
 * mode, and half a hunk at the top of the pane is what every pager has always
 * done.
 */
/**
 * Scrolls the window by `delta` rows and brings the cursor along.
 *
 * The wheel scrolls the view, which is what a wheel does everywhere else. But
 * the cursor is not a decoration here — `C` comments on the line it is pointing
 * at — so a view that scrolls out from under it would leave the reviewer able to
 * comment on a line they cannot see. It is dragged to the nearest visible row
 * instead, and left alone while it is already in view.
 *
 * Distinct from `nextScrollTop`, which is the other direction: there the cursor
 * moves and the view follows.
 */
export function scrollBy(
  total: number,
  height: number,
  cursor: number,
  scrollTop: number,
  delta: number,
): { scrollTop: number; cursor: number } {
  const usableHeight = Math.max(0, height);

  // Nothing on screen to scroll, and no row to put a cursor on. Banking an
  // offset here would jump the view the moment the pane had a row again.
  if (total === 0 || usableHeight === 0) return { scrollTop, cursor };

  const limit = maxScrollTop(total, usableHeight);
  const next = clamp(scrollTop + delta, 0, limit);

  return {
    scrollTop: next,
    cursor: clamp(cursor, next, Math.min(total - 1, next + usableHeight - 1)),
  };
}

/**
 * The offset that puts `row` on the pane's first line.
 *
 * The counterpart to `nextScrollTop`, which moves the view as little as it can.
 * Arriving at a file is the case where least movement is the wrong answer: a
 * header parked three rows off the bottom edge is a file you have been taken to
 * and cannot read. Clamped, so the last file in the diff stops where the diff
 * stops rather than scrolling its tail up into blank rows.
 */
export function scrollToRow(total: number, height: number, row: number): number {
  return clamp(row, 0, maxScrollTop(total, Math.max(0, height)));
}

export function nextScrollTop(
  total: number,
  height: number,
  cursor: number,
  scrollTop: number,
  margin = 3,
): number {
  const usableHeight = Math.max(0, height);
  const limit = maxScrollTop(total, usableHeight);
  if (limit === 0) return 0;

  // A margin cannot exceed what the height can accommodate on both sides.
  const effectiveMargin = Math.min(margin, Math.max(0, Math.floor((usableHeight - 1) / 2)));

  let next = clamp(scrollTop, 0, limit);
  const topBound = next + effectiveMargin;
  const bottomBound = next + usableHeight - 1 - effectiveMargin;

  if (cursor < topBound) next = cursor - effectiveMargin;
  else if (cursor > bottomBound) next = cursor - usableHeight + 1 + effectiveMargin;

  return clamp(next, 0, limit);
}
