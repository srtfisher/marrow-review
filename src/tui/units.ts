import type { Hunk } from '../core/diff/types.js';
import type { TriagedFinding } from '../core/findings/triage.js';
import type { MeatFile, MeatHunk, MeatResult } from '../core/meat/index.js';

export type ReviewUnit =
  | { kind: 'file-header'; file: MeatFile; index: number }
  | { kind: 'hunk'; file: MeatFile; hunk: MeatHunk; index: number }
  | { kind: 'dropped-summary'; file: MeatFile; count: number; index: number }
  | { kind: 'finding'; file: MeatFile; finding: TriagedFinding; index: number };

export interface UnitOptions {
  /** Paths whose dropped hunks are currently revealed (the `z` key). */
  expandedFiles: ReadonlySet<string>;
  /** Paths collapsed to just their header (the Space key). */
  foldedFiles: ReadonlySet<string>;
  /** AI findings to interleave into the diff, nearest their anchor. */
  findings?: TriagedFinding[];
}

/** Whether a finding's anchor line falls inside this hunk, on the finding's
 *  own side (RIGHT anchors to the post-image line numbers, LEFT to the
 *  pre-image). A hunk with no line on that side can never contain it. */
function hunkContainsAnchor(hunk: Hunk, finding: TriagedFinding): boolean {
  const lines = hunk.lines
    .map((l) => (finding.side === 'RIGHT' ? l.newLine : l.oldLine))
    .filter((n): n is number => n !== null);
  if (lines.length === 0) return false;
  return finding.line >= Math.min(...lines) && finding.line <= Math.max(...lines);
}

export function buildUnits(result: MeatResult, options: UnitOptions): ReviewUnit[] {
  const units: ReviewUnit[] = [];
  const allFindings = options.findings ?? [];
  let index = 0;

  for (const file of result.files) {
    const path = file.file.path;
    units.push({ kind: 'file-header', file, index: index++ });

    if (options.foldedFiles.has(path)) continue;

    const expanded = options.expandedFiles.has(path);
    const kept = file.hunks.filter((h) => h.keep);
    const dropped = file.hunks.filter((h) => !h.keep);

    const shown = expanded ? file.hunks : kept;
    const fileFindings = allFindings.filter((f) => f.path === path);
    const placed = new Set<string>();

    for (const hunk of shown) {
      units.push({ kind: 'hunk', file, hunk, index: index++ });
      for (const finding of fileFindings) {
        if (placed.has(finding.id)) continue;
        if (hunkContainsAnchor(hunk.hunk, finding)) {
          units.push({ kind: 'finding', file, finding, index: index++ });
          placed.add(finding.id);
        }
      }
    }

    // A finding whose anchor matches no shown hunk still has to surface
    // somewhere — a finding nobody can see is worse than one in a slightly
    // odd place — so it lands after this file's last hunk.
    for (const finding of fileFindings) {
      if (!placed.has(finding.id)) {
        units.push({ kind: 'finding', file, finding, index: index++ });
        placed.add(finding.id);
      }
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

/**
 * Findings do not wrap and do not fall back to a neighbour the way file
 * navigation does: with none in the diff, or none left in this direction, the
 * cursor stays exactly where the reviewer left it rather than teleporting.
 */
export function nextFindingIndex(units: ReviewUnit[], from: number): number {
  for (let i = from + 1; i < units.length; i += 1) {
    if (units[i]!.kind === 'finding') return i;
  }
  return from;
}

export function prevFindingIndex(units: ReviewUnit[], from: number): number {
  for (let i = from - 1; i >= 0; i -= 1) {
    if (units[i]!.kind === 'finding') return i;
  }
  return from;
}
