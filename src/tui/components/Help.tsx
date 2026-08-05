import { Box, Text } from 'ink';
import { HELP_CHROME_ROWS, helpBodyRows, layoutHelp, type HelpCell } from '../help.js';
import { theme } from '../theme.js';
import { computeWindow } from '../viewport.js';

export interface HelpProps {
  /** The whole terminal: this overlay is the only thing on screen. */
  width: number;
  height: number;
  /** First row on screen. Nonzero only once the list is taller than the pane. */
  scrollTop?: number;
}

/**
 * Generated from `KEY_HELP` rather than written by hand, so a binding cannot
 * exist without being documented — the drift only ever goes one way otherwise.
 *
 * Grouped and packed into columns by `layoutHelp`, which is where the reasoning
 * about fitting a terminal lives. Past a certain point no arrangement fits — an
 * eighty-column terminal has room for one column, and one column of every
 * binding is thirty-nine rows — so what is left over scrolls. Clipping it
 * instead would leave a reviewer looking for a key that this screen exists to
 * tell them about.
 */
export function Help({ width, height, scrollTop = 0 }: HelpProps) {
  const { rows, keyWidth, columnWidth } = layoutHelp(width, height);
  const body = helpBodyRows(height);
  const { start, end } = computeWindow(rows.length, body, 0, scrollTop);
  const scrolls = rows.length > body;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text {...theme.tier.primary}>Keys</Text>
      {rows.slice(start, end).map((cells, r) => (
        <Text key={start + r} wrap="truncate">
          {cells.map((cell, c) => (
            <Text key={c}>{renderCell(cell, keyWidth, columnWidth)}</Text>
          ))}
        </Text>
      ))}
      {/* Where you are in a list you cannot see all of, the same indicator the
          pull-request list uses. Its row is reserved either way, so arriving at
          a terminal one row too short cannot push `esc to close` off the end. */}
      <Text {...theme.tier.muted} wrap="truncate">
        {scrolls ? `  ${start + 1}–${end} of ${rows.length} · j k to scroll` : ' '}
      </Text>
      <Text {...theme.tier.muted}>esc to close</Text>
    </Box>
  );
}

export { HELP_CHROME_ROWS };

/**
 * One cell, padded to the column so the next one starts where it should.
 *
 * The keys take the `structure` token and the descriptions stay muted, the same
 * split the hint bar uses: the eye lands on what to press. Group headings are
 * `tertiary` — they are structure, and `primary` belongs to the one focal
 * element on a screen, which here is the word "Keys".
 */
function renderCell(cell: HelpCell, keyWidth: number, columnWidth: number) {
  if (cell.kind === 'blank') return ' '.repeat(columnWidth);

  if (cell.kind === 'title') {
    return (
      <Text {...theme.tier.tertiary}>
        {pad(`  ${cell.text}`, columnWidth)}
      </Text>
    );
  }

  const rest = columnWidth - 2 - keyWidth - 2;
  return (
    <>
      {'  '}
      <Text color={theme.color.structure}>{cell.keys.padEnd(keyWidth, ' ')}</Text>
      <Text {...theme.tier.muted}>{`  ${pad(cell.description, Math.max(0, rest))}`}</Text>
    </>
  );
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}
