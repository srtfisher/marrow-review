import { theme } from './theme.js';

export interface FileIndexEntry {
  path: string;
  /** Cut by a file-level rule; still listed, because nothing is ever hidden. */
  dropped: boolean;
  /** The reviewer has been through it — the check in the index. */
  reviewed: boolean;
  current: boolean;
}

export interface FileIndexCell {
  entry: FileIndexEntry | null;
  /** `▸` or a space. */
  cursor: string;
  /** `✓` or a space. Rendered green — it is the reviewer's own progress. */
  check: string;
  /** Path, truncated and padded so a row is a plain concatenation. */
  label: string;
  /** The three parts joined; what the row actually occupies. */
  text: string;
}

export interface FileIndex {
  grid: FileIndexCell[][];
  columns: number;
  cellWidth: number;
  /** Files the cap left out. Named in the overflow cell — never silent. */
  hidden: number;
}

/** `▸` for the current file, `✓` for a reviewed one, then a space. */
const MARK_WIDTH = 3;

/** Below this a name is unreadable however it is truncated, so use fewer columns. */
const MIN_USEFUL_CELL = 28;

export function fileIndexColumns(width: number): number {
  return Math.max(1, Math.min(4, Math.floor(width / MIN_USEFUL_CELL)));
}

/**
 * Keeps the tail. A path is identified by its filename far more than by its
 * root, and every file in a monorepo pull request shares the first two
 * segments — truncating the other end would produce a column of `packages/al…`.
 */
export function truncatePath(path: string, width: number): string {
  if (width <= 0) return '';
  if (path.length <= width) return path;
  if (width === 1) return '…';
  return `…${path.slice(-(width - 1))}`;
}

/**
 * What to call each file in the index.
 *
 * Full paths do not work here. In a monorepo change they run to eighty
 * characters, which forces the grid down to one column and seventeen rows —
 * a header taller than the diff — and truncating them to fit produces
 * `…08-04-package-inertia-pages-and…`, which identifies nothing.
 *
 * So: the file name, which is what anyone actually calls a file. A name shared
 * by more than one file in the pull request — `index.tsx` twice — gets its
 * parent directory back, and only those do, because disambiguating files that
 * were never ambiguous just makes every label longer.
 */
export function indexLabels(paths: readonly string[]): string[] {
  const basenames = paths.map((p) => p.slice(p.lastIndexOf('/') + 1));
  const counts = new Map<string, number>();
  for (const name of basenames) counts.set(name, (counts.get(name) ?? 0) + 1);

  return paths.map((path, i) => {
    const name = basenames[i]!;
    if ((counts.get(name) ?? 0) < 2) return name;
    const cut = path.lastIndexOf('/');
    if (cut < 0) return name;
    const parent = path.slice(0, cut);
    return `${parent.slice(parent.lastIndexOf('/') + 1)}/${name}`;
  });
}

/**
 * Lays every file out as a grid that fits `width`.
 *
 * All of them: the index is the reviewer's map of the pull request, and a map
 * that omits the file you are looking for is worse than no map. Only a pull
 * request past `maxRows` worth of columns is capped, and then the overflow cell
 * says how many it dropped.
 */
export function layoutFileIndex(
  entries: readonly FileIndexEntry[],
  width: number,
  maxRows = 8,
): FileIndex {
  const columns = fileIndexColumns(width);
  const cellWidth = Math.max(MARK_WIDTH + 1, Math.floor(width / columns));
  const capacity = Math.max(1, columns * maxRows);

  const overflowing = entries.length > capacity;
  const shown = overflowing ? entries.slice(0, capacity - 1) : [...entries];
  const hidden = entries.length - shown.length;

  const names = indexLabels(shown.map((e) => e.path));
  const cells: FileIndexCell[] = shown.map((entry, i) => {
    const cursor = entry.current ? theme.glyph.cursor : ' ';
    const check = entry.reviewed ? theme.glyph.done : ' ';
    const label = pad(truncatePath(names[i]!, cellWidth - MARK_WIDTH), cellWidth - MARK_WIDTH);
    return { entry, cursor, check, label, text: `${cursor}${check} ${label}` };
  });

  if (hidden > 0) {
    const label = pad(`+${hidden} more`, cellWidth - MARK_WIDTH);
    cells.push({ entry: null, cursor: ' ', check: ' ', label, text: `   ${label}` });
  }

  const grid: FileIndexCell[][] = [];
  for (let i = 0; i < cells.length; i += columns) {
    grid.push(cells.slice(i, i + columns));
  }

  return { grid, columns, cellWidth, hidden };
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

/** Rows the index will occupy, for the pane's height budget. */
export function fileIndexRows(entryCount: number, width: number, maxRows = 8): number {
  if (entryCount === 0) return 0;
  const columns = fileIndexColumns(width);
  const capacity = Math.max(1, columns * maxRows);
  const cells = entryCount > capacity ? capacity : entryCount;
  return Math.ceil(cells / columns);
}
