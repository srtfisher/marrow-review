import type { DiffLine, Hunk } from '../core/diff/types.js';
import type { TriagedFinding } from '../core/findings/triage.js';
import type { Refutation } from '../core/findings/verify.js';
import type { ReviewThread } from '../core/github/types.js';
import type { MeatFile } from '../core/meat/index.js';
import type { CommentAnchor } from '../core/review/types.js';
import type { ReviewUnit } from './units.js';

/**
 * One terminal row of the detail pane.
 *
 * The pane used to window on *units* — a file header, a whole hunk, a finding
 * card — which meant a thousand-line hunk was one indivisible item. A pane with
 * a forty-row budget could only ever show it by showing nothing else, so
 * opening a large pull request rendered a single file path into an empty
 * screen. Rows are the fix: they are what the terminal actually draws, so the
 * viewport can start and end anywhere.
 *
 * Rows are also what the cursor addresses, which is what makes commenting on an
 * individual line possible at all. `unit` is retained because triage, folding,
 * and chat still act on the unit a row belongs to.
 */
export type DetailRow =
  | { kind: 'blank'; unit: number; path: string }
  | { kind: 'file-header'; unit: number; path: string; file: MeatFile }
  | { kind: 'hunk-header'; unit: number; path: string; hunk: Hunk; reason: string }
  | { kind: 'diff-line'; unit: number; path: string; hunk: Hunk; line: DiffLine }
  | { kind: 'thread'; unit: number; path: string; author: string; body: string }
  | {
      kind: 'dropped-summary';
      unit: number;
      path: string;
      file: MeatFile;
      count: number;
      reasons: string[];
    }
  | {
      kind: 'finding';
      unit: number;
      path: string;
      finding: TriagedFinding;
      part: 'title' | 'body' | 'suggestion' | 'refutation';
      refutation?: Refutation;
    };

/**
 * Reading is tight, navigating breathes: no blank rows inside a hunk, one
 * before every hunk after a file's first, and one before every file after the
 * first. A finding sits flush under the hunk it is about, because it is part of
 * reading that hunk rather than the next thing to navigate to.
 */
function leadsWithBlank(units: ReviewUnit[], index: number): boolean {
  const unit = units[index];
  if (!unit || index === 0) return false;
  if (unit.kind === 'file-header') return true;
  if (unit.kind === 'finding') return false;
  return units[index - 1]!.kind !== 'file-header';
}

export function buildRows(
  units: ReviewUnit[],
  threads: ReviewThread[],
  showThreads: boolean,
): DetailRow[] {
  const rows: DetailRow[] = [];

  units.forEach((unit, index) => {
    const path = unit.file.file.path;
    if (leadsWithBlank(units, index)) rows.push({ kind: 'blank', unit: index, path });

    if (unit.kind === 'file-header') {
      rows.push({ kind: 'file-header', unit: index, path, file: unit.file });
      return;
    }

    if (unit.kind === 'dropped-summary') {
      const reasons = [...new Set(unit.file.hunks.filter((h) => !h.keep).map((h) => h.reason))];
      rows.push({
        kind: 'dropped-summary', unit: index, path, file: unit.file, count: unit.count, reasons,
      });
      return;
    }

    if (unit.kind === 'finding') {
      const finding = unit.finding;
      rows.push({ kind: 'finding', unit: index, path, finding, part: 'title' });
      rows.push({ kind: 'finding', unit: index, path, finding, part: 'body' });
      if (finding.suggestion !== null) {
        rows.push({ kind: 'finding', unit: index, path, finding, part: 'suggestion' });
      }
      if (finding.verdict === 'refuted') {
        for (const refutation of finding.refutations) {
          rows.push({ kind: 'finding', unit: index, path, finding, part: 'refutation', refutation });
        }
      }
      return;
    }

    const hunk = unit.hunk.hunk;
    rows.push({ kind: 'hunk-header', unit: index, path, hunk, reason: unit.hunk.reason });
    for (const line of hunk.lines) {
      rows.push({ kind: 'diff-line', unit: index, path, hunk, line });
    }
    if (showThreads) {
      for (const thread of threads.filter((t) => t.path === path)) {
        for (const comment of thread.comments) {
          rows.push({
            kind: 'thread', unit: index, path, author: comment.author, body: comment.body,
          });
        }
      }
    }
  });

  return rows;
}

