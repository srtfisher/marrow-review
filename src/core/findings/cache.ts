import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Finding } from './types.js';
import type { Score } from './score.js';

/**
 * Finished review results, so a restart or a reopen does not pay for the same
 * answer again. Holds two kinds of entry under one key space: one reviewer's
 * findings and one finding's score. Failures are never stored.
 */
export interface FindingsCache {
  getFindings(key: string): Promise<Finding[] | null>;
  setFindings(key: string, findings: Finding[]): Promise<void>;
  getScore(key: string): Promise<Score | null>;
  setScore(key: string, score: Score): Promise<void>;
}

function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

/** Everything the find pass reads goes into the key, so a different input can never hit. */
export function findingsKey(model: string, systemPrompt: string, prompt: string): string {
  return hash(['find', model, systemPrompt, prompt]);
}

export function scoreKey(model: string, prompt: string): string {
  return hash(['score', model, prompt]);
}

type Entry = { findings: Finding[] } | { score: Score };

abstract class EntryCache implements FindingsCache {
  protected abstract read(key: string): Promise<Entry | null>;
  protected abstract write(key: string, entry: Entry): Promise<void>;

  async getFindings(key: string): Promise<Finding[] | null> {
    const entry = await this.read(key);
    return entry && 'findings' in entry ? entry.findings : null;
  }

  async setFindings(key: string, findings: Finding[]): Promise<void> {
    await this.write(key, { findings });
  }

  async getScore(key: string): Promise<Score | null> {
    const entry = await this.read(key);
    return entry && 'score' in entry ? entry.score : null;
  }

  async setScore(key: string, score: Score): Promise<void> {
    await this.write(key, { score });
  }
}

export class MemoryFindingsCache extends EntryCache {
  private readonly map = new Map<string, Entry>();

  protected async read(key: string): Promise<Entry | null> {
    return this.map.get(key) ?? null;
  }

  protected async write(key: string, entry: Entry): Promise<void> {
    this.map.set(key, entry);
  }
}

export function findingsCacheRoot(): string {
  return join(homedir(), '.cache', 'marrow', 'findings');
}

/** One JSON file per repository, written atomically. A corrupt file reads as empty: it costs tokens, not correctness. */
export class FileFindingsCache extends EntryCache {
  private readonly path: string;
  private loaded: Map<string, Entry> | null = null;

  constructor(repoSlug: string, rootDir: string = findingsCacheRoot()) {
    super();
    this.path = join(rootDir, `${repoSlug.replace(/\//g, '__')}.json`);
  }

  private async load(): Promise<Map<string, Entry>> {
    if (this.loaded) return this.loaded;
    try {
      this.loaded = new Map(Object.entries(JSON.parse(await readFile(this.path, 'utf8')) as Record<string, Entry>));
    } catch {
      this.loaded = new Map();
    }
    return this.loaded;
  }

  protected async read(key: string): Promise<Entry | null> {
    return (await this.load()).get(key) ?? null;
  }

  protected async write(key: string, entry: Entry): Promise<void> {
    const map = await this.load();
    map.set(key, entry);
    await mkdir(join(this.path, '..'), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(map)), 'utf8');
    await rename(tmp, this.path);
  }
}
