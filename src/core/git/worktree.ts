import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultRunner, type CommandRunner } from '../github/auth.js';
import type { RepoContext } from './repo.js';

export interface Worktree {
  path: string;
  sha: string;
}

export function worktreeRoot(): string {
  return join(homedir(), '.cache', 'marrow', 'worktrees');
}

function worktreePath(repo: RepoContext, sha: string): string {
  return join(worktreeRoot(), `${repo.owner}-${repo.repo}-${sha.slice(0, 12)}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches the PR head into the local clone and checks it out in a detached
 * worktree. Reuses an existing worktree for the same SHA. Throws on failure —
 * callers degrade to diff-only mode rather than treating this as fatal.
 */
export async function ensureWorktree(
  repo: RepoContext,
  prNumber: number,
  sha: string,
  run: CommandRunner = defaultRunner,
): Promise<Worktree> {
  const path = worktreePath(repo, sha);
  if (await exists(path)) return { path, sha };

  const fetch = await run('git', [
    '-C',
    repo.root,
    'fetch',
    'origin',
    `refs/pull/${prNumber}/head`,
  ]);
  if (fetch.code !== 0) {
    throw new Error(`git fetch failed for PR #${prNumber}`);
  }

  await mkdir(worktreeRoot(), { recursive: true });

  const add = await run('git', [
    '-C',
    repo.root,
    'worktree',
    'add',
    '--detach',
    path,
    sha,
  ]);
  if (add.code !== 0) {
    throw new Error(`git worktree add failed for ${sha}`);
  }

  return { path, sha };
}

/** Removes worktree directories untouched for longer than maxAgeDays. */
export async function pruneWorktrees(
  maxAgeDays: number,
  now: Date = new Date(),
): Promise<number> {
  const root = worktreeRoot();
  if (!(await exists(root))) return 0;

  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const entry of await readdir(root)) {
    const path = join(root, entry);
    const info = await stat(path);
    if (info.mtimeMs < cutoff) {
      await rm(path, { recursive: true, force: true });
      removed += 1;
    }
  }

  return removed;
}
