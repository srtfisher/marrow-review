import type { DiffLine, Hunk } from '../core/diff/types.js';
import type { TriagedFinding } from '../core/findings/triage.js';
import type { Refutation } from '../core/findings/verify.js';
import type { ReviewThread } from '../core/github/types.js';
import type { MeatFile } from '../core/meat/index.js';
import type { CommentAnchor, StagedComment } from '../core/review/types.js';
import { highlightCached, languageFor } from './highlight.js';
import { theme } from './theme.js';
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
  | {
      kind: 'diff-line';
      unit: number;
      path: string;
      hunk: Hunk;
      line: DiffLine;
      /** The code, syntax-coloured. Absent when this file has no grammar. */
      highlighted?: string;
    }
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
      kind: 'comment';
      unit: number;
      path: string;
      comment: StagedComment;
      /** The `● you · R40–R41` line, then one row per wrapped line of body. */
      part: 'head' | 'body';
      text: string;
    }
  | {
      kind: 'composer';
      unit: number;
      path: string;
      view: ComposerView;
      part: 'top' | 'body' | 'bottom';
      /** Which line of the buffer this row draws. Body rows only. */
      lineIndex?: number;
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
 * Everything the composer needs to draw itself, computed by whoever owns the
 * text buffer. The row layer only slices it into rows.
 */
export interface ComposerView {
  /** GitHub's own wording: `Comment on lines R40 to R41`. */
  title: string;
  lines: string[];
  /** Caret position, so the renderer can draw the block cursor. */
  row: number;
  col: number;
  footer: string;
  /** Cells the box occupies, borders included. */
  width: number;
}

/**
 * Greedy wrap to a width, never breaking mid-word unless a single word is
 * longer than the line — in which case it is cut, because the alternative is a
 * row that wraps itself and pushes every row below it out of step with the
 * cursor.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];

  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter((w) => w.length > 0)) {
      let candidate = word;
      while (candidate.length > width) {
        if (line.length > 0) {
          out.push(line);
          line = '';
        }
        out.push(candidate.slice(0, width));
        candidate = candidate.slice(width);
      }
      const joined = line.length === 0 ? candidate : `${line} ${candidate}`;
      if (joined.length > width) {
        out.push(line);
        line = candidate;
      } else {
        line = joined;
      }
    }
    out.push(line);
  }
  return out;
}

/** `R40–R41`, `R29`, `L17` — the side and the lines, in GitHub's shorthand. */
function commentRange(comment: StagedComment): string {
  const mark = comment.side === 'LEFT' ? 'L' : 'R';
  return comment.startLine === null || comment.startLine === comment.line
    ? `${mark}${comment.line}`
    : `${mark}${comment.startLine}–${mark}${comment.line}`;
}

/**
 * The rows a staged comment occupies under the line it is about.
 *
 * The body is wrapped here rather than by the renderer because a row must be
 * exactly one terminal line: a comment that wrapped on screen would push
 * everything below it down and the cursor would stop addressing what the
 * reviewer sees.
 */
function commentRows(
  comment: StagedComment,
  unit: number,
  path: string,
  width: number,
): DetailRow[] {
  const head: DetailRow = {
    kind: 'comment', unit, path, comment, part: 'head',
    text: `${theme.glyph.staged} you · ${commentRange(comment)}`,
  };
  const body = wrapText(comment.body, width).map((text): DetailRow => ({
    kind: 'comment', unit, path, comment, part: 'body', text,
  }));
  return [head, ...body];
}

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

export interface BuildRowsOptions {
  /** Unsubmitted comments, rendered under the lines they are about. */
  staged?: StagedComment[];
  /** Where a comment body wraps. A row may never wrap itself. */
  commentWidth?: number;
  /** Off when the reviewer passed `--no-highlight`. */
  highlight?: boolean;
}

export function buildRows(
  units: ReviewUnit[],
  threads: ReviewThread[],
  showThreads: boolean,
  { staged = [], commentWidth = 80, highlight = true }: BuildRowsOptions = {},
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
    // Once per hunk, and memoized across rebuilds: the row list is rebuilt on
    // every keystroke while a comment is open, and re-tokenizing every visible
    // hunk that often is what separates a responsive pane from a laggy one.
    const language = highlight ? languageFor(path) : null;
    const coloured = language === null
      ? null
      : highlightCached(
        `${path}\u0000${hunk.header}\u0000${hunk.lines.length}`,
        hunk.lines.map((l) => l.text),
        language,
      );

    for (const [at, line] of hunk.lines.entries()) {
      rows.push({
        kind: 'diff-line', unit: index, path, hunk, line, highlighted: coloured?.[at],
      });
      // Your own staged comments live in the diff, under the lines they are
      // about — the same place GitHub keeps them, and the only place a reviewer
      // can weigh a comment against the code it is criticising.
      for (const comment of staged) {
        if (comment.path !== path) continue;
        const anchored = comment.side === 'LEFT' ? line.oldLine : line.newLine;
        if (anchored !== comment.line) continue;
        rows.push(...commentRows(comment, index, path, commentWidth));
      }
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

/**
 * GitHub's own wording for what a comment is attached to. Reused verbatim
 * because a reviewer who has seen it on the web already knows how to read it,
 * and because `R40 to R41` is unambiguous in a way that `40-41` is not.
 */
export function composerTitle(anchor: CommentAnchor): string {
  const mark = anchor.side === 'LEFT' ? 'L' : 'R';
  const start = anchor.startLine;
  return start === null || start === undefined || start === anchor.line
    ? `Comment on line ${mark}${anchor.line}`
    : `Comment on lines ${mark}${start} to ${mark}${anchor.line}`;
}

/**
 * The row an anchor points at, or -1.
 *
 * Resolved from the anchor on every render rather than remembered as an index:
 * folding a file or staging a comment shifts every row below it, and a
 * remembered index would drift the composer away from the line it is about.
 */
export function rowForAnchor(rows: DetailRow[], anchor: CommentAnchor): number {
  return rows.findIndex((row) => (
    row.kind === 'diff-line'
    && row.path === anchor.path
    && (anchor.side === 'LEFT' ? row.line.oldLine : row.line.newLine) === anchor.line
  ));
}

/**
 * The composer, opened under the row it was anchored to.
 *
 * It is spliced into the row list rather than drawn over the pane because the
 * viewport windows on rows: anything that is not a row cannot be scrolled past,
 * and a composer holding a suggestion can easily be taller than the terminal.
 */
export function withComposer(
  rows: DetailRow[],
  afterRow: number,
  view: ComposerView,
): DetailRow[] {
  const anchor = rows[afterRow];
  if (!anchor) return rows;

  const { unit, path } = anchor;
  const composer: DetailRow[] = [
    { kind: 'composer', unit, path, view, part: 'top' },
    ...view.lines.map((_, lineIndex): DetailRow => (
      { kind: 'composer', unit, path, view, part: 'body', lineIndex }
    )),
    { kind: 'composer', unit, path, view, part: 'bottom' },
  ];

  return [...rows.slice(0, afterRow + 1), ...composer, ...rows.slice(afterRow + 1)];
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
/**
 * The comment anchor for a swept range of rows.
 *
 * Rows that are not diff lines — blanks, hunk headers, a finding card — are
 * skipped rather than rejected: a selection that runs across a hunk boundary is
 * a reasonable thing to have done, and refusing it would make `V` feel like it
 * had rules the reviewer could not see.
 *
 * The range is clamped to the file it started in, because GitHub has no
 * cross-file comment. It anchors RIGHT whenever any selected line survives into
 * the post-image, and only falls to LEFT for a run of pure deletions — a range
 * cannot straddle both sides, and a reviewer sweeping a replacement means the
 * version that will exist.
 */
export function rangeAnchor(
  rows: DetailRow[],
  from: number,
  to: number,
): CommentAnchor | null {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);

  const swept: DiffLine[] = [];
  let path: string | null = null;
  for (let i = lo; i <= hi; i += 1) {
    const row = rows[i];
    if (row?.kind !== 'diff-line') continue;
    path ??= row.path;
    if (row.path === path) swept.push(row.line);
  }
  if (path === null) return null;

  const right = swept.map((l) => l.newLine).filter((n) => n !== null);
  const numbers = right.length > 0 ? right : swept.map((l) => l.oldLine).filter((n) => n !== null);
  if (numbers.length === 0) return null;

  const line = Math.max(...numbers);
  const startLine = Math.min(...numbers);
  return {
    path,
    line,
    side: right.length > 0 ? 'RIGHT' : 'LEFT',
    // A one-line "range" is a single-line comment written the long way, and
    // GitHub requires start_line < line. Say it the short way.
    startLine: startLine === line ? null : startLine,
  };
}

export function anchorAtRow(rows: DetailRow[], index: number): CommentAnchor | null {
  const row = rows[index];
  if (!row) return null;
  if (row.kind === 'diff-line') return anchorForLine(row.path, row.line);

  // Rows with no line of their own fall back to a hunk, the same way chat does.
  const hunk = hunkAtRow(rows, index);
  return hunk ? anchorInHunk(row.path, hunk) : null;
}
