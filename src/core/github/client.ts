import { Octokit } from '@octokit/rest';
import type { GraphQlFn } from './graphql.js';
import type {
  PullFilter,
  PullRequestDetail,
  PullRequestSummary,
  PullState,
  RequestedPull,
} from './types.js';

/** The slice of Octokit this client uses, so tests can supply a fake. */
export interface OctokitLike {
  rest: {
    pulls: {
      get(params: Record<string, unknown>): Promise<{ data: unknown }>;
      list(params: Record<string, unknown>): Promise<{ data: unknown }>;
      listCommits?(params: Record<string, unknown>): Promise<{ data: unknown }>;
    };
  };
  paginate(fn: unknown, params?: Record<string, unknown>): Promise<unknown[]>;
  graphql?: GraphQlFn;
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
  html_url?: string;
  user: { login: string } | null;
  head: { sha: string; ref: string };
  base: { ref: string; sha?: string };
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
    htmlUrl: raw.html_url ?? '',
  };
}

// `pulls.list` cannot filter by reviewer, so review requests come from search,
// which also matches requests made of a team the viewer is on.
export const REVIEW_REQUESTS_QUERY = `
query ReviewRequests($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title isDraft updatedAt url
        headRefName headRefOid baseRefName
        author { login }
        repository { name owner { login } }
      }
    }
  }
}`;

interface RawSearchPull {
  number?: number;
  title: string;
  isDraft: boolean;
  updatedAt: string;
  url: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  author: { login: string } | null;
  repository: { name: string; owner: { login: string } };
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
    if (filter === 'review-requested') return this.listReviewRequests({ owner, repo });
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

  /** Open pull requests awaiting the viewer's review, across every repository unless one is named. */
  async listReviewRequests(scope?: { owner: string; repo: string }): Promise<RequestedPull[]> {
    if (!this.octokit.graphql) return [];
    const q = ['is:pr', 'is:open', 'archived:false', 'review-requested:@me', 'sort:updated-desc'];
    if (scope) q.push(`repo:${scope.owner}/${scope.repo}`);
    const raw = (await this.octokit.graphql(REVIEW_REQUESTS_QUERY, { q: q.join(' ') })) as {
      search?: { nodes?: RawSearchPull[] };
    };
    // A search hit that is not a pull request comes back as an empty node.
    return (raw.search?.nodes ?? []).flatMap((n) => (n.number === undefined ? [] : [{
      number: n.number,
      title: n.title,
      author: n.author?.login ?? 'unknown',
      state: 'open' as const,
      isDraft: n.isDraft,
      headSha: n.headRefOid,
      baseRef: n.baseRefName,
      headRef: n.headRefName,
      updatedAt: n.updatedAt,
      htmlUrl: n.url,
      owner: n.repository.owner.login,
      repo: n.repository.name,
    }]));
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
      owner,
      repo,
      baseSha: raw.base.sha ?? '',
      body: raw.body ?? '',
      diff: String(diffRes.data),
      viewerIsAuthor: (raw.user?.login ?? '') === viewerLogin,
      // Only meaningful here: `pulls.get` is the endpoint that fills them in.
      additions: raw.additions ?? 0,
      deletions: raw.deletions ?? 0,
      changedFiles: raw.changed_files ?? 0,
    };
  }

  /** First lines of the PR's commit messages, oldest first. Empty on failure: they are a hint. */
  async listCommitSubjects(owner: string, repo: string, pull_number: number): Promise<string[]> {
    const list = this.octokit.rest.pulls.listCommits;
    if (!list) return [];
    try {
      const { data } = await list({ owner, repo, pull_number, per_page: 100 });
      return (data as Array<{ commit: { message: string } }>).map((c) => c.commit.message.split('\n')[0] ?? '');
    } catch {
      return [];
    }
  }
}
