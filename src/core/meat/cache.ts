import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Hunk } from '../diff/types.js';

export interface CachedVerdict {
  keep: boolean;
  reason: string;
}

export interface VerdictCache {
  get(key: string): Promise<CachedVerdict | null>;
  set(key: string, verdict: CachedVerdict): Promise<void>;
}

/**
 * Content-addressed key for a hunk: the file path plus the kind and text of
 * every line. Line numbers are deliberately excluded — an edit earlier in the
 * file shifts every hunk below it without changing what any of them say, and
 * keying on position would re-judge all of them on every push.
 */
export function hunkKey(filePath: string, hunk: Hunk): string {
  const body = hunk.lines.map((l) => `${l.kind}:${l.text}`).join('\n');
  return createHash('sha256').update(`${filePath}\n${body}`).digest('hex');
}

export class MemoryVerdictCache implements VerdictCache {
  private readonly map = new Map<string, CachedVerdict>();

  async get(key: string): Promise<CachedVerdict | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, verdict: CachedVerdict): Promise<void> {
    this.map.set(key, verdict);
  }
}

export function cacheRoot(): string {
  return join(homedir(), '.cache', 'marrow', 'meat');
}

/**
 * JSON-file-backed cache, one file per repository. Loaded lazily and written
 * atomically. A corrupt file is treated as an empty cache rather than an error —
 * losing cached verdicts costs tokens, not correctness.
 */
export class FileVerdictCache implements VerdictCache {
  private readonly path: string;
  private loaded: Map<string, CachedVerdict> | null = null;

  constructor(repoSlug: string, rootDir: string = cacheRoot()) {
    this.path = join(rootDir, `${repoSlug.replace(/\//g, '__')}.json`);
  }

  private async load(): Promise<Map<string, CachedVerdict>> {
    if (this.loaded) return this.loaded;
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Record<
        string,
        CachedVerdict
      >;
      this.loaded = new Map(Object.entries(parsed));
    } catch {
      this.loaded = new Map();
    }
    return this.loaded;
  }

  async get(key: string): Promise<CachedVerdict | null> {
    return (await this.load()).get(key) ?? null;
  }

  async set(key: string, verdict: CachedVerdict): Promise<void> {
    const map = await this.load();
    map.set(key, verdict);

    await mkdir(join(this.path, '..'), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(map)), 'utf8');
    await rename(tmp, this.path);
  }
}
