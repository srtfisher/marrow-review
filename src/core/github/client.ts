import { Octokit } from '@octokit/rest';
import type {
  PullFilter,
  PullRequestDetail,
  PullRequestSummary,
  PullState,
} from './types.js';

/** The slice of Octokit this client uses, so tests can supply a fake. */
export interface OctokitLike {
  rest: {
    pulls: {
      get(params: Record<string, unknown>): Promise<{ data: unknown }>;
      list(params: Record<string, unknown>): Promise<{ data: unknown }>;
    };
  };
  paginate(fn: unknown, params?: Record<string, unknown>): Promise<unknown[]>;
}

interface RawPull {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  draft?: boolean;
  merged?: boolean;
  // Null on `pulls.list`, real numbers on `pulls.get`. The nullability is the
  // whole point: it is what stops a list summary from claiming a size.
  additions?: number | null;
  deletions?: number | null;
  changed_files?: number | null;
  updated_at: string;
  user: { login: string } | null;
  head: { sha: string; ref: string };
  base: { ref: string };
}

function toState(raw: RawPull): PullState {
  if (raw.merged === true) return 'merged';
  return raw.state === 'closed' ? 'closed' : 'open';
}

function toSummary(raw: RawPull): PullRequestSummary {
  return {
    number: raw.number,
    title: raw.title,
    author: raw.user?.login ?? 'unknown',
    state: toState(raw),
    isDraft: raw.draft === true,
    headSha: raw.head.sha,
    baseRef: raw.base.ref,
    headRef: raw.head.ref,
    updatedAt: raw.updated_at,
  };
}

export class GitHubClient {
  private readonly octokit: OctokitLike;

  constructor(token: string, octokit?: OctokitLike) {
    this.octokit = octokit ?? (new Octokit({ auth: token }) as unknown as OctokitLike);
  }

  async listPulls(
    owner: string,
    repo: string,
    filter: PullFilter,
  ): Promise<PullRequestSummary[]> {
    const state = filter === 'all' ? 'all' : 'open';
    const { data } = await this.octokit.rest.pulls.list({
      owner,
      repo,
      state,
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    });
    return (data as RawPull[]).map(toSummary);
  }

  async getPull(
    owner: string,
    repo: string,
    pull_number: number,
    viewerLogin: string,
  ): Promise<PullRequestDetail> {
    const [detailRes, diffRes] = await Promise.all([
      this.octokit.rest.pulls.get({ owner, repo, pull_number }),
      this.octokit.rest.pulls.get({
        owner,
        repo,
        pull_number,
        mediaType: { format: 'diff' },
      }),
    ]);

    const raw = detailRes.data as RawPull;
    return {
      ...toSummary(raw),
      body: raw.body ?? '',
      diff: String(diffRes.data),
      viewerIsAuthor: (raw.user?.login ?? '') === viewerLogin,
      // Only meaningful here: `pulls.get` is the endpoint that fills them in.
      additions: raw.additions ?? 0,
      deletions: raw.deletions ?? 0,
      changedFiles: raw.changed_files ?? 0,
    };
  }
}
