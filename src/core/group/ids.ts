import { createHash } from 'node:crypto';
import type { Hunk } from '../diff/types.js';
import { changedLineCounts, type MeatResult } from '../meat/index.js';

/**
 * Content-derived, so the same hunk has the same id on every run and a grouping
 * can be cached. The header is included — two identical bodies at different
 * places in one file are two hunks a reviewer reads separately.
 */
export function hunkId(path: string, hunk: Hunk): string {
  const body = hunk.lines.map((l) => `${l.kind}:${l.text}`).join('\n');
  return `h_${createHash('sha256').update(`${path}\n${hunk.header}\n${body}`).digest('hex').slice(0, 10)}`;
}

export interface KeptHunk {
  id: string;
  path: string;
  /** Position in the file's hunk list, so a caller can find the meat hunk again. */
  index: number;
  hunk: Hunk;
  additions: number;
  deletions: number;
}

export function keptHunks(meat: MeatResult): KeptHunk[] {
  return meat.files.flatMap((f) =>
    f.hunks.flatMap((h, index) => {
      if (!h.keep) return [];
      const { additions, deletions } = changedLineCounts(h.hunk);
      return [{ id: hunkId(f.file.path, h.hunk), path: f.file.path, index, hunk: h.hunk, additions, deletions }];
    }),
  );
}
