import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Group } from './types.js';

export interface CachedGrouping {
  overallSummary: string;
  groups: Group[];
}

export interface GroupCache {
  get(key: string): Promise<CachedGrouping | null>;
  set(key: string, value: CachedGrouping): Promise<void>;
}

/** The grouping answers "how does this whole change divide", so the key is the whole change. */
export function groupingKey(ids: readonly string[], title: string, body: string): string {
  return createHash('sha256')
    .update([...ids].sort().join('\n'))
    .update(`\n${title}\n${body}`)
    .digest('hex');
}

export class MemoryGroupCache implements GroupCache {
  readonly map = new Map<string, CachedGrouping>();
  async get(key: string): Promise<CachedGrouping | null> { return this.map.get(key) ?? null; }
  async set(key: string, value: CachedGrouping): Promise<void> { this.map.set(key, value); }
}

/** One JSON file per repository, like the meat cache; a corrupt file reads as empty. */
export class FileGroupCache implements GroupCache {
  private readonly path: string;
  private loaded: Map<string, CachedGrouping> | null = null;

  constructor(repoSlug: string, rootDir: string = join(homedir(), '.cache', 'marrow', 'groups')) {
    this.path = join(rootDir, `${repoSlug.replace(/\//g, '__')}.json`);
  }

  private async load(): Promise<Map<string, CachedGrouping>> {
    if (this.loaded) return this.loaded;
    try {
      this.loaded = new Map(Object.entries(JSON.parse(await readFile(this.path, 'utf8')) as Record<string, CachedGrouping>));
    } catch {
      this.loaded = new Map();
    }
    return this.loaded;
  }

  async get(key: string): Promise<CachedGrouping | null> {
    return (await this.load()).get(key) ?? null;
  }

  async set(key: string, value: CachedGrouping): Promise<void> {
    const map = await this.load();
    map.set(key, value);
    await mkdir(join(this.path, '..'), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(map)), 'utf8');
    await rename(tmp, this.path);
  }
}
