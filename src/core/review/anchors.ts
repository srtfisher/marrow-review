import type { DiffFile } from '../diff/types.js';
import type { ReviewDraft, Side, StagedComment } from './types.js';

export interface AnchorProblem {
  commentId: string;
  reason: string;
}

/** Line numbers GitHub will accept a comment on, per file and side. */
function anchorableLines(files: DiffFile[]): Map<string, { LEFT: Set<number>; RIGHT: Set<number> }> {
  const map = new Map<string, { LEFT: Set<number>; RIGHT: Set<number> }>();

  for (const file of files) {
    const entry = { LEFT: new Set<number>(), RIGHT: new Set<number>() };
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.oldLine !== null) entry.LEFT.add(line.oldLine);
        if (line.newLine !== null) entry.RIGHT.add(line.newLine);
      }
    }
    map.set(file.path, entry);
  }

  return map;
}

function problem(comment: StagedComment, reason: string): AnchorProblem {
  return { commentId: comment.id, reason };
}

export function findAnchorProblems(
  draft: ReviewDraft,
  files: DiffFile[],
): AnchorProblem[] {
  const anchors = anchorableLines(files);
  const problems: AnchorProblem[] = [];

  for (const comment of draft.comments) {
    const entry = anchors.get(comment.path);
    if (!entry) {
      problems.push(problem(comment, `${comment.path} is not part of this pull request`));
      continue;
    }

    if (comment.startLine !== null && comment.startLine > comment.line) {
      problems.push(problem(comment, 'startLine must not be greater than line'));
      continue;
    }

    const valid: Set<number> = entry[comment.side];
    const lines: number[] =
      comment.startLine === null
        ? [comment.line]
        : Array.from(
            { length: comment.line - comment.startLine + 1 },
            (_, i) => comment.startLine! + i,
          );

    const missing = lines.filter((l) => !valid.has(l));
    if (missing.length > 0) {
      problems.push(
        problem(
          comment,
          `line ${missing[0]} on the ${comment.side} side is not present in the diff for ${comment.path}`,
        ),
      );
    }
  }

  return problems;
}

function describeSide(side: Side): string {
  return side === 'LEFT' ? 'removed line' : 'line';
}

/**
 * Splits a draft into comments GitHub will accept and comments it will not.
 * The rejected ones are folded into the review body rather than discarded — a
 * finding about an unchanged line is still worth telling the author.
 */
export function demoteUnanchorable(
  draft: ReviewDraft,
  files: DiffFile[],
): { draft: ReviewDraft; demoted: StagedComment[] } {
  const problems = findAnchorProblems(draft, files);
  if (problems.length === 0) return { draft, demoted: [] };

  const bad = new Set(problems.map((p) => p.commentId));
  const kept = draft.comments.filter((c) => !bad.has(c.id));
  const demoted = draft.comments.filter((c) => bad.has(c.id));

  const rendered = demoted
    .map(
      (c) =>
        `- **${c.path}** (${describeSide(c.side)} ${c.line}, not in the diff): ${c.body}`,
    )
    .join('\n');

  const body = [draft.body.trim(), '### Additional comments', rendered]
    .filter((part) => part.length > 0)
    .join('\n\n');

  return { draft: { ...draft, body, comments: kept }, demoted };
}
