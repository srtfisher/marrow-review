import { Box, Text } from 'ink';
import type { DiffLine, Hunk } from '../../core/diff/types.js';
import { theme } from '../theme.js';
import { padToWidth, type DiffTint } from '../tint.js';

function pad(value: number | null, width: number): string {
  return value === null ? ' '.repeat(width) : String(value).padStart(width, ' ');
}

/** Two right-aligned line-number columns: old, then new. Right alignment keeps the
 *  code column from shifting as line numbers gain digits. */
export function formatGutter(line: DiffLine, width: number): string {
  return `${pad(line.oldLine, width)} ${pad(line.newLine, width)}`;
}

function marker(line: DiffLine): string {
  if (line.kind === 'add') return '+';
  if (line.kind === 'del') return '-';
  return ' ';
}

/**
 * Green means addition and nothing else, red means deletion and nothing else.
 *
 * With syntax highlighting on, this no longer colors the code — the code column
 * belongs to the grammar now. It colors the marker and the gutter instead,
 * which is the column the eye already runs down when skimming a diff, so the
 * add/del signal survives in the place it was actually being read.
 */
function colorFor(line: DiffLine): string | undefined {
  if (line.kind === 'add') return theme.color.add;
  if (line.kind === 'del') return theme.color.del;
  return undefined;
}

/** Exported as a decision rather than asserted through a render: Ink emits no
 *  escapes at all when the terminal reports no color support. */
export function markerStyle(line: DiffLine): { color?: string; dimColor?: boolean } {
  const color = colorFor(line);
  return color === undefined ? { dimColor: true } : { color };
}

/** A context line has no add/del signal to carry, so it stays dim — which is
 *  what keeps the changed lines' gutters standing out from it. */
export const gutterStyle = markerStyle;

/**
 * The tint behind a changed line, or undefined for a context line — which never
 * gets one, because the tint's whole job is to separate changed from unchanged.
 */
export function backgroundFor(line: DiffLine, tint: DiffTint | null): string | undefined {
  if (tint === null) return undefined;
  if (line.kind === 'add') return tint.add;
  if (line.kind === 'del') return tint.del;
  return undefined;
}

/** Columns left for the code once the two gutters, their separator, the space
 *  after them, and the `+`/`-` marker have been laid down. */
export function codeWidth(rowWidth: number, gutterWidth: number): number {
  return Math.max(0, rowWidth - (gutterWidth * 2 + 3));
}

/**
 * The code column as drawn: padded to the pane edge when there is a tint behind
 * it, left alone when there is not.
 *
 * A tint that stops where the code stops draws a ragged right edge tracking line
 * length, which reads as noise rather than structure — so a washed line runs to
 * the edge. An unwashed one must not: the padding is invisible but real, and it
 * would make every row exactly wide enough for `wrap="truncate"` to cut.
 *
 * Pure, and tested as such, because Ink emits no escapes at all where the
 * terminal reports no colour and a render would then show no padding either.
 */
export function codeColumn(
  code: string,
  background: string | undefined,
  gutterWidth: number,
  rowWidth?: number,
): string {
  if (background === undefined || rowWidth === undefined) return code;
  return padToWidth(code, codeWidth(rowWidth, gutterWidth));
}

export interface DiffLineRowProps {
  line: DiffLine;
  gutterWidth: number;
  /**
   * The code, already syntax-colored. Computed once per hunk when the rows are
   * built, because highlighting a line at a time gets block comments and
   * template literals wrong — and never here, where it would run on every
   * repaint of every visible row.
   */
  highlighted?: string;
  /** Null on a terminal that could not be asked, or cannot render it subtly. */
  tint?: DiffTint | null;
  /** Columns this row has. Only needed when tinting, to reach the pane edge. */
  width?: number;
}

/**
 * Exactly one terminal row, and the reason this is its own component: the
 * detail pane windows on rows, so it has to be able to render the middle of a
 * thousand-line hunk without rendering its ends.
 */
export function DiffLineRow({
  line, gutterWidth, highlighted, tint = null, width,
}: DiffLineRowProps) {
  const background = backgroundFor(line, tint);
  const body = codeColumn(highlighted ?? line.text, background, gutterWidth, width);

  return (
    <Text wrap="truncate" backgroundColor={background}>
      <Text {...gutterStyle(line)}>{formatGutter(line, gutterWidth)}</Text>{' '}
      <Text {...markerStyle(line)}>{marker(line)}</Text>
      {body}
    </Text>
  );
}

export interface DiffLinesProps {
  hunk: Hunk;
  gutterWidth: number;
}

/** Lines only. The header belongs to `Detail`, which owns the cursor mark that
 *  sits on it — rendering it here too printed every hunk header twice. */
export function DiffLines({ hunk, gutterWidth }: DiffLinesProps) {
  return (
    <Box flexDirection="column">
      {hunk.lines.map((line, i) => (
        <DiffLineRow key={i} line={line} gutterWidth={gutterWidth} />
      ))}
    </Box>
  );
}
