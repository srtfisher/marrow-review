export type Verdict = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

/** RIGHT anchors to the post-image, LEFT to a deleted line in the pre-image. */
export type Side = 'LEFT' | 'RIGHT';

export interface StagedComment {
  /** Stable local id; not sent to GitHub. */
  id: string;
  path: string;
  /** End line of the comment, in the side's numbering. */
  line: number;
  side: Side;
  /** Start line for a multi-line comment, else null. */
  startLine: number | null;
  body: string;
  /**
   * Replacement code for a GitHub suggestion block. For a multi-line
   * suggestion the line range must cover exactly the lines being replaced.
   */
  suggestion: string | null;
}

export interface ReviewDraft {
  verdict: Verdict | null;
  body: string;
  comments: StagedComment[];
}
