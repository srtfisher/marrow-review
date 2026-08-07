import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import {
  DiffLineRow, DiffLines, backgroundFor, codeColumn, codeWidth, formatGutter,
  gutterStyle, markerStyle,
} from '../../src/tui/components/DiffLines.js';
import type { DiffLine, Hunk } from '../../src/core/diff/types.js';
import { theme } from '../../src/tui/theme.js';
import { DIFF_TINT } from '../../src/tui/tint.js';

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

// Asserted as a decision rather than through a render, for the same reason as
// `gutterStyle` above: Ink emits no escapes at all where colour is unsupported,
// so the bytes are not the thing to test.
describe('the wash behind a changed line', () => {
  test('green behind an addition, red behind a deletion', () => {
    expect(backgroundFor(line('add', 'x', null, 11), DIFF_TINT.dark)).toBe(DIFF_TINT.dark.add);
    expect(backgroundFor(line('del', 'x', 11, null), DIFF_TINT.dark)).toBe(DIFF_TINT.dark.del);
  });

  // The tint's only job is to separate changed from unchanged; washing the
  // context lines too would leave nothing for it to separate them from.
  test('nothing behind a context line', () => {
    expect(backgroundFor(line('context', 'x', 10, 10), DIFF_TINT.dark)).toBeUndefined();
  });

  test('nothing at all when the terminal could not be tinted', () => {
    expect(backgroundFor(line('add', 'x', null, 11), null)).toBeUndefined();
  });

  test('the code column is what is left after both gutters and the marker', () => {
    // 4 + 1 + 4 for the gutters, a space, then `+`.
    expect(codeWidth(80, 4)).toBe(69);
    // A pane narrower than its own gutter asks for no code, not for a negative
    // repeat count — which is what `padToWidth` would throw on.
    expect(codeWidth(4, 4)).toBe(0);
  });

  test('a tinted line reaches the pane edge, so the wash is a band', () => {
    // 40 columns, 11 of them gutter and marker: 29 for the code, 4 of them used.
    expect(codeColumn('x();', DIFF_TINT.dark.add, 4, 40)).toBe(`x();${' '.repeat(25)}`);
  });

  // Without the tint the trailing spaces are invisible but still real, and they
  // would make every row exactly wide enough to truncate.
  test('an untinted line is not padded', () => {
    expect(codeColumn('x();', undefined, 4, 40)).toBe('x();');
  });

  // Rows are laid out before the pane's width is known in the one path that
  // renders a hunk on its own; no width means no band rather than a crash.
  test('no width means no padding either', () => {
    expect(codeColumn('x();', DIFF_TINT.dark.add, 4)).toBe('x();');
  });

  test('a line already past the edge is left for Ink to truncate', () => {
    expect(codeColumn('x'.repeat(40), DIFF_TINT.dark.add, 4, 40)).toBe('x'.repeat(40));
  });

  test('a tinted line longer than the pane is still exactly one row', () => {
    const out = renderToString(
      <DiffLineRow
        line={line('add', `x(${'y'.repeat(300)});`, null, 11)}
        gutterWidth={4}
        tint={DIFF_TINT.dark}
        width={78}
      />,
      { columns: 80 },
    );
    expect(out.split('\n')).toHaveLength(1);
  });
});
