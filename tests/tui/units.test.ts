import { test, expect, describe } from 'bun:test';
import {
  buildUnits, nextFileIndex, nextFindingIndex, prevFileIndex, prevFindingIndex,
} from '../../src/tui/units.js';
import { initTriage } from '../../src/core/findings/triage.js';
import type { TriagedFinding } from '../../src/core/findings/triage.js';
import type { VerifiedFinding } from '../../src/core/findings/verify.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import type { DiffFile, Hunk } from '../../src/core/diff/types.js';

function finding(id: string, path: string, line: number, title: string): TriagedFinding {
  const [f] = initTriage([{
    id, path, line, side: 'RIGHT', startLine: null,
    severity: 'important', title, body: 'body', confidence: 'high',
    suggestion: null, verdict: 'confirmed', refutations: [],
  } satisfies VerifiedFinding]);
  return f!;
}

function hunk(text: string): Hunk {
  return hunkAt(text, 1);
}

/** Like `hunk`, but at a chosen post-image line, so tests can control
 *  whether a finding's anchor falls inside or outside its range. */
function hunkAt(text: string, newLine: number): Hunk {
  return {
    header: `@@ ${text} @@`,
    section: '',
    oldStart: newLine,
    oldLines: 1,
    newStart: newLine,
    newLines: 1,
    lines: [{ kind: 'add', text, oldLine: null, newLine, noNewlineAtEof: false }],
  };
}

function diffFile(path: string): DiffFile {
  return {
    path, oldPath: null, status: 'modified', similarity: null,
    hunks: [], additions: 1, deletions: 0,
  };
}

function meatFile(path: string, keeps: number, drops: number): MeatFile {
  return {
    file: diffFile(path),
    dropped: null,
    hunks: [
      ...Array.from({ length: keeps }, (_, i) => ({
        hunk: hunk(`keep${i}`), keep: true, reason: 'logic', source: 'model' as const,
      })),
      ...Array.from({ length: drops }, (_, i) => ({
        hunk: hunk(`drop${i}`), keep: false, reason: 'imports-only', source: 'rule' as const,
      })),
    ],
  };
}

function result(files: MeatFile[]): MeatResult {
  return {
    summary: 's', files,
    keptLines: 0, totalLines: 0, keptFiles: 0, totalFiles: files.length,
  };
}

const none = { expandedFiles: new Set<string>(), foldedFiles: new Set<string>() };

describe('buildUnits', () => {
  test('emits a header then kept hunks then one dropped summary', () => {
    const units = buildUnits(result([meatFile('a.ts', 2, 3)]), none);
    expect(units.map((u) => u.kind)).toEqual([
      'file-header', 'hunk', 'hunk', 'dropped-summary',
    ]);
    const summary = units[3]!;
    expect(summary.kind === 'dropped-summary' && summary.count).toBe(3);
  });

  test('omits the dropped summary when nothing was dropped', () => {
    const units = buildUnits(result([meatFile('a.ts', 2, 0)]), none);
    expect(units.map((u) => u.kind)).toEqual(['file-header', 'hunk', 'hunk']);
  });

  test('expanding a file turns dropped hunks into real units', () => {
    const opts = { expandedFiles: new Set(['a.ts']), foldedFiles: new Set<string>() };
    const units = buildUnits(result([meatFile('a.ts', 1, 2)]), opts);
    expect(units.map((u) => u.kind)).toEqual(['file-header', 'hunk', 'hunk', 'hunk']);
  });

  test('a folded file shows only its header', () => {
    const opts = { expandedFiles: new Set<string>(), foldedFiles: new Set(['a.ts']) };
    const units = buildUnits(result([meatFile('a.ts', 2, 1)]), opts);
    expect(units.map((u) => u.kind)).toEqual(['file-header']);
  });

  test('a rule-dropped whole file still gets a header so it is never invisible', () => {
    const dropped: MeatFile = {
      file: diffFile('pnpm-lock.yaml'),
      dropped: { drop: true, rule: 'lockfile' },
      hunks: [],
    };
    const units = buildUnits(result([dropped]), none);
    expect(units).toHaveLength(1);
    expect(units[0]!.kind).toBe('file-header');
  });

  test('assigns sequential indexes across files', () => {
    const units = buildUnits(result([meatFile('a.ts', 1, 0), meatFile('b.ts', 1, 0)]), none);
    expect(units.map((u) => u.index)).toEqual([0, 1, 2, 3]);
  });
});

