export type PullState = 'open' | 'closed' | 'merged';
export type PullFilter = 'open' | 'review-requested' | 'all';

/**
 * What `pulls.list` actually returns. Deliberately no size figures: GitHub
 * sends `null` for `additions`, `deletions`, and `changed_files` on the list
 * endpoint — they exist only on `pulls.get`, one request per pull request. A
 * `changedFiles: number` here was always a confident zero, which is how the
 * list came to read `0 files` for every entry.
 */
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
  htmlUrl: string;
}

export interface PullRequestDetail extends PullRequestSummary {
  owner: string;
  repo: string;
  baseSha: string;
  body: string;
  /** Raw unified diff, as served by GitHub. */
  diff: string;
  viewerIsAuthor: boolean;
  /** Real figures: these come back from `pulls.get`, unlike on the list. */
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface ReviewThreadComment {
  author: string;
  avatarUrl?: string | null;
  body: string;
  /** GitHub's own rendering, so the page shows a thread exactly as github.com does. */
  bodyHtml?: string | null;
  createdAt: string;
  url?: string | null;
}

export interface ReviewThread {
  path: string;
  line: number | null;
  side?: 'LEFT' | 'RIGHT';
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
