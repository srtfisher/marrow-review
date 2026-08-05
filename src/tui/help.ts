import { HELP_GROUPS, KEY_HELP, type KeyHelpEntry } from './keymap.js';

/**
 * The help overlay's layout.
 *
 * It used to be one column of twenty-four rows under a single heading, which was
 * two problems. The small one is that an undifferentiated list of every binding
 * is read to the end by nobody. The large one is that twenty-six rows do not fit
 * an eighty-by-twenty-four terminal, and Ink does not clip an overflowing column
 * — it draws the rows on top of each other, which is how the welcome panel used
 * to garble itself.
 *
 * So the bindings are grouped, and the groups are packed into as many columns as
 * the terminal is wide enough for and as few as its height needs. Same rule as
 * everywhere else in this app: the layout sheds and reflows, it never overdraws.
 */

export interface HelpBlock {
  title: string;
  entries: KeyHelpEntry[];
}

export type HelpCell =
  | { kind: 'title'; text: string }
  | { kind: 'binding'; keys: string; description: string }
  | { kind: 'blank' };

export interface HelpLayout {
  /** Rows of cells, one cell per column. Short rows are padded with blanks. */
  rows: HelpCell[][];
  columns: number;
  /** Cells one column occupies, the gap to the next included. */
  columnWidth: number;
  /** Cells the key names are padded to, so descriptions line up. */
  keyWidth: number;
}

/** Air between one column and the next. */
const COLUMN_GAP = 3;
/** Between the padded keys and the description they belong to. */
const KEY_GAP = 2;
/** The overlay's own indent, matching every other pane's `paddingX`. */
const INDENT = 2;
/** Beyond this the eye loses the row it was reading. */
const MAX_COLUMNS = 3;
/**
 * The heading, the position indicator, and the `esc to close` row. All three are
 * reserved whether or not the indicator has anything to say — a row that arrives
 * only once the list scrolls is a row the layout did not budget for.
 */
export const HELP_CHROME_ROWS = 3;

/** Rows left for the bindings themselves. */
export function helpBodyRows(height: number): number {
  const rows = Number.isFinite(height) ? height : 1;
  return Math.max(1, rows - HELP_CHROME_ROWS);
}

/** The bindings, in group order, dropping any group nothing is filed under. */
export function helpBlocks(entries: readonly KeyHelpEntry[] = KEY_HELP): HelpBlock[] {
  return HELP_GROUPS
    .map(({ id, title }) => ({ title, entries: entries.filter((e) => e.group === id) }))
    .filter((block) => block.entries.length > 0);
}

/** Rows a block occupies: its heading plus one row per binding. */
function blockRows(block: HelpBlock): number {
  return 1 + block.entries.length;
}

/**
 * Packs blocks into `columns`, keeping group order as the eye reads: down one
 * column, then down the next. A block is never split across a column break —
 * a heading at the bottom of one column with its bindings in the next is worse
 * than an uneven pair of columns.
 */
export function packBlocks(blocks: readonly HelpBlock[], columns: number): HelpBlock[][] {
  // Sanitised rather than trusted: a terminal that reports no size at all makes
  // this NaN, `Array.from({length: NaN})` is empty, and the first push crashes
  // the whole app on a keystroke as harmless as `?`.
  const count = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  const packed: HelpBlock[][] = Array.from({ length: count }, () => []);
  if (blocks.length === 0) return packed;

  const total = blocks.reduce((sum, b) => sum + blockRows(b) + 1, 0);
  const target = Math.ceil(total / count);

  let column = 0;
  let used = 0;
  for (const block of blocks) {
    const cost = blockRows(block) + 1;
    // Move on once this column is full, but never leave a column empty and
    // never run past the last one — the remainder goes in the final column.
    if (used > 0 && used + cost > target && column < count - 1) {
      column += 1;
      used = 0;
    }
    packed[column]!.push(block);
    used += cost;
  }
  return packed;
}

/** Rows the tallest column of a packing occupies. */
function packedHeight(packed: readonly HelpBlock[][]): number {
  return packed.reduce((tallest, column) => {
    // One blank row between blocks, none after the last.
    const rows = column.reduce((sum, b) => sum + blockRows(b), 0) + Math.max(0, column.length - 1);
    return Math.max(tallest, rows);
  }, 0);
}

export function layoutHelp(
  width: number,
  height: number,
  entries: readonly KeyHelpEntry[] = KEY_HELP,
): HelpLayout {
  const blocks = helpBlocks(entries);
  const keyWidth = entries.reduce((max, e) => Math.max(max, e.keys.length), 0);
  const descriptionWidth = entries.reduce((max, e) => Math.max(max, e.description.length), 0);
  const naturalColumn = INDENT + keyWidth + KEY_GAP + descriptionWidth;

  // A terminal that reports no size still has to render something rather than
  // taking the app down with it.
  const room = Number.isFinite(width) ? Math.max(1, width) : 1;
  const rowsAvailable = Number.isFinite(height) ? Math.max(1, height) : 1;

  // What the width allows, and then the fewest of those that the height needs:
  // two roomy columns beat three cramped ones when two already fit.
  const byWidth = Math.max(
    1,
    Math.min(MAX_COLUMNS, Math.floor((room + COLUMN_GAP) / (naturalColumn + COLUMN_GAP))),
  );
  let columns = byWidth;
  for (let c = 1; c <= byWidth; c += 1) {
    if (packedHeight(packBlocks(blocks, c)) <= helpBodyRows(rowsAvailable)) {
      columns = c;
      break;
    }
  }

  const packed = packBlocks(blocks, columns);
  const rowCount = packedHeight(packed);

  // Every column rendered as its own list of cells, then transposed into rows:
  // the pane draws rows, and a row is what must never wrap.
  const asCells = packed.map((column) => {
    const cells: HelpCell[] = [];
    column.forEach((block, i) => {
      if (i > 0) cells.push({ kind: 'blank' });
      cells.push({ kind: 'title', text: block.title });
      for (const entry of block.entries) {
        cells.push({ kind: 'binding', keys: entry.keys, description: entry.description });
      }
    });
    return cells;
  });

  const rows: HelpCell[][] = Array.from({ length: rowCount }, (_, r) => (
    asCells.map((cells) => cells[r] ?? { kind: 'blank' as const })
  ));

  return {
    rows,
    columns,
    columnWidth: naturalColumn + COLUMN_GAP,
    keyWidth,
  };
}
