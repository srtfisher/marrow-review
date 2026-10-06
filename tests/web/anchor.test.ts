import { test, expect, describe } from 'bun:test';
import { placeByRow, rangeAnchor, suggestionText } from '../../src/web/lib/anchor.js';
import type { LineRow } from '../../src/web/lib/rows.js';

function row(fileIndex: number, i: number, side: 'LEFT' | 'RIGHT', number: number, text = `l${i}`): LineRow {
  return {
    key: `${fileIndex}:0:${i}`, sectionKey: 's', fileIndex, hunkIndex: 0, lineIndex: i, path: `f${fileIndex}.ts`,
    line: { kind: side === 'LEFT' ? 'del' : 'add', text, oldLine: side === 'LEFT' ? number : null, newLine: side === 'RIGHT' ? number : null, noNewlineAtEof: false },
    side, number,
  };
}

const rows = [row(0, 0, 'RIGHT', 10, 'a'), row(0, 1, 'RIGHT', 11, 'b'), row(0, 2, 'LEFT', 7), row(0, 3, 'RIGHT', 12, 'c'), row(1, 0, 'RIGHT', 1)];

describe('rangeAnchor', () => {
  test('a single row is a single-line comment', () => {
    expect(rangeAnchor(rows, '0:0:1', '0:0:1')).toEqual({ path: 'f0.ts', side: 'RIGHT', line: 11, startLine: null });
  });

  test('a range spans the end side, whichever way it was dragged', () => {
    expect(rangeAnchor(rows, '0:0:3', '0:0:0')).toEqual({ path: 'f0.ts', side: 'RIGHT', line: 12, startLine: 10 });
  });

  test('a range ending on a removed line anchors left', () => {
    expect(rangeAnchor(rows, '0:0:0', '0:0:2')!.side).toBe('LEFT');
  });

  test('a range across files is refused', () => {
    expect(rangeAnchor(rows, '0:0:3', '1:0:0')).toBeNull();
  });
});

describe('suggestionText', () => {
  test('prefills the new-side lines of the range', () => {
    expect(suggestionText(rows, { path: 'f0.ts', side: 'RIGHT', line: 12, startLine: 10 })).toBe('a\nb\nc');
  });

  test('offers nothing on the left side', () => {
    expect(suggestionText(rows, { path: 'f0.ts', side: 'LEFT', line: 7, startLine: null })).toBeNull();
  });
});

describe('placeByRow', () => {
  test('puts items under their row and returns what has no row', () => {
    const { byRow, unplaced } = placeByRow(rows, [
      { id: 'a', path: 'f0.ts', side: 'RIGHT' as const, line: 11 },
      { id: 'b', path: 'f0.ts', side: 'RIGHT' as const, line: 99 },
      { id: 'c', path: 'f0.ts', line: null },
    ]);
    expect(byRow.get('0:0:1')!.map((i) => i.id)).toEqual(['a']);
    expect(unplaced.map((i) => i.id)).toEqual(['b', 'c']);
  });
});
