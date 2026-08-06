import type { PullFilter, PullRequestSummary } from '../core/github/types.js';
import { WORDMARK, WORDMARK_COLS } from './wordmark.js';

/**
 * Two rows, then the ellipsis. Unreadable titles were the complaint that
 * killed the sidebar; unbounded ones would make the list unscannable in the
 * other direction — a title that needs three rows is a title being read, not
 * chosen from.
 */
export const MAX_TITLE_ROWS = 2;

/** Marker column (2) plus the continuation indent the renderer uses. */
const TITLE_INDENT = 6;

/** Banner block: the three wordmark rows, the tagline, a blank under them. */
const BANNER_ROWS = WORDMARK.length + 2;
/** The filter input line and the blank row under it. */
const FILTER_ROWS = 2;
/** The position indicator's row, reserved whether or not it shows —
 *  a row that arrives unbudgeted pushes the status bar off the screen. */
const INDICATOR_ROWS = 1;
/** The banner earns its five rows only while the list stays the point. */
const MIN_ENTRIES_BESIDE_BANNER = 3;
const MIN_ENTRY_ROWS = 3;

export interface PickerEntry {
  pr: PullRequestSummary;
  /** 1..MAX_TITLE_ROWS rendered rows; the last ends in '…' when cut. */
  titleLines: string[];
  /** titleLines plus the meta row plus the trailing blank. */
  height: number;
}

/**
 * Greedy word wrap into at most `maxLines` rows of `width` cells. The wrap is
 * computed here, not left to Ink: the row budget, the scroll math, and the hit
 * test all count these rows, and Ink wrapping on its own would break all three.
 */
export function wrapTitle(text: string, width: number, maxLines: number): string[] {
  const w = Math.max(1, width);
  const lines: string[] = [];
  let rest = text.trim();

  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= w) {
      lines.push(rest);
      rest = '';
      break;
    }
    // Last allotted line and still more text: cut to fit with the ellipsis.
    if (lines.length === maxLines - 1) {
      lines.push(`${rest.slice(0, w - 1).trimEnd()}…`);
      rest = '';
      break;
    }
    const slice = rest.slice(0, w + 1);
    const breakAt = slice.lastIndexOf(' ');
    // No space to break on: a single word longer than the width hard-breaks
    // rather than overflowing the row.
    const cut = breakAt > 0 ? breakAt : w;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  return lines.length > 0 ? lines : [''];
}

export function buildEntries(prs: PullRequestSummary[], width: number): PickerEntry[] {
  const titleWidth = Math.max(1, width - TITLE_INDENT);
  return prs.map((pr) => {
    const text = `#${pr.number} ${pr.isDraft ? '[draft] ' : ''}${pr.title}`;
    const titleLines = wrapTitle(text, titleWidth, MAX_TITLE_ROWS);
    return { pr, titleLines, height: titleLines.length + 2 };
  });
}

export interface PickerLayout {
  banner: boolean;
  /** Rows above the first entry: banner block if shown, then the filter block. */
  headerRows: number;
  /** Rows the entries may draw in. */
  entryRows: number;
}

export function layoutPicker(height: number, width: number): PickerLayout {
  const wide = width >= WORDMARK_COLS + 2;
  const withBanner = height - BANNER_ROWS - FILTER_ROWS - INDICATOR_ROWS;
  const banner = wide && withBanner >= MIN_ENTRIES_BESIDE_BANNER * MIN_ENTRY_ROWS;
  const headerRows = (banner ? BANNER_ROWS : 0) + FILTER_ROWS;
  return { banner, headerRows, entryRows: Math.max(0, height - headerRows - INDICATOR_ROWS) };
}

/**
 * The first entry shown, adjusted so the cursor's entry is fully visible.
 * Entries are 3 or 4 rows tall, so this walks heights instead of dividing —
 * the fixed-height shortcut is exactly how the renderer and the scroll math
 * would come to disagree by a row.
 */
export function pickerScroll(
  heights: number[], viewRows: number, cursor: number, scrollTop: number,
): number {
  const last = heights.length - 1;
  let top = Math.min(Math.max(0, scrollTop), Math.max(0, last));
  const at = Math.min(Math.max(0, cursor), Math.max(0, last));

  if (at < top) return at;
  let used = 0;
  for (let i = at; i >= top; i -= 1) used += heights[i] ?? 0;
  while (used > viewRows && top < at) {
    used -= heights[top] ?? 0;
    top += 1;
  }
  return top;
}

/** Entries [start, end) that fit in `viewRows` from `scrollTop`. */
export function pickerWindow(
  heights: number[], viewRows: number, scrollTop: number,
): { start: number; end: number } {
  const start = Math.min(Math.max(0, scrollTop), Math.max(0, heights.length - 1));
  let used = 0;
  let end = start;
  while (end < heights.length) {
    used += heights[end] ?? 0;
    // At least one entry always shows; a viewport shorter than one entry
    // clips rather than blanking the list entirely.
    if (used > viewRows && end > start) break;
    end += 1;
    if (used >= viewRows) break;
  }
  return { start, end: Math.max(end, start + (heights.length > 0 ? 1 : 0)) };
}

export interface PickerGeometry {
  headerRows: number;
  heights: number[];
  scrollTop: number;
  viewRows: number;
}

/**
 * The entry a click landed on, or null for chrome. The trailing blank of each
 * entry is a separator, not the entry — clicking the air between two pull
 * requests must not aim at either of them.
 */
export function hitPicker(geometry: PickerGeometry, row: number): number | null {
  const { headerRows, heights, scrollTop, viewRows } = geometry;
  if (row < headerRows) return null;

  const { start, end } = pickerWindow(heights, viewRows, scrollTop);
  let offset = row - headerRows;
  if (offset >= viewRows) return null;

  for (let i = start; i < end; i += 1) {
    const height = heights[i] ?? 0;
    if (offset < height) return offset < height - 1 ? i : null;
    offset -= height;
  }
  return null;
}

export function nextFilter(filter: PullFilter): PullFilter {
  if (filter === 'open') return 'review-requested';
  if (filter === 'review-requested') return 'all';
  return 'open';
}
