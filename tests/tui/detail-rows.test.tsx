import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { Detail, detailHeaderRows, unitHeights } from '../../src/tui/components/Detail.js';
import { buildUnits } from '../../src/tui/units.js';
import { computeRowWindow, nextRowScrollTop, rowOffsets } from '../../src/tui/viewport.js';
import type { DiffLine } from '../../src/core/diff/types.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import type { PullRequestDetail } from '../../src/core/github/types.js';

const pr: PullRequestDetail = {
  number: 42, title: 'Fix rendering', author: 'hazadus', state: 'open', isDraft: false,
  headSha: 'abc', baseRef: 'main', headRef: 'fix/render',
  updatedAt: '2026-08-01T00:00:00Z', additions: 240, deletions: 0, changedFiles: 5,
  body: '', diff: '', viewerIsAuthor: false,
};

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

function rowsOf(out: string): number {
  return out.split('\n').length;
}

describe('Detail stays inside its row budget', () => {
  test('content far exceeding the height emits no more rows than the height', () => {
    const meat = bigMeat();
    const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });
    const height = 40;

    const out = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={height}
        checks={[]} threads={[]} showThreads={false} />,
    );

    // 5 files x 4 hunks x 12 lines is ~289 rows of content. The whole pane —
    // header block included — must still fit the height it was given.
    expect(units.length).toBeGreaterThan(20);
    expect(rowsOf(out)).toBeLessThanOrEqual(height);
  });

  test('the budget holds wherever the reviewer has scrolled to', () => {
    const meat = bigMeat();
    const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });
    const height = 40;
    const heights = unitHeights(units, [], false);
    const body = height - detailHeaderRows(meat, []);

    let scroll = 0;
    for (let cursor = 0; cursor < units.length; cursor += 1) {
      scroll = nextRowScrollTop(heights, body, cursor, scroll);
      const out = renderToString(
        <Detail pr={pr} meat={meat} units={units} cursor={cursor} scrollTop={scroll} height={height}
          checks={[]} threads={[]} showThreads={false} />,
      );
      expect(rowsOf(out)).toBeLessThanOrEqual(height);
    }
  });

  test('a short diff is not padded past its own content', () => {
    const meat = bigMeat(1, 1, 2);
    const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });
    const out = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={40}
        checks={[]} threads={[]} showThreads={false} />,
    );
    expect(out).toContain('const value0 = 0;');
    expect(rowsOf(out)).toBeLessThanOrEqual(40);
  });

  test('the cursor unit is on screen at every scroll position', () => {
    const meat = bigMeat();
    const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });
    const heights = unitHeights(units, [], false);
    const body = 40 - detailHeaderRows(meat, []);

    let scroll = 0;
    for (let cursor = 0; cursor < units.length; cursor += 1) {
      scroll = nextRowScrollTop(heights, body, cursor, scroll);
      const { start, end } = computeRowWindow(heights, body, scroll);
      expect(cursor).toBeGreaterThanOrEqual(start);
      expect(cursor).toBeLessThan(end);
    }
  });
});

describe('unitHeights', () => {
  test('a hunk costs its header plus every line, and a file header costs one', () => {
    const meat = bigMeat(1, 1, 12);
    const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });
    const heights = unitHeights(units, [], false);
    expect(heights[0]).toBe(1);
    expect(heights[1]).toBe(13);
  });

  test('every hunk after the first in a file gains a blank separator row', () => {
    const meat = bigMeat(1, 2, 12);
    const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });
    const heights = unitHeights(units, [], false);
    expect(heights[1]).toBe(13);
    expect(heights[2]).toBe(14);
  });

  test('a second file gains a blank separator row before its header', () => {
    const meat = bigMeat(2, 1, 2);
    const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });
    const heights = unitHeights(units, [], false);
    expect(heights[0]).toBe(1);
    expect(heights[2]).toBe(2);
  });

  test('the heights sum to what the pane would render unwindowed', () => {
    const meat = bigMeat(5, 4, 12);
    const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });
    const heights = unitHeights(units, [], false);
    const total = rowOffsets(heights).at(-1) ?? 0;

    const out = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0}
        height={total + detailHeaderRows(meat, [])}
        checks={[]} threads={[]} showThreads={false} />,
    );
    expect(rowsOf(out)).toBe(total + detailHeaderRows(meat, []));
  });
});

describe('nextRowScrollTop', () => {
  test('a half page of rows is the same distance whatever the unit sizes', () => {
    const tall = [1, 40, 1, 40];
    const short = Array.from({ length: 82 }, () => 1);
    expect(rowOffsets(tall).at(-1)).toBe(rowOffsets(short).at(-1));
  });

  test('does not scroll while the cursor is comfortably inside', () => {
    const heights = Array.from({ length: 40 }, () => 3);
    expect(nextRowScrollTop(heights, 30, 2, 0)).toBe(0);
  });

  test('returns 0 when everything fits', () => {
    expect(nextRowScrollTop([2, 3, 4], 30, 2, 0)).toBe(0);
  });

  test('returns an item boundary, never a row inside one', () => {
    const heights = [5, 5, 5, 5, 5, 5, 5, 5];
    const offsets = new Set(rowOffsets(heights));
    for (let cursor = 0; cursor < heights.length; cursor += 1) {
      expect(offsets.has(nextRowScrollTop(heights, 12, cursor, 0))).toBe(true);
    }
  });

  test('handles an empty pane and a single oversized unit', () => {
    expect(nextRowScrollTop([], 10, 0, 0)).toBe(0);
    expect(nextRowScrollTop([100], 10, 0, 0)).toBe(0);
    expect(computeRowWindow([100], 10, 0)).toEqual({ start: 0, end: 1 });
  });
});
