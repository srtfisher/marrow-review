import type { Hunk } from '../../../src/core/diff/types.js';
import type { MeatFile, MeatResult } from '../../../src/core/meat/index.js';

export function hunk(text: string, start = 1): Hunk {
  return {
    header: `@@ -${start},1 +${start},1 @@`, section: '', oldStart: start, oldLines: 1, newStart: start, newLines: 1,
    lines: [{ kind: 'add', text, oldLine: null, newLine: start, noNewlineAtEof: false }],
  };
}

/** `spec` maps a path to its hunks as [text, keep] pairs. */
export function meatOf(spec: Record<string, Array<[string, boolean]>>, summary = 'Summary.'): MeatResult {
  const files: MeatFile[] = Object.entries(spec).map(([path, hunks]) => ({
    file: { path, oldPath: null, status: 'modified', similarity: null, hunks: hunks.map(([t], i) => hunk(t, i * 10 + 1)), additions: hunks.length, deletions: 0 },
    dropped: hunks.every(([, keep]) => !keep) ? { rule: 'lockfile' } as never : null,
    hunks: hunks.map(([t, keep], i) => ({ hunk: hunk(t, i * 10 + 1), keep, reason: keep ? 'logic' : 'imports-only', source: 'rule' as const })),
  }));
  return {
    summary, files, keptLines: 0, totalLines: 0, keptAdditions: 0, keptDeletions: 0,
    totalAdditions: 0, totalDeletions: 0, keptFiles: 0, totalFiles: files.length, unclassified: 0, classifierError: null,
  };
}
