export type PullState = 'open' | 'closed' | 'merged';
export type PullFilter = 'open' | 'review-requested' | 'all';

export interface PullRequestSummary {
  number: number;
  title: string;
  author: string;
  state: PullState;
  isDraft: boolean;
  headSha: string;
  baseRef: string;
  headRef: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface PullRequestDetail extends PullRequestSummary {
  body: string;
  /** Raw unified diff, as served by GitHub. */
  diff: string;
  viewerIsAuthor: boolean;
}

export interface ReviewThreadComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewThread {
  path: string;
  line: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  comments: ReviewThreadComment[];
}

export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'skipped'
  | null;

export interface CheckRun {
  name: string;
  status: string;
  conclusion: CheckConclusion;
  detailsUrl: string | null;
  /** Summary text, when the check provided one. */
  output: string | null;
}
