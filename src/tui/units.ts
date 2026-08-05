import type { MeatFile, MeatHunk, MeatResult } from '../core/meat/index.js';

export type ReviewUnit =
  | { kind: 'file-header'; file: MeatFile; index: number }
  | { kind: 'hunk'; file: MeatFile; hunk: MeatHunk; index: number }
  | { kind: 'dropped-summary'; file: MeatFile; count: number; index: number };

export interface UnitOptions {
  /** Paths whose dropped hunks are currently revealed (the `z` key). */
  expandedFiles: ReadonlySet<string>;
  /** Paths collapsed to just their header (the Space key). */
  foldedFiles: ReadonlySet<string>;
}

export function buildUnits(result: MeatResult, options: UnitOptions): ReviewUnit[] {
  const units: ReviewUnit[] = [];
  let index = 0;

  for (const file of result.files) {
    const path = file.file.path;
    units.push({ kind: 'file-header', file, index: index++ });

    if (options.foldedFiles.has(path)) continue;

    const expanded = options.expandedFiles.has(path);
    const kept = file.hunks.filter((h) => h.keep);
    const dropped = file.hunks.filter((h) => !h.keep);

    const shown = expanded ? file.hunks : kept;
    for (const hunk of shown) {
      units.push({ kind: 'hunk', file, hunk, index: index++ });
    }

    if (!expanded && dropped.length > 0) {
      units.push({
        kind: 'dropped-summary', file, count: dropped.length, index: index++,
      });
    }
  }

  return units;
}

export function nextFileIndex(units: ReviewUnit[], from: number): number {
  for (let i = from + 1; i < units.length; i += 1) {
    if (units[i]!.kind === 'file-header') return i;
  }
  // Already in the last file: fall back to that file's own header.
  return prevFileIndex(units, from);
}

export function prevFileIndex(units: ReviewUnit[], from: number): number {
  for (let i = from - 1; i >= 0; i -= 1) {
    if (units[i]!.kind === 'file-header') return i;
  }
  return 0;
}
