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

/** Air between one column's longest name and the next column's mark. */
const COLUMN_GAP = 2;

/** Below this a name is unreadable however it is truncated, so use fewer columns. */
const MIN_USEFUL_LABEL = 24;

/**
 * Six, revised up from four.
 *
 * Four was recorded as "a very wide terminal does not get eight columns of
 * nothing", and that was right about the symptom and wrong about the cause: the
 * sprawl came from dividing the whole width between the columns, so on a
 * 230-column terminal four cells were 57 wide and `app.css` sat in a 57-column
 * cell. Cells are sized to their contents now, so more columns means a tighter
 * block rather than a more spread-out one. Six is where a row stops being
 * something the eye can scan across in one pass.
 */
const MAX_COLUMNS = 6;

/**
 * How wide a label may be, and how many columns of them fit.
 *
 * Content-sized, not width-divided. The index is a block the eye scans, and a
 * cell padded out to a quarter of a 230-column terminal turns four columns into
 * four unrelated lists with a gutter of nothing between them — while still
 * truncating the one name long enough to need the room.
 *
 * So: take the most columns whose cells can still hold a readable name, then
 * shrink the cell to the longest name it actually has to hold.
 */
export function fileIndexGeometry(
  labels: readonly string[],
  width: number,
): { columns: number; cellWidth: number; labelWidth: number } {
  const widest = labels.reduce((max, l) => Math.max(max, l.length), 0);
  const roomAt = (columns: number) => Math.floor(width / columns) - MARK_WIDTH - COLUMN_GAP;

  let columns = 1;
  for (let c = MAX_COLUMNS; c > 1; c -= 1) {
    if (roomAt(c) >= Math.min(widest, MIN_USEFUL_LABEL)) {
      columns = c;
      break;
    }
  }

  // Never wider than the longest name needs, never wider than the pane, never
  // zero — a pane too narrow for any of this still has to render something.
  const labelWidth = Math.max(1, Math.min(widest, roomAt(columns)));
  return { columns, cellWidth: MARK_WIDTH + labelWidth + COLUMN_GAP, labelWidth };
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
 * How many files the index shows and at what geometry, decided once.
 *
 * Both the grid and the pane's height budget are derived from this, rather than
 * each working it out again: they have to agree exactly, and when they did not,
 * the cursor walked off the bottom of the pane.
 */
export interface FileIndexPlan {
  columns: number;
  cellWidth: number;
  labelWidth: number;
  labels: string[];
  /** Files given a cell of their own. The rest are counted in the last cell. */
  shownCount: number;
  hidden: number;
  rows: number;
}

/** The last cell when the cap bites. The count leads, so it is never cut off. */
function overflowLabel(hidden: number): string {
  return `+${hidden} more`;
}

export function planFileIndex(
  paths: readonly string[],
  width: number,
  maxRows = 8,
): FileIndexPlan {
  // Labels for every file, not only the ones that will fit: the geometry is
  // sized from the longest name, and disambiguating `index.tsx` has to consider
  // the whole change or the same file gets a different label as the cap moves.
  const labels = indexLabels(paths);
  let geometry = fileIndexGeometry(labels, width);
  let capacity = Math.max(1, geometry.columns * maxRows);

  if (paths.length > capacity) {
    // The overflow cell has to stay legible, and it is the one label whose
    // meaning lives at the front — `truncatePath` keeps the tail, so a column
    // sized for `f59.ts` turned `+43 more` into `… more`. Size the columns to
    // hold it, using the largest count it could possibly report so that a
    // narrower grid reporting more files cannot outgrow the room reserved here.
    geometry = fileIndexGeometry([...labels, overflowLabel(paths.length)], width);
    capacity = Math.max(1, geometry.columns * maxRows);
  }

  const shownCount = paths.length > capacity ? capacity - 1 : paths.length;
  const hidden = paths.length - shownCount;
  const cells = shownCount + (hidden > 0 ? 1 : 0);

  return {
    ...geometry,
    labels,
    shownCount,
    hidden,
    rows: paths.length === 0 ? 0 : Math.ceil(cells / geometry.columns),
  };
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
  const plan = planFileIndex(entries.map((e) => e.path), width, maxRows);
  const { columns, cellWidth, labelWidth, labels } = plan;

  const cells: FileIndexCell[] = entries.slice(0, plan.shownCount).map((entry, i) => {
    const cursor = entry.current ? theme.glyph.cursor : ' ';
    const check = entry.reviewed ? theme.glyph.done : ' ';
    const label = pad(truncatePath(labels[i]!, labelWidth), labelWidth + COLUMN_GAP);
    return { entry, cursor, check, label, text: `${cursor}${check} ${label}` };
  });

  if (plan.hidden > 0) {
    // Sliced from the front, not `truncatePath`d from the back: on a pane too
    // narrow for the whole phrase, `+43 m` still answers "how many".
    const label = pad(overflowLabel(plan.hidden).slice(0, labelWidth), labelWidth + COLUMN_GAP);
    cells.push({ entry: null, cursor: ' ', check: ' ', label, text: `   ${label}` });
  }

  const grid: FileIndexCell[][] = [];
  for (let i = 0; i < cells.length; i += columns) {
    grid.push(cells.slice(i, i + columns));
  }

  return { grid, columns, cellWidth, hidden: plan.hidden };
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

/**
 * Rows the index will occupy, for the pane's height budget.
 *
 * Takes the paths rather than a count, because the column count now depends on
 * how long the names are. Scrolling and rendering must agree on this number
 * exactly — when they disagreed, the cursor walked off the bottom of the pane.
 */
export function fileIndexRows(paths: readonly string[], width: number, maxRows = 8): number {
  return planFileIndex(paths, width, maxRows).rows;
}
