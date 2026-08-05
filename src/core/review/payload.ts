import type { DiffFile } from '../diff/types.js';
import { findAnchorProblems } from './anchors.js';
import type { ReviewDraft, Side, StagedComment, Verdict } from './types.js';

export interface PayloadComment {
  path: string;
  line: number;
  side: Side;
  start_line?: number;
  start_side?: Side;
  body: string;
}

export interface ReviewPayload {
  event: Verdict;
  body: string;
  comments: PayloadComment[];
}

export function renderCommentBody(comment: StagedComment): string {
  if (comment.suggestion === null) return comment.body;
  return `${comment.body}\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``;
}

/**
 * Builds the createReview payload, applying every rule GitHub applies.
 *
 * GitHub rejects a review atomically — one bad anchor or one empty body discards
 * every comment in it — so this throws locally rather than letting the API 422
 * after the user has already committed to submitting.
 */
export function buildReviewPayload(draft: ReviewDraft, files: DiffFile[]): ReviewPayload {
  if (draft.verdict === null) {
    throw new Error('Cannot build a review payload without a verdict.');
  }

  // GitHub requires a review body for anything other than an approval.
  if (draft.verdict !== 'APPROVE' && draft.body.trim().length === 0) {
    throw new Error(
      `Cannot submit: a ${draft.verdict} review needs a body. GitHub only accepts an empty body on APPROVE.`,
    );
  }

  for (const c of draft.comments) {
    if (renderCommentBody(c).trim().length === 0) {
      throw new Error(
        `Cannot submit: the comment on ${c.path}:${c.line} is empty. GitHub rejects a comment with no body.`,
      );
    }
  }

  const problems = findAnchorProblems(draft, files);
  if (problems.length > 0) {
    throw new Error(
      `Cannot submit: ${problems.length} comment(s) have invalid anchors. First: ${problems[0]!.reason}`,
    );
  }

  const comments: PayloadComment[] = draft.comments.map((c) => {
    const base: PayloadComment = {
      path: c.path,
      line: c.line,
      side: c.side,
      body: renderCommentBody(c),
    };
    // GitHub requires start_line < line. A one-line "range" is the same thing as
    // a single-line comment, so send it as one rather than failing the review.
    if (c.startLine !== null && c.startLine !== c.line) {
      base.start_line = c.startLine;
      base.start_side = c.side;
    }
    return base;
  });

  return { event: draft.verdict, body: draft.body, comments };
}