describe('findings placement', () => {
  // Two kept hunks: one anchored at line 5, one at line 20.
  function twoHunkFile(): MeatFile {
    return {
      file: diffFile('a.ts'),
      dropped: null,
      hunks: [
        { hunk: hunkAt('first', 5), keep: true, reason: 'logic', source: 'model' },
        { hunk: hunkAt('second', 20), keep: true, reason: 'logic', source: 'model' },
      ],
    };
  }

  test('places a finding immediately after the hunk containing its anchor', () => {
    const f = finding('f1', 'a.ts', 20, 'Busy-wait');
    const units = buildUnits(result([twoHunkFile()]), { ...none, findings: [f] });

    expect(units.map((u) => u.kind)).toEqual(['file-header', 'hunk', 'hunk', 'finding']);
    const last = units[3]!;
    expect(last.kind === 'finding' && last.finding.id).toBe('f1');
  });

  test('a finding whose anchor matches no shown hunk still appears', () => {
    const f = finding('f2', 'a.ts', 999, 'Orphaned');
    const units = buildUnits(result([twoHunkFile()]), { ...none, findings: [f] });

    expect(units.map((u) => u.kind)).toEqual(['file-header', 'hunk', 'hunk', 'finding']);
    const last = units[3]!;
    expect(last.kind === 'finding' && last.finding.id).toBe('f2');
  });
});

describe('file navigation', () => {
  const units = buildUnits(
    result([meatFile('a.ts', 2, 0), meatFile('b.ts', 2, 0), meatFile('c.ts', 1, 0)]),
    none,
  );
  // indexes: 0 hdr(a) 1 hunk 2 hunk 3 hdr(b) 4 hunk 5 hunk 6 hdr(c) 7 hunk

  test('nextFileIndex jumps to the following header', () => {
    expect(nextFileIndex(units, 1)).toBe(3);
    expect(nextFileIndex(units, 3)).toBe(6);
  });

  test('nextFileIndex stays put at the last file', () => {
    expect(nextFileIndex(units, 7)).toBe(6);
  });

  test('prevFileIndex jumps to the preceding header', () => {
    expect(prevFileIndex(units, 5)).toBe(3);
    expect(prevFileIndex(units, 3)).toBe(0);
  });

  test('prevFileIndex stays put at the first file', () => {
    expect(prevFileIndex(units, 0)).toBe(0);
  });
});

describe('finding navigation', () => {
  const withFindings = buildUnits(
    result([meatFile('a.ts', 2, 0), meatFile('b.ts', 1, 0)]),
    { ...none, findings: [finding('f1', 'a.ts', 1, 'One'), finding('f2', 'b.ts', 1, 'Two')] },
  );
  // 0 hdr(a) 1 hunk 2 finding 3 hunk 4 finding? — both a.ts hunks anchor at
  // line 1, so f1 lands after the first, and f2 after b.ts's only hunk.
  const findingIndexes = withFindings
    .map((u, i) => (u.kind === 'finding' ? i : -1))
    .filter((i) => i >= 0);

  test('n walks forward through the findings', () => {
    expect(findingIndexes).toHaveLength(2);
    expect(nextFindingIndex(withFindings, 0)).toBe(findingIndexes[0]!);
    expect(nextFindingIndex(withFindings, findingIndexes[0]!)).toBe(findingIndexes[1]!);
  });

  test('p walks back through the findings', () => {
    expect(prevFindingIndex(withFindings, findingIndexes[1]!)).toBe(findingIndexes[0]!);
  });

  test('the cursor holds still when there is no finding that way', () => {
    expect(nextFindingIndex(withFindings, findingIndexes[1]!)).toBe(findingIndexes[1]!);
    expect(prevFindingIndex(withFindings, findingIndexes[0]!)).toBe(findingIndexes[0]!);
  });

  test('a diff with no findings at all never moves the cursor', () => {
    const plain = buildUnits(result([meatFile('a.ts', 2, 0)]), none);
    expect(nextFindingIndex(plain, 1)).toBe(1);
    expect(prevFindingIndex(plain, 1)).toBe(1);
  });
});
