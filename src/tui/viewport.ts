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
 * Row offset of every item, plus the total as a final element — so
 * `offsets[i]` is where item `i` starts and `offsets[i + 1]` is where it ends.
 *
 * Items in the detail pane are not one row each: a file header is 1, a hunk is
 * its header plus every line, a finding card is several. Slicing by index
 * against a budget expressed in rows is what let the pane emit seven screens'
 * worth of output into one screen's worth of space.
 */
export function rowOffsets(heights: readonly number[]): number[] {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i += 1) {
    offsets[i + 1] = offsets[i]! + Math.max(0, heights[i]!);
  }
  return offsets;
}

/** Largest index whose offset is still at or below `row`. */
function indexAtOrBefore(offsets: number[], row: number): number {
  let found = 0;
  for (let i = 0; i < offsets.length - 1; i += 1) {
    if (offsets[i]! <= row) found = i;
    else break;
  }
  return found;
}

/** Smallest index whose offset is at or after `row`. */
function indexAtOrAfter(offsets: number[], row: number): number {
  for (let i = 0; i < offsets.length - 1; i += 1) {
    if (offsets[i]! >= row) return i;
  }
  return Math.max(0, offsets.length - 2);
}

/** The item occupying `row`, clamped to the ends. */
export function indexAtRow(heights: readonly number[], row: number): number {
  if (heights.length === 0) return 0;
  return indexAtOrBefore(rowOffsets(heights), Math.max(0, row));
}

/** First index from which everything remaining fits in one screen. */
function lastStartIndex(offsets: number[], height: number): number {
  const total = offsets.at(-1) ?? 0;
  for (let i = 0; i < offsets.length - 1; i += 1) {
    if (total - offsets[i]! <= height) return i;
  }
  return Math.max(0, offsets.length - 2);
}

/**
 * The item slice that fits `height` ROWS starting at row `scrollTop`.
 *
 * Whole items only: half a hunk at the top of the pane reads as a rendering
 * bug, not as scrolling. One item is always emitted even when it alone exceeds
 * the budget, because a blank pane you cannot scroll out of is worse than an
 * overlong one — `Viewport` clips that case rather than letting it push the
 * status bar off screen.
 */
export function computeRowWindow(
  heights: readonly number[],
  height: number,
  scrollTop: number,
): Window {
  if (heights.length === 0) return { start: 0, end: 0 };

  const offsets = rowOffsets(heights);
  const usableHeight = Math.max(0, height);
  const start = indexAtOrBefore(offsets, Math.max(0, scrollTop));

  let end = start;
  let used = 0;
  while (end < heights.length && used + Math.max(0, heights[end]!) <= usableHeight) {
    used += Math.max(0, heights[end]!);
    end += 1;
  }

  return { start, end: Math.max(end, start + 1) };
}

/**
 * `nextScrollTop` in row space: the cursor is still an item index, but the
 * budget, the margin, and the returned offset are all rows, so `ctrl-d` moves a
 * real half-page rather than half a page's worth of items.
 *
 * The result is always an item boundary, and always one from which the cursor's
 * own item is visible.
 */
export function nextRowScrollTop(
  heights: readonly number[],
  height: number,
  cursor: number,
  scrollTop: number,
  margin = 3,
): number {
  if (heights.length === 0) return 0;

  const offsets = rowOffsets(heights);
  const total = offsets.at(-1) ?? 0;
  const usableHeight = Math.max(0, height);
  if (total <= usableHeight) return 0;

  const maxStart = lastStartIndex(offsets, usableHeight);
  const index = clamp(cursor, 0, heights.length - 1);
  const top = offsets[index]!;
  const bottom = Math.max(top, offsets[index + 1]! - 1);

  const effectiveMargin = Math.min(margin, Math.max(0, Math.floor((usableHeight - 1) / 2)));

  let row = clamp(scrollTop, 0, offsets[maxStart]!);
  let scrollingUp = false;
  if (top - effectiveMargin < row) {
    row = Math.max(0, top - effectiveMargin);
    scrollingUp = true;
  } else if (bottom + effectiveMargin > row + usableHeight - 1) {
    row = bottom + effectiveMargin - usableHeight + 1;
  }

  // Scrolling up snaps back to the item containing that row, which keeps the
  // margin as real context; scrolling down snaps forward, which is what stops
  // the window from starting mid-item and pushing the cursor off the bottom.
  let start = scrollingUp ? indexAtOrBefore(offsets, row) : indexAtOrAfter(offsets, row);
  start = Math.min(start, maxStart);
  if (start > index) start = index;
  // A tall neighbour can crowd the cursor's own item out of the window; walk
  // the start forward until it fits again.
  while (start < index && offsets[index + 1]! - offsets[start]! > usableHeight) start += 1;

  return offsets[start]!;
}

/**
 * Minimal scroll adjustment keeping the cursor at least `margin` rows from both
 * edges. Returns the current scrollTop unchanged when no adjustment is needed,
 * so the view stays still while the cursor moves within the comfortable band.
 *
 * Fixed-height items only — the pull-request list, whose entries are two rows
 * each. The detail pane uses `nextRowScrollTop`.
 */
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
