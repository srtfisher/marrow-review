import { test, expect, describe } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  pruneWorktrees, resolveReviewCheckout, worktreeRoot,
} from '../../../src/core/git/worktree.js';

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

describe('resolveReviewCheckout', () => {
  const repo = { root: '/repo', owner: 'octocat', repo: 'webapp' };
  const createWorktree = async () => ({ path: '/cache/pr', sha: 'abc123' });

  test('uses the current checkout when its clean HEAD is the pull request head', async () => {
    const checkout = await resolveReviewCheckout(repo, 42, 'abc123', {
      run: async (_command, args) => ({
        code: 0,
        stdout: args.includes('rev-parse') ? 'abc123\n' : '',
        stderr: '',
      }),
      createWorktree: async () => {
        throw new Error('a matching checkout must not create a worktree');
      },
    });

    expect(checkout).toEqual({ path: '/repo', sha: 'abc123', kind: 'current' });
  });

  test('creates a worktree when the current checkout is on another commit', async () => {
    const checkout = await resolveReviewCheckout(repo, 42, 'abc123', {
      run: async () => ({ code: 0, stdout: 'different\n', stderr: '' }),
      createWorktree,
    });

    expect(checkout).toEqual({ path: '/cache/pr', sha: 'abc123', kind: 'worktree' });
  });

  test('creates a worktree when local changes could contaminate the review', async () => {
    const checkout = await resolveReviewCheckout(repo, 42, 'abc123', {
      run: async (_command, args) => ({
        code: 0,
        stdout: args.includes('rev-parse') ? 'abc123\n' : ' M src/index.ts\n',
        stderr: '',
      }),
      createWorktree,
    });

    expect(checkout).toEqual({ path: '/cache/pr', sha: 'abc123', kind: 'worktree' });
  });

  test('finds untracked files even when the user git config hides them', async () => {
    const checkout = await resolveReviewCheckout(repo, 42, 'abc123', {
      run: async (_command, args) => ({
        code: 0,
        stdout: args.includes('rev-parse')
          ? 'abc123\n'
          : args.includes('--untracked-files=normal') ? '?? local.txt\n' : '',
        stderr: '',
      }),
      createWorktree,
    });

    expect(checkout).toEqual({ path: '/cache/pr', sha: 'abc123', kind: 'worktree' });
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
