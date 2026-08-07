import { test, expect, describe } from 'bun:test';
import {
  buildRows, fileHeaderRow, findingAtRow, hunkAtRow, nearestStop, nextFileRow, nextFindingRow,
  pathAtRow,
  prevFileRow, prevFindingRow, rangeAnchor, unitAtRow, unitStartRows, withComposer,
  type DetailRow,
} from '../../src/tui/rows.js';
import type { StagedComment } from '../../src/core/review/types.js';
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
    keptFiles: files.length, totalFiles: files.length, unclassified: 0, classifierError: null,
  };
}

function rowsOf(
  files: MeatFile[],
  findings: VerifiedFinding[] = [],
  staged: StagedComment[] = [],
  width = 80,
) {
  const meat = meatOf(files);
  return buildRows(
    buildUnits(meat, {
      expandedFiles: new Set(), foldedFiles: new Set(), findings: initTriage(findings),
    }),
    [],
    false,
    { staged, commentWidth: width },
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

  test('the blank between two files belongs to the file above it', () => {
    // The file index reads its current file from the row under the cursor, and
    // an index click resolves a path to the first row carrying it. Labelling
    // the gap with the file it introduces made both point at a row that shows
    // nothing.
    const rows = rowsOf([file('a.ts', 1, 3), file('b.ts', 1, 3)]);
    const blank = rows.findIndex((r) => r.kind === 'blank');
    expect(rows[blank]!.path).toBe('a.ts');
    expect(rows[blank + 1]!.kind).toBe('file-header');
    expect(rows[blank + 1]!.path).toBe('b.ts');
  });

  test('an index click resolves a file to its header, not to the gap above it', () => {
    const rows = rowsOf([file('a.ts', 1, 3), file('b.ts', 1, 3)]);
    expect(rows[rows.findIndex((r) => r.path === 'b.ts')]!.kind).toBe('file-header');
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

  test('] on the last file stays put rather than walking backwards', () => {
    // It used to fall back to the previous header, so ] at the end of the diff
    // went backwards and the next press went forwards — ping-ponging between
    // the last two files. `n` and `p` already hold still; so does this.
    const last = rows.map((r) => r.kind).lastIndexOf('file-header');
    expect(nextFileRow(rows, last)).toBe(last);
  });

  test('[ on the first file stays put rather than snapping to row zero', () => {
    const first = rows.findIndex((r) => r.kind === 'file-header');
    expect(prevFileRow(rows, first)).toBe(first);
    // From inside the first file it still reaches that file's own header.
    expect(prevFileRow(rows, first + 2)).toBe(first);
  });

  test('p walks back through the findings', () => {
    // Inherited from units.test.ts, which owned the only two-finding backward
    // walk until its copy of this navigation was deleted. The `describe`'s
    // shared `rows` carries one finding, which cannot show a walk.
    const two = rowsOf(
      [file('a.ts', 1, 5), file('b.ts', 1, 5)],
      [finding, { ...finding, id: 'f2', path: 'b.ts' }],
    );
    const first = nextFindingRow(two, 0);
    const second = nextFindingRow(two, first);
    expect(findingAtRow(two, first)?.id).toBe('f1');
    expect(findingAtRow(two, second)?.id).toBe('f2');
    expect(prevFindingRow(two, second)).toBe(first);
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

describe('fileHeaderRow', () => {
  // a.ts: 0 header, 1 hunk-header, 2-4 lines. 5 blank. b.ts: 6 header.
  const rows = rowsOf([file('a.ts', 1, 3), file('b.ts', 1, 3)]);

  test('finds a file by path rather than by the row it used to be on', () => {
    expect(fileHeaderRow(rows, 'a.ts')).toBe(0);
    expect(fileHeaderRow(rows, 'b.ts')).toBe(6);
  });

  test('answers null for a path not in the diff, which is not row 0', () => {
    expect(fileHeaderRow(rows, 'c.ts')).toBeNull();
  });

  test('does not answer with a body row that carries the same path', () => {
    // Every row of a file carries its path; only the header is the file.
    expect(rows[fileHeaderRow(rows, 'b.ts')!]!.kind).toBe('file-header');
  });
});

describe('nearestStop', () => {
  // a.ts: 0 header, 1 hunk-header, 2-4 lines. 5 blank. b.ts: 6 header, 7 hunk-header, 8-10 lines.
  const rows = rowsOf([file('a.ts', 1, 3), file('b.ts', 1, 3)]);

  test('leaves a row that is already a place alone', () => {
    expect(nearestStop(rows, 4, 1)).toBe(4);
    expect(nearestStop(rows, 4, -1)).toBe(4);
  });

  test('going down off a file lands on the next file, not the gap', () => {
    expect(rows[5]!.kind).toBe('blank');
    expect(nearestStop(rows, 5, 1)).toBe(6);
    expect(rows[6]!.kind).toBe('file-header');
  });

  test('coming back up lands on the previous file last line, not the gap', () => {
    expect(nearestStop(rows, 5, -1)).toBe(4);
    expect(rows[4]!.kind).toBe('diff-line');
  });

  test('falls back the other way when the preferred direction runs out', () => {
    // A list that ends on the blank: there is nothing below it to land on.
    const truncated = rows.slice(0, 6);
    expect(nearestStop(truncated, 5, 1)).toBe(4);
  });

  test('gives back the index it was handed when nothing is a place', () => {
    const allBlank: DetailRow[] = [{ kind: 'blank', unit: 0, path: 'a.ts' }];
    expect(nearestStop(allBlank, 0, 1)).toBe(0);
    expect(nearestStop([], 3, 1)).toBe(3);
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

function del(n: number): DiffLine {
  return { kind: 'del', text: `gone ${n}`, oldLine: n, newLine: null, noNewlineAtEof: false };
}

/** One file, one hunk, exactly the lines given. */
function fileOf(path: string, lines: DiffLine[]): MeatFile {
  return {
    file: {
      path, oldPath: null, status: 'modified', similarity: null,
      hunks: [], additions: 0, deletions: 0,
    },
    dropped: null,
    hunks: [{
      hunk: {
        header: '@@ -1,9 +1,9 @@', section: '',
        oldStart: 1, oldLines: lines.length, newStart: 1, newLines: lines.length,
        lines,
      },
      keep: true, reason: 'meaningful', source: 'model' as const,
    }],
  };
}

/** Row indices of the diff lines, so a test can name "the second line". */
function diffRows(rows: ReturnType<typeof rowsOf>): number[] {
  return rows.flatMap((r, i) => (r.kind === 'diff-line' ? [i] : []));
}

describe('rangeAnchor', () => {
  test('a one-row range is a single-line comment, not a range', () => {
    const rows = rowsOf([fileOf('a.ts', [add(40), add(41)])]);
    const [first] = diffRows(rows);

    // startLine null rather than equal to line: GitHub wants start_line < line,
    // and payload.ts normalizes the long way round back to this anyway.
    expect(rangeAnchor(rows, first!, first!)).toEqual({
      path: 'a.ts', line: 40, side: 'RIGHT', startLine: null,
    });
  });

  test('spans the rows it was given', () => {
    const rows = rowsOf([fileOf('a.ts', [add(40), add(41), add(42)])]);
    const lines = diffRows(rows);

    expect(rangeAnchor(rows, lines[0]!, lines[2]!)).toEqual({
      path: 'a.ts', line: 42, side: 'RIGHT', startLine: 40,
    });
  });

  test('reads the same swept upward as swept downward', () => {
    const rows = rowsOf([fileOf('a.ts', [add(40), add(41), add(42)])]);
    const lines = diffRows(rows);

    expect(rangeAnchor(rows, lines[2]!, lines[0]!))
      .toEqual(rangeAnchor(rows, lines[0]!, lines[2]!));
  });

  test('anchors a replacement on the right, where the new code is', () => {
    const rows = rowsOf([fileOf('a.ts', [del(7), add(40), del(8), add(41)])]);
    const lines = diffRows(rows);

    // A range cannot straddle both sides, and the reviewer sweeping a
    // replacement means the version that will exist.
    expect(rangeAnchor(rows, lines[0]!, lines[3]!)).toEqual({
      path: 'a.ts', line: 41, side: 'RIGHT', startLine: 40,
    });
  });

  test('falls to the left when nothing selected survives into the new file', () => {
    const rows = rowsOf([fileOf('a.ts', [del(7), del(8)])]);
    const lines = diffRows(rows);

    expect(rangeAnchor(rows, lines[0]!, lines[1]!)).toEqual({
      path: 'a.ts', line: 8, side: 'LEFT', startLine: 7,
    });
  });

  test('stops at the file it started in — GitHub has no cross-file comment', () => {
    const rows = rowsOf([fileOf('a.ts', [add(1), add(2)]), fileOf('b.ts', [add(9)])]);

    expect(rangeAnchor(rows, 0, rows.length - 1)).toEqual({
      path: 'a.ts', line: 2, side: 'RIGHT', startLine: 1,
    });
  });

  test('ignores the rows between hunks rather than refusing the range', () => {
    const rows = rowsOf([file('a.ts', 2, 2)]);
    const lines = diffRows(rows);

    // The blank and the second hunk header sit inside this sweep. Sweeping
    // across a hunk boundary is a reasonable thing to have done.
    const anchor = rangeAnchor(rows, lines[0]!, lines.at(-1)!);
    expect(anchor?.path).toBe('a.ts');
    expect(anchor?.startLine).toBe(0);
    expect(anchor?.line).toBe(21);
  });

  test('is null when the range holds no diff line at all', () => {
    const rows = rowsOf([file('a.ts', 1, 2)]);
    // The file header and the hunk header, and nothing else.
    expect(rangeAnchor(rows, 0, 1)).toBeNull();
  });
});

function staged(over: Partial<StagedComment> = {}): StagedComment {
  return {
    id: 'c1', path: 'a.ts', line: 41, side: 'RIGHT', startLine: null,
    body: 'this rotates the JWT on every keystroke', suggestion: null, ...over,
  };
}

function commentRows(rows: DetailRow[]) {
  return rows.filter((r) => r.kind === 'comment');
}

describe('staged comments in the diff', () => {
  const file = () => fileOf('a.ts', [add(40), add(41), add(42)]);

  test('sits under the line it is about, not at the end of the hunk', () => {
    const rows = rowsOf([file()], [], [staged()]);
    const at = rows.findIndex((r) => r.kind === 'comment');
    const above = rows[at - 1];

    expect(above?.kind).toBe('diff-line');
    expect(above?.kind === 'diff-line' && above.line.newLine).toBe(41);
  });

  test('names the range so you can see what it covers', () => {
    expect(commentRows(rowsOf([file()], [], [staged()]))[0]).toMatchObject({
      part: 'head', text: expect.stringContaining('R41'),
    });
    expect(commentRows(rowsOf([file()], [], [staged({ startLine: 40 })]))[0]).toMatchObject({
      part: 'head', text: expect.stringContaining('R40–R41'),
    });
  });

  test('anchors a deletion comment to the old line number', () => {
    const rows = rowsOf(
      [fileOf('a.ts', [del(7), del(8)])],
      [],
      [staged({ line: 8, side: 'LEFT' })],
    );
    expect(commentRows(rows)[0]?.text).toContain('L8');
  });

  test('wraps the body so no row ever has to wrap itself', () => {
    const rows = rowsOf([file()], [], [staged({ body: 'a'.repeat(30) })], 12);
    const body = commentRows(rows).filter((r) => r.part === 'body');

    expect(body.length).toBeGreaterThan(1);
    for (const row of body) expect(row.text.length).toBeLessThanOrEqual(12);
  });

  test('two comments on one line both show, in the order they were made', () => {
    const rows = rowsOf([file()], [], [
      staged({ id: 'c1', body: 'first' }),
      staged({ id: 'c2', body: 'second' }),
    ]);
    const bodies = commentRows(rows).filter((r) => r.part === 'body').map((r) => r.text.trim());
    expect(bodies).toEqual(['first', 'second']);
  });

  test('a comment on a line that is not shown renders nowhere', () => {
    // It is not lost — the submit screen still lists it. There is simply no
    // line here to put it under.
    expect(commentRows(rowsOf([file()], [], [staged({ line: 999 })]))).toHaveLength(0);
  });

  test('no staged comments means no comment rows at all', () => {
    expect(commentRows(rowsOf([file()]))).toHaveLength(0);
  });
});

describe('syntax colouring reaches the rows', () => {
  const units = () => buildUnits(meatOf([fileOf('a.ts', [add(1)])]), {
    expandedFiles: new Set(), foldedFiles: new Set(),
  });

  test('a diff line carries the coloured text', () => {
    const row = buildRows(units(), [], false).find((r) => r.kind === 'diff-line');
    expect(row?.kind === 'diff-line' && row.highlighted).toBeDefined();
  });

  test('and carries none of it when highlighting is off', () => {
    const rows = buildRows(units(), [], false, { highlight: false });
    const row = rows.find((r) => r.kind === 'diff-line');
    expect(row?.kind === 'diff-line' && row.highlighted).toBeUndefined();
  });

  test('nor for a file no grammar knows', () => {
    const rows = buildRows(
      buildUnits(meatOf([fileOf('LICENSE', [add(1)])]), {
        expandedFiles: new Set(), foldedFiles: new Set(),
      }),
      [], false,
    );
    const row = rows.find((r) => r.kind === 'diff-line');
    expect(row?.kind === 'diff-line' && row.highlighted).toBeUndefined();
  });
});

describe('withComposer', () => {
  const view = {
    title: 'Comment on lines R40 to R41',
    lines: ['```suggestion', 'const x = 1;', '```'],
    row: 1, col: 12, footer: '^d save · ^o editor · esc cancel', width: 40,
  };

  test('opens under the row it was anchored to', () => {
    const rows = rowsOf([fileOf('a.ts', [add(40), add(41)])]);
    const at = rows.findIndex((r) => r.kind === 'diff-line' && r.line.newLine === 41);
    const next = withComposer(rows, at, view);

    expect(next[at]).toBe(rows[at]!);
    expect(next[at + 1]).toMatchObject({ kind: 'composer', part: 'top' });
  });

  test('is a border, a row per line of the body, and a border', () => {
    const rows = rowsOf([fileOf('a.ts', [add(40)])]);
    const composer = withComposer(rows, 2, view).filter((r) => r.kind === 'composer');

    expect(composer.map((r) => r.part)).toEqual(['top', 'body', 'body', 'body', 'bottom']);
    // Exactly one terminal row each, which is the invariant the whole row model
    // exists to protect.
    expect(composer.filter((r) => r.part === 'body').map((r) => r.lineIndex)).toEqual([0, 1, 2]);
  });

  test('leaves every other row exactly where it was', () => {
    const rows = rowsOf([fileOf('a.ts', [add(40), add(41)])]);
    const next = withComposer(rows, 2, view);

    expect(next.filter((r) => r.kind !== 'composer') as DetailRow[]).toEqual(rows);
  });
});
