import { test, expect } from 'bun:test';
import { FILE_CHARS, FILES_TOTAL_CHARS, filesToRead, numbered, readChangedFiles } from '../../../src/core/findings/context.js';
import type { MeatResult } from '../../../src/core/meat/index.js';

test('numbers every line, padded so the text lines up', () => {
  expect(numbered(Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n')).split('\n')[0]).toBe(' 1  l1');
});

test('reads files with the most kept change first and skips deleted and fully dropped ones', () => {
  const file = (path: string, status: string, keep: boolean, lines: number) => ({
    file: { path, status }, dropped: null,
    hunks: [{ keep, hunk: { lines: Array.from({ length: lines }, () => ({ kind: 'add' })) } }],
  });
  const meat = { files: [file('small.ts', 'modified', true, 2), file('big.ts', 'added', true, 9), file('gone.ts', 'deleted', true, 5), file('noise.ts', 'modified', false, 50)] } as unknown as MeatResult;
  expect(filesToRead(meat)).toEqual(['big.ts', 'small.ts']);
});

test('lists a file over the budget instead of cutting it', async () => {
  const sizes: Record<string, number> = { 'a.ts': 10, 'huge.ts': FILE_CHARS + 1, 'b.ts': 10 };
  const { files, omitted } = await readChangedFiles(Object.keys(sizes), async (p) => 'x'.repeat(sizes[p]!));
  expect(files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
  expect(omitted).toEqual(['huge.ts']);
});

test('stops adding files once the total is spent', async () => {
  const each = Math.floor(FILE_CHARS * 0.9);
  const paths = Array.from({ length: Math.ceil(FILES_TOTAL_CHARS / each) + 1 }, (_, i) => `f${i}.ts`);
  const { files, omitted } = await readChangedFiles(paths, async () => 'x'.repeat(each));
  expect(files.length * each).toBeLessThanOrEqual(FILES_TOTAL_CHARS);
  expect(omitted.length).toBeGreaterThan(0);
});

test('a file that cannot be read is skipped, not fatal', async () => {
  const { files } = await readChangedFiles(['a.ts', 'b.ts'], async (p) => { if (p === 'a.ts') throw new Error('404'); return 'ok'; });
  expect(files.map((f) => f.path)).toEqual(['b.ts']);
});
