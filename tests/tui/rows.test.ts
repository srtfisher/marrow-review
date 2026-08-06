import { test, expect, describe } from 'bun:test';
import {
  buildRows, findingAtRow, hunkAtRow, nextFileRow, nextFindingRow, pathAtRow,
  prevFileRow, prevFindingRow, unitAtRow, unitStartRows,
} from '../../src/tui/rows.js';
import { buildUnits } from '../../src/tui/units.js';
import { initTriage } from '../../src/core/findings/triage.js';
import type { DiffLine } from '../../src/core/diff/types.js';
import type { ReviewThread } from '../../src/core/github/types.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import type { Refutation, VerifiedFinding } from '../../src/core/findings/verify.js';

function add(n: number): DiffLine {
  return { kind: 'add', text: `line ${n}`, oldLine: null, newLine: n, noNewlineAtEof: false };
}

function file(path: string, hunks: number, lines: number, dropSome = false): MeatFile {
  return {
    file: {
      path, oldPath: null, status: 'modified', similarity: null,
      hunks: [], additions: hunks * lines, deletions: 0,
    },
    dropped: null,
    hunks: Array.from({ length: hunks }, (_, h) => ({
      hunk: {
        header: `@@ -${h * 20},${lines} +${h * 20},${lines} @@`,
        section: '', oldStart: h * 20, oldLines: lines, newStart: h * 20, newLines: lines,
        lines: Array.from({ length: lines }, (_, i) => add(h * 20 + i)),
      },
      keep: !(dropSome && h > 0),
      reason: dropSome && h > 0 ? 'imports only' : 'meaningful',
      source: 'model' as const,
    })),
  };
}

function meatOf(files: MeatFile[]): MeatResult {
  return {
    summary: '', files, keptLines: 1, totalLines: 1,
    keptAdditions: 1, keptDeletions: 0, totalAdditions: 1, totalDeletions: 0,
    keptFiles: files.length, totalFiles: files.length, unclassified: 0,
  };
}

function rowsOf(files: MeatFile[], findings: VerifiedFinding[] = []) {
  const meat = meatOf(files);
  return buildRows(
    buildUnits(meat, {
      expandedFiles: new Set(), foldedFiles: new Set(), findings: initTriage(findings),
    }),
    [],
    false,
  );
}

describe('buildRows', () => {
  test('emits one row per terminal line, so nothing is indivisible', () => {
    // The whole fix: a hunk is not one item, it is its header plus every line.
    const rows = rowsOf([file('a.ts', 1, 400)]);
    expect(rows).toHaveLength(1 + 1 + 400);
    expect(rows[0]!.kind).toBe('file-header');
    expect(rows[1]!.kind).toBe('hunk-header');
    expect(rows.filter((r) => r.kind === 'diff-line')).toHaveLength(400);
  });

  test('separates files and hunks with a blank row, but not lines', () => {
    const rows = rowsOf([file('a.ts', 2, 3), file('b.ts', 1, 3)]);
    const blanks = rows.filter((r) => r.kind === 'blank');
    // One before the second hunk, one before the second file.
    expect(blanks).toHaveLength(2);
    expect(rows[0]!.kind).toBe('file-header');
  });

  test('carries the path on every row, including the blanks', () => {
    for (const row of rowsOf([file('a.ts', 1, 3), file('b.ts', 1, 3)])) {
      expect(row.path === 'a.ts' || row.path === 'b.ts').toBe(true);
    }
  });

  test('a folded-noise row lands after the hunks it stands for', () => {
    const rows = rowsOf([file('a.ts', 3, 4, true)]);
    const summary = rows.find((r) => r.kind === 'dropped-summary');
    expect(summary).toBeDefined();
    expect(summary!.kind === 'dropped-summary' && summary!.count).toBe(2);
    expect(rows.indexOf(summary!)).toBe(rows.length - 1);
  });

  test('threads only cost rows when they are being shown', () => {
    const threads: ReviewThread[] = [{
      path: 'a.ts', line: 1, isResolved: false, isOutdated: false,
      comments: [{ author: 'hubot', body: 'why?', createdAt: 'now' }],
    }];
    const units = buildUnits(meatOf([file('a.ts', 1, 3)]), {
      expandedFiles: new Set(), foldedFiles: new Set(),
    });
    expect(buildRows(units, threads, false).filter((r) => r.kind === 'thread')).toHaveLength(0);
    expect(buildRows(units, threads, true).filter((r) => r.kind === 'thread')).toHaveLength(1);
  });
});

