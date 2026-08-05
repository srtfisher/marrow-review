import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileVerdictCache,
  MemoryVerdictCache,
  hunkKey,
} from '../../../src/core/meat/cache.js';
import type { Hunk } from '../../../src/core/diff/types.js';

function hunk(text: string): Hunk {
  return {
    header: '@@ -1,1 +1,1 @@',
    section: '',
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: [{ kind: 'add', text, oldLine: null, newLine: 1, noNewlineAtEof: false }],
  };
}

test('hunkKey is stable for identical content', () => {
  expect(hunkKey('a.ts', hunk('x'))).toBe(hunkKey('a.ts', hunk('x')));
});

test('hunkKey changes with content, path, or position', () => {
  expect(hunkKey('a.ts', hunk('x'))).not.toBe(hunkKey('a.ts', hunk('y')));
  expect(hunkKey('a.ts', hunk('x'))).not.toBe(hunkKey('b.ts', hunk('x')));

  const moved = { ...hunk('x'), newStart: 99 };
  expect(hunkKey('a.ts', hunk('x'))).not.toBe(hunkKey('a.ts', moved));
});

test('MemoryVerdictCache round-trips', async () => {
  const cache = new MemoryVerdictCache();
  expect(await cache.get('k')).toBeNull();
  await cache.set('k', { keep: true, reason: 'core logic' });
  expect(await cache.get('k')).toEqual({ keep: true, reason: 'core logic' });
});

test('FileVerdictCache persists across instances', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'marrow-cache-'));
  try {
    const first = new FileVerdictCache('srtfisher/marrow', dir);
    await first.set('abc', { keep: false, reason: 'noise' });

    const second = new FileVerdictCache('srtfisher/marrow', dir);
    expect(await second.get('abc')).toEqual({ keep: false, reason: 'noise' });

    const otherRepo = new FileVerdictCache('other/repo', dir);
    expect(await otherRepo.get('abc')).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FileVerdictCache survives a corrupt cache file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'marrow-cache-'));
  try {
    const cache = new FileVerdictCache('srtfisher/marrow', dir);
    await cache.set('abc', { keep: true, reason: 'ok' });
    await Bun.write(join(dir, 'srtfisher__marrow.json'), '{not json');

    const reopened = new FileVerdictCache('srtfisher/marrow', dir);
    expect(await reopened.get('abc')).toBeNull();
    await reopened.set('def', { keep: true, reason: 'recovered' });
    expect(await reopened.get('def')).toEqual({ keep: true, reason: 'recovered' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
