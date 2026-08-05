import { test, expect, describe } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneWorktrees, worktreeRoot } from '../../../src/core/git/worktree.js';

const DAY = 24 * 60 * 60 * 1000;

async function cacheWith(ages: Record<string, number>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'marrow-wt-'));
  for (const [name, daysOld] of Object.entries(ages)) {
    const path = join(root, name);
    await mkdir(path, { recursive: true });
    const when = new Date(Date.now() - daysOld * DAY);
    await utimes(path, when, when);
  }
  return root;
}

describe('worktreeRoot', () => {
  test('lives under the cache directory, not the state directory', () => {
    expect(worktreeRoot()).toContain(join('.cache', 'marrow', 'worktrees'));
  });
});

describe('pruneWorktrees', () => {
  test('removes stale checkouts and keeps fresh ones', async () => {
    const root = await cacheWith({ stale: 30, fresh: 1 });
    try {
      const removed = await pruneWorktrees(7, new Date(), { root });
      expect(removed).toBe(1);
      expect(await readdir(root)).toEqual(['fresh']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('clears the registrations it just invalidated', async () => {
    // Deleting the directory is only half the job — git keeps the worktree on
    // its books, and `worktree add` at that path then fails with "missing but
    // already registered", which would strand marrow in diff-only mode.
    const root = await cacheWith({ stale: 30 });
    const commands: string[][] = [];
    try {
      await pruneWorktrees(7, new Date(), {
        root,
        repoRoot: '/repo',
        run: async (cmd, args) => {
          commands.push([cmd, ...args]);
          return { code: 0, stdout: '', stderr: '' };
        },
      });
      expect(commands).toEqual([['git', '-C', '/repo', 'worktree', 'prune']]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('does not shell out when it removed nothing', async () => {
    const root = await cacheWith({ fresh: 1 });
    const commands: string[][] = [];
    try {
      const removed = await pruneWorktrees(7, new Date(), {
        root,
        repoRoot: '/repo',
        run: async (cmd, args) => {
          commands.push([cmd, ...args]);
          return { code: 0, stdout: '', stderr: '' };
        },
      });
      expect(removed).toBe(0);
      expect(commands).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a cache that was never created is not an error', async () => {
    expect(await pruneWorktrees(7, new Date(), { root: join(tmpdir(), 'marrow-absent-cache') }))
      .toBe(0);
  });
});