const finding: VerifiedFinding = {
  id: 'f1', path: 'a.ts', line: 2, side: 'RIGHT', startLine: null,
  severity: 'important', title: 'Leak', body: 'Nothing closes it.',
  confidence: 'high', suggestion: null, verdict: 'confirmed', refutations: [],
};

describe('a finding occupies as many rows as it draws', () => {
  test('two rows for a plain one', () => {
    const rows = rowsOf([file('a.ts', 1, 4)], [finding]);
    expect(rows.filter((r) => r.kind === 'finding')).toHaveLength(2);
  });

  test('a third for a suggestion', () => {
    const rows = rowsOf([file('a.ts', 1, 4)], [{ ...finding, suggestion: 'close it' }]);
    expect(rows.filter((r) => r.kind === 'finding')).toHaveLength(3);
  });

  test('one more for every refutation, and only when refuted', () => {
    const refutations: Refutation[] = [
      { lens: 'reachability', refuted: true, reasoning: 'guarded' },
      { lens: 'reproduction', refuted: true, reasoning: 'pooled' },
    ];
    const shown = rowsOf([file('a.ts', 1, 4)], [{ ...finding, verdict: 'refuted', refutations }]);
    expect(shown.filter((r) => r.kind === 'finding')).toHaveLength(4);

    // Confirmed findings can carry refutations that did not win; they are not
    // rendered, so they must not be budgeted for either.
    const hidden = rowsOf([file('a.ts', 1, 4)], [{ ...finding, refutations }]);
    expect(hidden.filter((r) => r.kind === 'finding')).toHaveLength(2);
  });
});

describe('navigation', () => {
  const rows = rowsOf([file('a.ts', 1, 5), file('b.ts', 1, 5), file('c.ts', 1, 5)], [finding]);

  test('] and [ move between file headers', () => {
    const first = rows.findIndex((r) => r.kind === 'file-header');
    const second = nextFileRow(rows, first);
    expect(rows[second]!.kind).toBe('file-header');
    expect(rows[second]!.path).toBe('b.ts');
    expect(prevFileRow(rows, second)).toBe(first);
  });

  test('] on the last file stays in it rather than wrapping to the top', () => {
    const last = rows.map((r) => r.kind).lastIndexOf('file-header');
    expect(rows[nextFileRow(rows, last)]!.path).toBe('b.ts');
  });

  test('n and p land on a finding title, never on its body', () => {
    const found = nextFindingRow(rows, 0);
    const row = rows[found]!;
    expect(row.kind === 'finding' && row.part).toBe('title');
  });

  test('n with no finding ahead leaves the cursor exactly where it was', () => {
    const bare = rowsOf([file('a.ts', 1, 5)]);
    expect(nextFindingRow(bare, 3)).toBe(3);
    expect(prevFindingRow(bare, 3)).toBe(3);
  });

  test('reports the path, unit, and finding under any row', () => {
    expect(pathAtRow(rows, 0)).toBe('a.ts');
    expect(pathAtRow(rows, 9999)).toBeNull();
    expect(unitAtRow(rows, 0)).toBe(0);
    expect(findingAtRow(rows, nextFindingRow(rows, 0))?.id).toBe('f1');
    expect(findingAtRow(rows, 0)).toBeNull();
  });
});

describe('hunkAtRow', () => {
  const rows = rowsOf([file('a.ts', 2, 4, true)], [finding]);

  test('a diff line reports its own hunk', () => {
    const i = rows.findIndex((r) => r.kind === 'diff-line');
    expect(hunkAtRow(rows, i)?.header).toBe('@@ -0,4 +0,4 @@');
  });

  test('a file header borrows the first hunk that was kept', () => {
    expect(hunkAtRow(rows, 0)?.header).toBe('@@ -0,4 +0,4 @@');
  });

  test('a finding row borrows the nearest hunk above it', () => {
    const i = rows.findIndex((r) => r.kind === 'finding');
    expect(hunkAtRow(rows, i)).not.toBeNull();
  });

  test('nothing past the end', () => {
    expect(hunkAtRow(rows, 9999)).toBeNull();
  });
});

describe('unitStartRows', () => {
  test('maps a unit to its first non-blank row', () => {
    const rows = rowsOf([file('a.ts', 1, 3), file('b.ts', 1, 3)]);
    const starts = unitStartRows(rows);
    for (const [unit, row] of starts) {
      expect(rows[row]!.unit).toBe(unit);
      expect(rows[row]!.kind).not.toBe('blank');
    }
  });
});
