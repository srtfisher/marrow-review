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
