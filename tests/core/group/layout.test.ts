import { test, expect, describe } from 'bun:test';
import { hunkId } from '../../../src/core/group/ids.js';
import { DROPPED_KEY, layoutSections } from '../../../src/core/group/layout.js';
import type { Group } from '../../../src/core/group/types.js';
import { meatOf } from './meat.js';

function group(key: string, hunkIds: string[], children: Group[] = []): Group {
  return { key, label: key, summary: '', category: 'core', hunkIds, children };
}

describe('layoutSections', () => {
  const meat = meatOf({
    'src/a.ts': [['one', true], ['import', false], ['two', true]],
    'pnpm-lock.yaml': [['lock', false]],
  });
  const id = (fi: number, hi: number) => hunkId(meat.files[fi]!.file.path, meat.files[fi]!.hunks[hi]!.hunk);

  test('a file split across groups appears in both and says so', () => {
    const sections = layoutSections(meat, [group('first', [id(0, 0)]), group('second', [id(0, 2)])]);
    const [first, second] = sections;
    expect(first!.files[0]!.alsoIn).toEqual(['second']);
    expect(second!.files[0]!.alsoIn).toEqual(['first']);
  });

  test('a dropped hunk sits beside the nearest kept hunk of its file', () => {
    const sections = layoutSections(meat, [group('first', [id(0, 0)]), group('second', [id(0, 2)])]);
    // Index 1 is equidistant; the earlier kept hunk wins.
    expect(sections[0]!.files[0]!.hunks).toEqual([0, 1]);
    expect(sections[1]!.files[0]!.hunks).toEqual([2]);
  });

  test('a file with nothing kept goes to the dropped section, last', () => {
    const sections = layoutSections(meat, [group('all', [id(0, 0), id(0, 2)])]);
    const last = sections.at(-1)!;
    expect(last.key).toBe(DROPPED_KEY);
    expect(last.files.map((f) => f.path)).toEqual(['pnpm-lock.yaml']);
  });

  test('before any grouping exists, everything kept reads as one section', () => {
    const sections = layoutSections(meat, []);
    expect(sections[0]!.label).toBe('All changes');
    expect(sections[0]!.files[0]!.hunks).toEqual([0, 1, 2]);
  });

  test('children follow their parent at depth one', () => {
    const sections = layoutSections(meat, [group('parent', [id(0, 0)], [group('kid', [id(0, 2)])])]);
    expect(sections.map((s) => [s.key, s.depth])).toEqual([['parent', 0], ['kid', 1], [DROPPED_KEY, 0]]);
  });
});
