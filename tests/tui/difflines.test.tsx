import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { DiffLines, formatGutter } from '../../src/tui/components/DiffLines.js';
import type { DiffLine, Hunk } from '../../src/core/diff/types.js';

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
