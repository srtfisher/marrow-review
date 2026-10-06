import { test, expect, describe } from 'bun:test';
import { stepFile, stepMarked, stepSection } from '../../src/web/lib/nav.js';
import type { LineRow } from '../../src/web/lib/rows.js';

function r(sectionKey: string, fileIndex: number, i: number): LineRow {
  return {
    key: `${sectionKey}-${fileIndex}-${i}`, sectionKey, fileIndex, hunkIndex: 0, lineIndex: i, path: `${fileIndex}`,
    line: { kind: 'add', text: '', oldLine: null, newLine: i, noNewlineAtEof: false }, side: 'RIGHT', number: i,
  };
}

// section a: file 0 (rows 0-1), file 1 (2-3); section b: file 0 again (4), file 2 (5)
const rows = [r('a', 0, 0), r('a', 0, 1), r('a', 1, 0), r('a', 1, 1), r('b', 0, 2), r('b', 2, 0)];

describe('stepFile', () => {
  test('forward lands on the first row of the next file', () => {
    expect(stepFile(rows, 0, 1)).toBe(2);
    expect(stepFile(rows, 3, 1)).toBe(4);
  });

  test('the same file in another section counts as a different stop', () => {
    expect(stepFile(rows, 1, 1)).toBe(2);
    expect(stepFile(rows, 2, 1)).toBe(4);
  });

  test('back goes to the start of this file first, then the previous one', () => {
    expect(stepFile(rows, 3, -1)).toBe(2);
    expect(stepFile(rows, 2, -1)).toBe(0);
  });

  test('stays put at the last file', () => {
    expect(stepFile(rows, 5, 1)).toBe(5);
  });
});

describe('stepSection', () => {
  test('moves between sections the same way', () => {
    expect(stepSection(rows, 0, 1)).toBe(4);
    expect(stepSection(rows, 5, -1)).toBe(4);
    expect(stepSection(rows, 4, -1)).toBe(0);
  });
});

describe('stepMarked', () => {
  test('wraps around to the next marked row', () => {
    const marked = new Set([rows[1]!.key, rows[4]!.key]);
    expect(stepMarked(rows, 4, marked, 1)).toBe(1);
    expect(stepMarked(rows, 1, marked, -1)).toBe(4);
  });

  test('is -1 when nothing is marked', () => {
    expect(stepMarked(rows, 0, new Set(), 1)).toBe(-1);
  });
});
