import { test, expect, describe } from 'bun:test';
import { checkCoverage, isComplete, reconcile } from '../../../src/core/group/reconcile.js';
import { UNGROUPED_KEY } from '../../../src/core/group/types.js';

const ids = ['h_a', 'h_b', 'h_c'];

describe('checkCoverage', () => {
  test('a grouping that places every hunk once is complete', () => {
    expect(isComplete(checkCoverage([{ hunkIds: ['h_a', 'h_b'] }, { hunkIds: ['h_c'] }], ids))).toBe(true);
  });

  test('reports missing, duplicated, and invented ids separately', () => {
    const report = checkCoverage([{ hunkIds: ['h_a', 'h_x'] }, { hunkIds: ['h_a'], children: [{ hunkIds: [] }] }], ids);
    expect(report.missing).toEqual(['h_b', 'h_c']);
    expect(report.duplicated).toEqual(['h_a']);
    expect(report.unknown).toEqual(['h_x']);
  });

  test('counts ids placed in children', () => {
    expect(isComplete(checkCoverage([{ hunkIds: ['h_a'], children: [{ hunkIds: ['h_b', 'h_c'] }] }], ids))).toBe(true);
  });
});

describe('reconcile', () => {
  test('drops invented ids and keeps a duplicate in the first group that claimed it', () => {
    const groups = reconcile([
      { key: 'one', label: 'One', category: 'core', hunkIds: ['h_a', 'h_x'] },
      { key: 'two', label: 'Two', category: 'tests', hunkIds: ['h_a', 'h_b', 'h_c'] },
    ], ids);
    expect(groups.map((g) => g.hunkIds)).toEqual([['h_a'], ['h_b', 'h_c']]);
  });

  test('anything still unplaced lands in a visible Ungrouped group', () => {
    const groups = reconcile([{ key: 'one', hunkIds: ['h_a'] }], ids);
    const last = groups.at(-1)!;
    expect(last.key).toBe(UNGROUPED_KEY);
    expect(last.hunkIds).toEqual(['h_b', 'h_c']);
  });

  test('a complete grouping gets no Ungrouped group', () => {
    const groups = reconcile([{ key: 'one', hunkIds: ids }], ids);
    expect(groups.some((g) => g.key === UNGROUPED_KEY)).toBe(false);
  });

  test('empty groups disappear and an unknown category becomes other', () => {
    const groups = reconcile([{ key: 'empty', hunkIds: [] }, { key: 'one', category: 'feature', hunkIds: ids }], ids);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe('other');
  });

  test('grandchildren are folded into their parent rather than nested a third level', () => {
    const groups = reconcile([
      { key: 'top', hunkIds: ['h_a'], children: [{ key: 'kid', hunkIds: ['h_b'], children: [{ key: 'grand', hunkIds: ['h_c'] }] }] },
    ], ids);
    const kid = groups[0]!.children[0]!;
    expect(kid.hunkIds).toEqual(['h_b', 'h_c']);
    expect(kid.children).toEqual([]);
  });
});
