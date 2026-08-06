import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import {
  DiffLineRow, DiffLines, formatGutter, gutterStyle, markerStyle,
} from '../../src/tui/components/DiffLines.js';
import type { DiffLine, Hunk } from '../../src/core/diff/types.js';
import { theme } from '../../src/tui/theme.js';

const line = (kind: DiffLine['kind'], text: string, oldLine: number | null, newLine: number | null): DiffLine =>
  ({ kind, text, oldLine, newLine, noNewlineAtEof: false });

const hunk: Hunk = {
  header: '@@ -10,2 +10,3 @@ boot()',
  section: 'boot()',
  oldStart: 10, oldLines: 2, newStart: 10, newLines: 3,
  lines: [
    line('context', 'const a = 1;', 10, 10),
    line('del', 'old();', 11, null),
    line('add', 'fresh();', null, 11),
  ],
};

describe('formatGutter', () => {
  test('shows both numbers for a context line', () => {
    expect(formatGutter(line('context', 'x', 10, 12), 4)).toBe('  10   12');
  });

  test('blanks the new column for a deletion', () => {
    expect(formatGutter(line('del', 'x', 11, null), 4)).toBe('  11     ');
  });

  test('blanks the old column for an addition', () => {
    expect(formatGutter(line('add', 'x', null, 11), 4)).toBe('       11');
  });
});

describe('DiffLines', () => {
  test('renders every line of the hunk with its marker', () => {
    const out = renderToString(<DiffLines hunk={hunk} gutterWidth={4} />);
    expect(out).toContain('const a = 1;');
    expect(out).toContain('-old();');
    expect(out).toContain('+fresh();');
  });

  // Detail renders the header, because the header is where the cursor mark and
  // the keep-reason live. Printing it here as well put it on screen twice.
  test('leaves the hunk header to Detail', () => {
    const out = renderToString(<DiffLines hunk={hunk} gutterWidth={4} />);
    expect(out).not.toContain('@@ -10,2 +10,3 @@');
  });
});

const strip = (text: string) => text.replaceAll(/\u001b\[[0-9;]*m/g, '');

// Ink emits no escapes when the environment reports no colour support, so
// these assert the *decision* rather than the bytes — the same reason
// `formatGutter` is tested as a function and not through a render.
describe('where add and del live once the code is coloured', () => {
  test('the gutter carries the add/del colour, which is the column you skim', () => {
    expect(gutterStyle(line('add', 'x', null, 11))).toEqual({ color: theme.color.add });
    expect(gutterStyle(line('del', 'x', 11, null))).toEqual({ color: theme.color.del });
  });

  test('a context line has no add/del signal to carry, so it stays dim', () => {
    expect(gutterStyle(line('context', 'x', 10, 10))).toEqual({ dimColor: true });
  });

  test('the marker keeps it too', () => {
    expect(markerStyle(line('add', 'x', null, 11))).toEqual({ color: theme.color.add });
    expect(markerStyle(line('del', 'x', 11, null))).toEqual({ color: theme.color.del });
  });

  test('the code column takes the highlighted text when there is one', () => {
    const out = renderToString(
      <DiffLineRow
        line={line('add', 'const x = 1;', null, 11)}
        gutterWidth={4}
        highlighted="HIGHLIGHTED"
      />,
    );
    // Proves the prop is what got drawn, not the plain text beside it.
    expect(strip(out)).toContain('HIGHLIGHTED');
    expect(strip(out)).not.toContain('const x = 1;');
  });

  test('falls back to the plain text when nothing highlighted it', () => {
    const out = renderToString(
      <DiffLineRow line={line('add', 'const x = 1;', null, 11)} gutterWidth={4} />,
    );
    expect(strip(out)).toContain('const x = 1;');
  });

  // The invariant the entire row model exists to protect. A highlighted line is
  // the same characters plus invisible escapes, and every width calculation
  // between here and the terminal has to know they are invisible.
  test('a highlighted line longer than the pane is still exactly one row', () => {
    const long = `const value = '${'x'.repeat(300)}';`;
    const out = renderToString(
      <DiffLineRow
        line={line('add', long, null, 11)}
        gutterWidth={4}
        highlighted={`\u001b[35mconst\u001b[39m value = \u001b[33m'${'x'.repeat(300)}'\u001b[39m;`}
      />,
      { columns: 80 },
    );

    expect(out.split('\n')).toHaveLength(1);
    // The gutter is still where the gutter goes.
    expect(strip(out).startsWith('       11 +')).toBe(true);
  });
});
