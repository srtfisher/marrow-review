import { test, expect, describe } from 'bun:test';
import { layoutSections } from '../../src/core/group/layout.js';
import type { MeatResult } from '../../src/core/meat/index.js';
import { buildPage, navRows, type ViewOptions } from '../../src/web/lib/rows.js';
import { meatOf } from '../core/group/meat.js';

const view = (over: Partial<ViewOptions> = {}): ViewOptions => ({
  fullDiff: false, revealAll: false, revealed: new Set(), collapsed: new Set(), ...over,
});

function twoLine(meat: MeatResult): MeatResult {
  // A kept hunk with a removed and an added line, to check sides.
  const h = meat.files[0]!.hunks[0]!.hunk;
  h.lines = [
    { kind: 'del', text: 'old', oldLine: 5, newLine: null, noNewlineAtEof: false },
    { kind: 'add', text: 'new', oldLine: null, newLine: 5, noNewlineAtEof: false },
  ];
  return meat;
}

describe('buildPage', () => {
  const meat = meatOf({
    'src/a.ts': [['one', true], ['imp1', false], ['imp2', false], ['two', true]],
    'pnpm-lock.yaml': [['lock', false]],
  });
  const sections = layoutSections(meat, []);

  test('consecutive dropped hunks fold into one strip naming their reasons', () => {
    const blocks = buildPage(meat, sections, view())[0]!.files[0]!.blocks;
    expect(blocks.map((b) => b.kind)).toEqual(['hunk', 'fold', 'hunk']);
    const fold = blocks[1]!;
    expect(fold.kind === 'fold' && fold.hunkIndexes).toEqual([1, 2]);
    expect(fold.kind === 'fold' && fold.reasons).toEqual(['imports-only']);
  });

  test('revealing one hunk shows it marked as dropped', () => {
    const blocks = buildPage(meat, sections, view({ revealed: new Set(['0:1']) }))[0]!.files[0]!.blocks;
    expect(blocks.map((b) => b.kind)).toEqual(['hunk', 'hunk', 'fold', 'hunk']);
    expect(blocks[1]!.kind === 'hunk' && blocks[1]!.dropped).toBe(true);
  });

  test('the full diff shows every hunk', () => {
    const page = buildPage(meat, sections, view({ fullDiff: true }));
    expect(page.flatMap((s) => s.files.flatMap((f) => f.blocks)).every((b) => b.kind === 'hunk')).toBe(true);
  });

  test('a dropped file is one fold until revealed', () => {
    const dropped = buildPage(meat, sections, view()).at(-1)!.files[0]!;
    expect(dropped.blocks.map((b) => b.kind)).toEqual(['fold']);
    const revealed = buildPage(meat, sections, view({ revealed: new Set(['1:*']) })).at(-1)!.files[0]!;
    expect(revealed.blocks.map((b) => b.kind)).toEqual(['hunk']);
  });
});

describe('navRows', () => {
  test('removed lines anchor left by their old number, added lines right by their new one', () => {
    const meat = twoLine(meatOf({ 'a.ts': [['x', true]] }));
    const rows = navRows(buildPage(meat, layoutSections(meat, []), view()));
    expect(rows.map((r) => [r.side, r.number])).toEqual([['LEFT', 5], ['RIGHT', 5]]);
  });

  test('a collapsed file contributes no rows', () => {
    const meat = meatOf({ 'a.ts': [['x', true]], 'b.ts': [['y', true]] });
    const sections = layoutSections(meat, []);
    const rows = navRows(buildPage(meat, sections, view({ collapsed: new Set([`${sections[0]!.key}:0`]) })));
    expect(rows.map((r) => r.path)).toEqual(['b.ts']);
  });

  test('folded hunks contribute no rows', () => {
    const meat = meatOf({ 'a.ts': [['x', true], ['y', false]] });
    expect(navRows(buildPage(meat, layoutSections(meat, []), view()))).toHaveLength(1);
  });
});
