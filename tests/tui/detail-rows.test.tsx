import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { Detail, detailHeaderRows } from '../../src/tui/components/Detail.js';
import { buildUnits } from '../../src/tui/units.js';
import { buildRows } from '../../src/tui/rows.js';
import { computeWindow, nextScrollTop } from '../../src/tui/viewport.js';
import type { DiffLine } from '../../src/core/diff/types.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import type { PullRequestDetail } from '../../src/core/github/types.js';

const pr: PullRequestDetail = {
  number: 42, title: 'Fix rendering', author: 'hazadus', state: 'open', isDraft: false,
  headSha: 'abc', baseRef: 'main', headRef: 'fix/render',
  updatedAt: '2026-08-01T00:00:00Z', additions: 240, deletions: 0, changedFiles: 5,
  body: '', diff: '', viewerIsAuthor: false,
};

const WIDTH = 100;

function line(n: number): DiffLine {
  return { kind: 'add', text: `const value${n} = ${n};`, oldLine: null, newLine: n, noNewlineAtEof: false };
}

/** Five files, four hunks each, twelve lines a hunk — the shape that emitted
 *  289 rows into a 40-row pane. */
function bigMeat(files = 5, hunks = 4, lines = 12): MeatResult {
  const meatFiles: MeatFile[] = Array.from({ length: files }, (_, f) => ({
    file: {
      path: `src/file${f}.ts`, oldPath: null, status: 'modified' as const, similarity: null,
      hunks: [], additions: hunks * lines, deletions: 0,
    },
    dropped: null,
    hunks: Array.from({ length: hunks }, (_, h) => ({
      hunk: {
        header: `@@ -${h * 20},${lines} +${h * 20},${lines} @@`,
        section: '', oldStart: h * 20, oldLines: lines, newStart: h * 20, newLines: lines,
        lines: Array.from({ length: lines }, (_, i) => line(h * 20 + i)),
      },
      keep: true, reason: 'meaningful', source: 'model' as const,
    })),
  }));

  return {
    summary: 'A large change.', files: meatFiles,
    keptLines: files * hunks * lines, totalLines: files * hunks * lines,
    keptFiles: files, totalFiles: files,
  };
}

function rowsFor(meat: MeatResult) {
  return buildRows(
    buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() }),
    [],
    false,
  );
}

function draw(meat: MeatResult, cursor: number, scrollTop: number, height: number) {
  return renderToString(
    <Detail pr={pr} meat={meat} rows={rowsFor(meat)} cursor={cursor} scrollTop={scrollTop}
      height={height} width={WIDTH} checks={[]} fullDiff={false} reviewed={new Set()}
      model="opus" worktreeOk />,
  );
}

function rowsOf(out: string): number {
  return out.split('\n').length;
}

describe('Detail stays inside its row budget', () => {
  test('content far exceeding the height emits no more rows than the height', () => {
    const meat = bigMeat();
    const height = 40;
    expect(rowsFor(meat).length).toBeGreaterThan(200);
    expect(rowsOf(draw(meat, 0, 0, height))).toBeLessThanOrEqual(height);
  });

  test('the budget holds wherever the reviewer has scrolled to', () => {
    const meat = bigMeat();
    const rows = rowsFor(meat);
    const height = 40;
    const body = height - detailHeaderRows(meat, [], WIDTH);

    let scroll = 0;
    for (let cursor = 0; cursor < rows.length; cursor += 1) {
      scroll = nextScrollTop(rows.length, body, cursor, scroll);
      expect(rowsOf(draw(meat, cursor, scroll, height))).toBeLessThanOrEqual(height);
    }
  });

  test('a short diff is not padded past its own content', () => {
    const meat = bigMeat(1, 1, 2);
    const out = draw(meat, 0, 0, 40);
    expect(out).toContain('const value0 = 0;');
    expect(rowsOf(out)).toBeLessThanOrEqual(40);
  });

  test('the cursor row is on screen at every scroll position', () => {
    const meat = bigMeat();
    const rows = rowsFor(meat);
    const body = 40 - detailHeaderRows(meat, [], WIDTH);

    let scroll = 0;
    for (let cursor = 0; cursor < rows.length; cursor += 1) {
      scroll = nextScrollTop(rows.length, body, cursor, scroll);
      const { start, end } = computeWindow(rows.length, body, cursor, scroll);
      expect(cursor).toBeGreaterThanOrEqual(start);
      expect(cursor).toBeLessThan(end);
    }
  });
});

describe('a hunk taller than the pane', () => {
  /**
   * The bug this file now exists to prevent. A design-doc change is one file
   * with one enormous hunk; the pane windowed on whole units, so it could show
   * that hunk or nothing — and at the top of the diff the first unit is a
   * one-row file header, which fits, while the hunk after it does not. The
   * reviewer got a single file path on an otherwise empty screen and concluded
   * the pull request had one file in it.
   */
  const meat = bigMeat(2, 1, 1000);

  test('fills the pane from the very first row rather than showing one line', () => {
    const height = 40;
    const body = height - detailHeaderRows(meat, [], WIDTH);
    const out = draw(meat, 0, 0, height);

    // The file header, then real diff content — not thirty-nine blank rows.
    expect(out).toContain('src/file0.ts');
    expect(out).toContain('const value0 = 0;');
    expect(out).toContain('const value10 = 10;');
    expect(rowsOf(out)).toBeGreaterThan(body - 2);
  });

  test('scrolls through the middle of the hunk, not around it', () => {
    // A window starting deep inside the hunk must render, which is only
    // possible because rows — not units — are what gets sliced.
    const out = draw(meat, 500, 480, 40);
    expect(out).toContain('const value500 = 500;');
    expect(out).not.toContain('const value0 = 0;');
  });

  test('every row of the diff is reachable', () => {
    const rows = rowsFor(meat);
    const body = 40 - detailHeaderRows(meat, [], WIDTH);
    const seen = new Set<number>();

    let scroll = 0;
    for (let cursor = 0; cursor < rows.length; cursor += 1) {
      scroll = nextScrollTop(rows.length, body, cursor, scroll);
      const { start, end } = computeWindow(rows.length, body, cursor, scroll);
      for (let i = start; i < end; i += 1) seen.add(i);
    }
    expect(seen.size).toBe(rows.length);
  });
});

describe('nextScrollTop', () => {
  test('does not scroll while the cursor is comfortably inside', () => {
    expect(nextScrollTop(120, 30, 5, 0)).toBe(0);
  });

  test('returns 0 when everything fits', () => {
    expect(nextScrollTop(9, 30, 2, 0)).toBe(0);
  });

  test('never scrolls past the last screen', () => {
    expect(nextScrollTop(100, 40, 99, 0)).toBe(60);
  });

  test('handles an empty pane', () => {
    expect(nextScrollTop(0, 10, 0, 0)).toBe(0);
    expect(computeWindow(0, 10, 0, 0)).toEqual({ start: 0, end: 0 });
  });
});
