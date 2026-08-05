import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DiffFile } from '../diff/types.js';
import { findAnchorProblems } from '../review/anchors.js';
import type { ReviewDraft, StagedComment } from '../review/types.js';

export interface PersistedReview {
  version: 1;
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  draft: ReviewDraft;
  updatedAt: string;
}

export function stateRoot(): string {
  return join(homedir(), '.local', 'state', 'marrow', 'reviews');
}

export function stateKey(
  owner: string,
  repo: string,
  number: number,
  headSha: string,
): string {
  return `${owner}-${repo}-${number}-${headSha}`.replace(/\//g, '__');
}

/** Prefix identifying every persisted head for one pull request. */
function prPrefix(owner: string, repo: string, number: number): string {
  return `${owner}-${repo}-${number}-`.replace(/\//g, '__');
}

export class ReviewStore {
  constructor(private readonly rootDir: string = stateRoot()) {}

  private pathFor(key: string): string {
    return join(this.rootDir, `${key}.json`);
  }

  async load(
    owner: string,
    repo: string,
    number: number,
    headSha: string,
  ): Promise<PersistedReview | null> {
    try {
      const raw = await readFile(this.pathFor(stateKey(owner, repo, number, headSha)), 'utf8');
      const parsed = JSON.parse(raw) as PersistedReview;
      return parsed.version === 1 ? parsed : null;
    } catch {
      // Missing or corrupt: losing a draft is bad, but throwing here would make
      // the PR unopenable. Report nothing found and let the user start fresh.
      return null;
    }
  }

  async save(record: PersistedReview): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const target = this.pathFor(stateKey(record.owner, record.repo, record.number, record.headSha));
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(record), 'utf8');
    await rename(tmp, target);
  }

  /** Most recent saved draft for this PR at a DIFFERENT head sha. */
  async findPreviousHead(
    owner: string,
    repo: string,
    number: number,
    currentSha: string,
  ): Promise<PersistedReview | null> {
    let entries: string[];
    try {
      entries = await readdir(this.rootDir);
    } catch {
      return null;
    }

    const prefix = prPrefix(owner, repo, number);
    const current = `${stateKey(owner, repo, number, currentSha)}.json`;

    const candidates: PersistedReview[] = [];
    for (const entry of entries) {
      if (!entry.startsWith(prefix) || entry === current) continue;
      try {
        const parsed = JSON.parse(
          await readFile(join(this.rootDir, entry), 'utf8'),
        ) as PersistedReview;
        if (parsed.version === 1) candidates.push(parsed);
      } catch {
        // Skip unreadable records rather than failing the lookup.
      }
    }

    candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return candidates[0] ?? null;
  }

  async clear(owner: string, repo: string, number: number, headSha: string): Promise<void> {
    await rm(this.pathFor(stateKey(owner, repo, number, headSha)), { force: true });
  }
}

/**
 * Splits a previous draft's comments into those whose anchors still resolve
 * against the new diff and those that no longer do. Orphans are returned rather
 * than dropped so the user can re-place or discard them deliberately.
 */
export function carryOver(
  previous: ReviewDraft,
  files: DiffFile[],
): { carried: StagedComment[]; orphaned: StagedComment[] } {
  const problems = findAnchorProblems(previous, files);
  const bad = new Set(problems.map((p) => p.commentId));
  return {
    carried: previous.comments.filter((c) => !bad.has(c.id)),
    orphaned: previous.comments.filter((c) => bad.has(c.id)),
  };
}
