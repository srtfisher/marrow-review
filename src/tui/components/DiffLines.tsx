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
  if (line.kind === 'add') return theme.add;
  if (line.kind === 'del') return theme.del;
  return undefined;
}

export interface DiffLinesProps {
  hunk: Hunk;
  gutterWidth: number;
}

export function DiffLines({ hunk, gutterWidth }: DiffLinesProps) {
  return (
    <Box flexDirection="column">
      <Text dimColor>{hunk.header}</Text>
      {hunk.lines.map((line, i) => (
        <Text key={i}>
          <Text dimColor>{formatGutter(line, gutterWidth)}</Text>{' '}
          <Text color={colorFor(line)}>
            {marker(line)}
            {line.text}
          </Text>
        </Text>
      ))}
    </Box>
  );
}
