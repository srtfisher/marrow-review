import { readFileSync } from 'node:fs';
import { EMPTY_USAGE } from '../../../src/core/agent/types.js';
import { join } from 'node:path';
import type { AgentRequest, AgentRun, AgentTransport } from '../../../src/core/agent/types.js';
import { FINDINGS_SCHEMA } from '../../../src/core/findings/schema.js';
import { VERIFY_SCHEMA } from '../../../src/core/findings/verify.js';
import type { PullRequestDetail } from '../../../src/core/github/types.js';
import { MemoryGroupCache } from '../../../src/core/group/cache.js';
import { MemoryVerdictCache } from '../../../src/core/meat/cache.js';
import { ReviewSession, type SessionDeps } from '../../../src/core/session/session.js';
import { readOnlyAccess, type ResolvedSource } from '../../../src/core/source/index.js';
import type { PersistedReview } from '../../../src/core/store/review.js';

const diff = readFileSync(join(import.meta.dir, '../../fixtures/diffs/modify.diff'), 'utf8');

export const finding = {
  path: 'src/app.ts', line: 14, side: 'RIGHT', startLine: null, severity: 'blocking',
  type: 'Correctness', kind: 'issue', title: 'Errors reach nothing', body: 'fail is undefined here.',
  failureScenario: 'A listen error calls an undefined fail().', confidence: 'high', suggestion: null,
};

function run(structured: unknown): AgentRun {
  return { text: '', structured, sessionId: 's', usage: { ...EMPTY_USAGE, numTurns: 1 }, usageWarning: null };
}

/** Answers by pass rather than by call order, since grouping and find run concurrently. */
export class RoutingTransport implements AgentTransport {
  readonly requests: AgentRequest[] = [];
  constructor(private readonly findings: unknown[] = [finding], private readonly fail = false) {}
  async run(req: AgentRequest): Promise<AgentRun> {
    this.requests.push(req);
    if (req.schema === FINDINGS_SCHEMA) {
      if (this.fail) throw new Error('rate limited');
      return run({ findings: this.findings });
    }
    if (req.schema === VERIFY_SCHEMA) return run({ refuted: false, reasoning: 'holds' });
    if (req.schema) return run({ summary: 'Handles server errors.', verdicts: [] });
    return { ...run(null), text: 'An answer.', sessionId: 'chat-1' };
  }
}

export class MemoryStore {
  saved: PersistedReview[] = [];
  cleared = 0;
  constructor(private readonly existing: PersistedReview | null = null) {}
  async load() { return this.existing; }
  async save(r: PersistedReview) { this.saved.push(r); }
  async findPreviousHead() { return null; }
  async clear() { this.cleared += 1; }
}

export const pr: PullRequestDetail = {
  number: 42, title: 'Handle server errors', author: 'hubot', state: 'open', isDraft: false,
  headSha: 'abc1234', baseRef: 'main', headRef: 'fix', updatedAt: 'now', htmlUrl: 'https://github.com/o/r/pull/42',
  owner: 'o', repo: 'r', baseSha: 'base123', body: 'Body.', diff, viewerIsAuthor: false,
  additions: 2, deletions: 1, changedFiles: 1,
};

export const resolved: ResolvedSource = {
  source: { kind: 'worktree', canSearch: true, access: readOnlyAccess('/tmp/wt'), readHead: async () => null },
  degraded: null,
};

export function deps(over: Partial<SessionDeps> = {}): SessionDeps & { submitted: unknown[] } {
  const submitted: unknown[] = [];
  return {
    submitted,
    client: { getPull: async () => pr, listCommitSubjects: async () => [] },
    graphql: async () => ({ repository: { pullRequest: { reviewThreads: { nodes: [] }, reviews: { nodes: [] }, commits: { nodes: [] } } } }),
    contents: { rest: { repos: { getContent: async () => { throw Object.assign(new Error('nf'), { status: 404 }); } } } },
    submitter: { rest: { pulls: { createReview: async (p: Record<string, unknown>) => { submitted.push(p); return { data: { id: 1, html_url: 'https://github.com/o/r/pull/42#review-1' } }; } } } },
    transport: new RoutingTransport(),
    store: new MemoryStore(),
    meatCache: new MemoryVerdictCache(),
    groupCache: new MemoryGroupCache(),
    repo: null,
    viewer: 'me',
    config: { model: 'opus', meatModel: 'sonnet', effort: 'medium', standards: '', source: 'auto' },
    resolveSource: async () => resolved,
    ...over,
  };
}

export async function settle(session: ReviewSession): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const s = session.snapshot();
    if (s.loadError || (s.findings.status === 'done' || s.findings.status === 'failed') && s.grouping) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('session never settled');
}

