import type { LineRow } from './rows.js';
import type { Side } from './types.js';

export interface Anchor {
  path: string;
  side: Side;
  line: number;
  startLine: number | null;
}

export function anchorKey(path: string, side: Side, line: number): string {
  return `${path}|${side}|${line}`;
}

/**
 * The comment anchor for a selection between two rows. GitHub anchors a range
 * on one side, so the side is the end row's, and the range spans the selected
 * rows on that side. Null when the rows are in different files.
 */
export function rangeAnchor(rows: LineRow[], fromKey: string, toKey: string): Anchor | null {
  const a = rows.findIndex((r) => r.key === fromKey);
  const b = rows.findIndex((r) => r.key === toKey);
  if (a === -1 || b === -1) return null;
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const end = rows[b]!;
  const selected = rows.slice(lo, hi + 1);
  if (selected.some((r) => r.fileIndex !== end.fileIndex)) return null;
  const lines = selected.filter((r) => r.side === end.side).map((r) => r.number);
  const startLine = Math.min(...lines);
  const line = Math.max(...lines);
  return { path: end.path, side: end.side, line, startLine: startLine === line ? null : startLine };
}

/** The text a suggestion replaces: the new-side lines in the range. Null on the left, where GitHub has no suggestions. */
export function suggestionText(rows: LineRow[], anchor: Anchor): string | null {
  if (anchor.side === 'LEFT') return null;
  const from = anchor.startLine ?? anchor.line;
  return rows
    .filter((r) => r.path === anchor.path && r.side === 'RIGHT' && r.number >= from && r.number <= anchor.line)
    .map((r) => r.line.text)
    .join('\n');
}

/** Places anchored items under their rows; anything with no row on the page comes back unplaced. */
export function placeByRow<T extends { path: string; side?: Side; line: number | null }>(
  rows: LineRow[],
  items: T[],
): { byRow: Map<string, T[]>; unplaced: T[] } {
  const index = new Map<string, string>();
  for (const r of rows) index.set(anchorKey(r.path, r.side, r.number), r.key);
  const byRow = new Map<string, T[]>();
  const unplaced: T[] = [];
  for (const item of items) {
    const key = item.line === null ? undefined : index.get(anchorKey(item.path, item.side ?? 'RIGHT', item.line));
    if (!key) { unplaced.push(item); continue; }
    byRow.set(key, [...(byRow.get(key) ?? []), item]);
  }
  return { byRow, unplaced };
}
