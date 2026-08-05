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

/** Green means addition and nothing else, red means deletion and nothing else.
 *  Context lines get no color — they read at the default (secondary) tier. */
function colorFor(line: DiffLine): string | undefined {
  if (line.kind === 'add') return theme.color.add;
  if (line.kind === 'del') return theme.color.del;
  return undefined;
}

export interface DiffLineRowProps {
  line: DiffLine;
  gutterWidth: number;
}

/**
 * Exactly one terminal row, and the reason this is its own component: the
 * detail pane windows on rows, so it has to be able to render the middle of a
 * thousand-line hunk without rendering its ends.
 */
export function DiffLineRow({ line, gutterWidth }: DiffLineRowProps) {
  return (
    <Text wrap="truncate">
      <Text dimColor>{formatGutter(line, gutterWidth)}</Text>{' '}
      <Text color={colorFor(line)}>
        {marker(line)}
        {line.text}
      </Text>
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
