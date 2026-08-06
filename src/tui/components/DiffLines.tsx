import { Box, Text } from 'ink';
import type { DiffLine, Hunk } from '../../core/diff/types.js';
import { theme } from '../theme.js';

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
}

/**
 * Exactly one terminal row, and the reason this is its own component: the
 * detail pane windows on rows, so it has to be able to render the middle of a
 * thousand-line hunk without rendering its ends.
 */
export function DiffLineRow({ line, gutterWidth, highlighted }: DiffLineRowProps) {
  return (
    <Text wrap="truncate">
      <Text {...gutterStyle(line)}>{formatGutter(line, gutterWidth)}</Text>{' '}
      <Text {...markerStyle(line)}>{marker(line)}</Text>
      {highlighted ?? line.text}
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