/** Row indices where each unit begins — how a unit-keyed action finds its row. */
export function unitStartRows(rows: DetailRow[]): Map<number, number> {
  const starts = new Map<number, number>();
  rows.forEach((row, i) => {
    if (row.kind === 'blank') return;
    if (!starts.has(row.unit)) starts.set(row.unit, i);
  });
  return starts;
}

function seek(
  rows: DetailRow[],
  from: number,
  dir: 1 | -1,
  match: (row: DetailRow) => boolean,
): number | null {
  for (let i = from + dir; i >= 0 && i < rows.length; i += dir) {
    if (match(rows[i]!)) return i;
  }
  return null;
}

const isFileHeader = (row: DetailRow) => row.kind === 'file-header';
const isFindingTitle = (row: DetailRow) => row.kind === 'finding' && row.part === 'title';

/** Next/previous file header. Falls back to this file's own header at the end,
 *  matching how `]` has always behaved. */
export function nextFileRow(rows: DetailRow[], from: number): number {
  return seek(rows, from, 1, isFileHeader) ?? prevFileRow(rows, from);
}

export function prevFileRow(rows: DetailRow[], from: number): number {
  return seek(rows, from, -1, isFileHeader) ?? 0;
}

/**
 * Findings do not wrap and do not fall back to a neighbour the way file
 * navigation does: with none in the diff, or none left in this direction, the
 * cursor stays exactly where the reviewer left it rather than teleporting.
 */
export function nextFindingRow(rows: DetailRow[], from: number): number {
  return seek(rows, from, 1, isFindingTitle) ?? from;
}

export function prevFindingRow(rows: DetailRow[], from: number): number {
  return seek(rows, from, -1, isFindingTitle) ?? from;
}

export function pathAtRow(rows: DetailRow[], index: number): string | null {
  return rows[index]?.path ?? null;
}

export function unitAtRow(rows: DetailRow[], index: number): number | null {
  return rows[index]?.unit ?? null;
}

export function findingAtRow(rows: DetailRow[], index: number): TriagedFinding | null {
  const row = rows[index];
  return row?.kind === 'finding' ? row.finding : null;
}

/**
 * The hunk a row is about.
 *
 * Rows with no hunk of their own fall back rather than resolving to nothing: a
 * file header borrows its file's first kept hunk, and a finding or thread row
 * borrows the nearest hunk above it. A key that silently does nothing on a
 * third of the rows in the pane reads as a broken key.
 */
export function hunkAtRow(rows: DetailRow[], index: number): Hunk | null {
  const row = rows[index];
  if (!row) return null;
  if (row.kind === 'hunk-header' || row.kind === 'diff-line') return row.hunk;

  if (row.kind === 'file-header' || row.kind === 'dropped-summary') {
    const first = row.file.hunks.find((h) => h.keep) ?? row.file.hunks[0];
    return first?.hunk ?? null;
  }

  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = rows[i]!;
    if (prev.kind === 'diff-line' || prev.kind === 'hunk-header') return prev.hunk;
  }
  return null;
}

function anchorForLine(path: string, line: DiffLine): CommentAnchor | null {
  // Side follows which image the line exists on. A deleted line has no
  // post-image number, so it can only be commented on the LEFT — anchoring it
  // RIGHT is the mistake GitHub rejects the entire review for.
  if (line.newLine !== null) return { path, line: line.newLine, side: 'RIGHT' };
  if (line.oldLine !== null) return { path, line: line.oldLine, side: 'LEFT' };
  return null;
}

function anchorInHunk(path: string, hunk: Hunk): CommentAnchor | null {
  // The last changed line is where a reader's eye ends up, and it is always
  // anchorable; a context line often is too, but it is rarely what was meant.
  const changed = hunk.lines.filter((l) => l.kind !== 'context');
  const line = changed.at(-1) ?? hunk.lines.at(-1);
  return line ? anchorForLine(path, line) : null;
}

/**
 * The comment anchor for the row under the cursor.
 *
 * On a diff line this is that exact line — the whole point of a row cursor, and
 * what makes `C` mean "comment on this line" rather than "comment somewhere in
 * this hunk". Everywhere else it degrades to the enclosing hunk, and on a file
 * header to that file's first hunk, so a comment is never simply refused.
 */
export function anchorAtRow(rows: DetailRow[], index: number): CommentAnchor | null {
  const row = rows[index];
  if (!row) return null;
  if (row.kind === 'diff-line') return anchorForLine(row.path, row.line);

  // Rows with no line of their own fall back to a hunk, the same way chat does.
  const hunk = hunkAtRow(rows, index);
  return hunk ? anchorInHunk(row.path, hunk) : null;
}
