import type { LineRow } from './rows.js';

/** First row of the next (dir 1) or previous (dir -1) file, from the row at `index`. */
export function stepFile(rows: LineRow[], index: number, dir: 1 | -1): number {
  if (rows.length === 0) return -1;
  const here = rows[Math.max(0, index)];
  const fileOf = (r: LineRow) => `${r.sectionKey}:${r.fileIndex}`;
  if (dir === 1) {
    for (let i = Math.max(0, index) + 1; i < rows.length; i += 1) if (!here || fileOf(rows[i]!) !== fileOf(here)) return i;
    return index;
  }
  // Back to the start of this file first, then to the start of the previous one.
  let i = Math.max(0, index);
  const startOf = (j: number) => { let k = j; while (k > 0 && fileOf(rows[k - 1]!) === fileOf(rows[j]!)) k -= 1; return k; };
  const start = startOf(i);
  if (start < i) return start;
  if (start === 0) return 0;
  i = startOf(start - 1);
  return i;
}

export function stepSection(rows: LineRow[], index: number, dir: 1 | -1): number {
  if (rows.length === 0) return -1;
  const section = rows[Math.max(0, index)]?.sectionKey;
  if (dir === 1) {
    for (let i = index + 1; i < rows.length; i += 1) if (rows[i]!.sectionKey !== section) return i;
    return index;
  }
  let i = Math.max(0, index);
  while (i > 0 && rows[i - 1]!.sectionKey === section) i -= 1;
  if (i < index) return i;
  if (i === 0) return 0;
  const prev = rows[i - 1]!.sectionKey;
  while (i > 0 && rows[i - 1]!.sectionKey === prev) i -= 1;
  return i;
}

/** The next row (in `dir`) that carries something, wrapping around. -1 when nothing does. */
export function stepMarked(rows: LineRow[], index: number, marked: ReadonlySet<string>, dir: 1 | -1): number {
  const n = rows.length;
  for (let step = 1; step <= n; step += 1) {
    const i = (((index + dir * step) % n) + n) % n;
    if (marked.has(rows[i]!.key)) return i;
  }
  return -1;
}
