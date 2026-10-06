import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRequest, AgentRun, AgentTransport } from '../../../src/core/agent/types.js';
import { FINDINGS_SCHEMA } from '../../../src/core/findings/schema.js';
import { VERIFY_SCHEMA } from '../../../src/core/findings/verify.js';
import type { PullRequestDetail } from '../../../src/core/github/types.js';
import { MemoryGroupCache } from '../../../src/core/group/cache.js';
import { MemoryVerdictCache } from '../../../src/core/meat/cache.js';
import {
  absorbAccepted, fullDraft, mergeTriage, ReviewSession, type SessionDeps,
} from '../../../src/core/session/session.js';
import { readOnlyAccess, type ResolvedSource } from '../../../src/core/source/index.js';
import type { PersistedReview } from '../../../src/core/store/review.js';
import type { TriagedFinding } from '../../../src/core/findings/triage.js';

const diff = readFileSync(join(import.meta.dir, '../../fixtures/diffs/modify.diff'), 'utf8');

const finding = {
  path: 'src/app.ts', line: 14, side: 'RIGHT', startLine: null, severity: 'blocking',
  type: 'Correctness', kind: 'issue', title: 'Errors reach nothing', body: 'fail is undefined here.',
  failureScenario: 'A listen error calls an undefined fail().', confidence: 'high', suggestion: null,
};

function run(structured: unknown): AgentRun {
  return { text: '', structured, sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, numTurns: 1 }, usageWarning: null };
}

/** Answers by pass rather than by call order, since grouping and find run concurrently. */
class RoutingTransport implements AgentTransport {
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

class MemoryStore {
  saved: PersistedReview[] = [];
  cleared = 0;
  constructor(private readonly existing: PersistedReview | null = null) {}
  async load() { return this.existing; }
  async save(r: PersistedReview) { this.saved.push(r); }
  async findPreviousHead() { return null; }
  async clear() { this.cleared += 1; }
}

const pr: PullRequestDetail = {
  number: 42, title: 'Handle server errors', author: 'hubot', state: 'open', isDraft: false,
  headSha: 'abc1234', baseRef: 'main', headRef: 'fix', updatedAt: 'now', htmlUrl: 'https://github.com/o/r/pull/42',
  owner: 'o', repo: 'r', baseSha: 'base123', body: 'Body.', diff, viewerIsAuthor: false,
  additions: 2, deletions: 1, changedFiles: 1,
};

const resolved: ResolvedSource = {
  source: { kind: 'worktree', canSearch: true, access: readOnlyAccess('/tmp/wt'), readHead: async () => null },
  degraded: null,
};

function deps(over: Partial<SessionDeps> = {}): SessionDeps & { submitted: unknown[] } {
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

async function settle(session: ReviewSession): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const s = session.snapshot();
    if (s.loadError || (s.findings.status === 'done' || s.findings.status === 'failed') && s.grouping) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('session never settled');
}

describe('ReviewSession.load', () => {
  test('loads the pull request, abridges it, groups it, and finds and verifies', async () => {
    const session = new ReviewSession('s1', 'o', 'r', 42, deps());
    await session.load();
    await settle(session);
    const s = session.snapshot();
    expect(s.pr?.title).toBe('Handle server errors');
    expect(s.meat?.files).toHaveLength(1);
    expect(s.grouping?.source).toBe('single');
    expect(s.findings.items).toHaveLength(1);
    expect(s.findings.items[0]!.verdict).toBe('confirmed');
    expect(s.steps.every((st) => st.state === 'done')).toBe(true);
  });

  test('the snapshot never carries the raw diff', async () => {
    const session = new ReviewSession('s1', 'o', 'r', 42, deps());
    await session.load();
    expect('diff' in (session.snapshot().pr ?? {})).toBe(false);
  });

  test('every change is announced as a patch', async () => {
    const session = new ReviewSession('s1', 'o', 'r', 42, deps());
    const patches: string[] = [];
    session.subscribe((p) => patches.push(...Object.keys(p)));
    await session.load();
    await settle(session);
    expect(patches).toContain('meat');
    expect(patches).toContain('sections');
    expect(patches).toContain('findings');
  });

  test('a findings failure costs the findings, not the review', async () => {
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({ transport: new RoutingTransport([], true) }));
    await session.load();
    await settle(session);
    const s = session.snapshot();
    expect(s.findings.status).toBe('failed');
    expect(s.findings.error?.detail).toContain('rate limited');
    expect(s.meat).not.toBeNull();
    expect(s.steps.find((st) => st.id === 'verify')!.state).toBe('skipped');
  });

  test('a fetch failure is reported as a load error rather than thrown', async () => {
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({
      client: { getPull: async () => { throw new Error('Not Found'); }, listCommitSubjects: async () => [] },
    }));
    await session.load();
    expect(session.snapshot().loadError).toContain('Not Found');
  });

  test('a degraded source is said out loud', async () => {
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({
      resolveSource: async () => ({ ...resolved, degraded: 'could not prepare a local checkout' }),
    }));
    await session.load();
    expect(session.snapshot().notes.map((n) => n.text)).toContain('could not prepare a local checkout');
  });

  test('a cleanup finding with no failure scenario is never verified', async () => {
    const transport = new RoutingTransport([{ ...finding, type: 'Maintainability', failureScenario: null, severity: 'non-blocking' }]);
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({ transport }));
    await session.load();
    await settle(session);
    expect(transport.requests.some((r) => r.schema === VERIFY_SCHEMA)).toBe(false);
    expect(session.snapshot().findings.items[0]!.verdict).toBe('plausible');
  });
});

describe('reviewer state', () => {
  test('an accepted finding is submitted with the reviewer comments', async () => {
    const d = deps();
    const session = new ReviewSession('s1', 'o', 'r', 42, d);
    await session.load();
    await settle(session);
    const id = session.snapshot().findings.items[0]!.id;
    session.triage(id, 'accept');
    session.updateDraft({ verdict: null, body: '', comments: [
      { id: 'mine', path: 'src/app.ts', line: 13, side: 'RIGHT', startLine: null, body: 'Name it?', suggestion: null },
    ] });
    const { url } = await session.submit('COMMENT', 'Looks close.');
    expect(url).toContain('review-1');
    const payload = d.submitted[0] as { comments: unknown[]; body: string };
    expect(payload.comments).toHaveLength(2);
    expect(payload.body).toBe('Looks close.');
    expect((d.store as unknown as MemoryStore).cleared).toBe(1);
  });

  test('approving your own pull request is refused before GitHub sees it', async () => {
    const d = deps({ client: { getPull: async () => ({ ...pr, viewerIsAuthor: true }), listCommitSubjects: async () => [] } });
    const session = new ReviewSession('s1', 'o', 'r', 42, d);
    await session.load();
    await expect(session.submit('APPROVE', '')).rejects.toThrow('your own pull request');
    expect(d.submitted).toHaveLength(0);
  });

  test('edits are written through to the store with accepted findings included', async () => {
    const d = deps();
    const session = new ReviewSession('s1', 'o', 'r', 42, d);
    await session.load();
    await settle(session);
    session.triage(session.snapshot().findings.items[0]!.id, 'edit', 'Reworded.');
    const last = (d.store as unknown as MemoryStore).saved.at(-1)!;
    expect(last.draft.comments.map((c) => c.body)).toEqual(['Reworded.']);
  });

  test('marking a file viewed records the hash of its diff', async () => {
    const session = new ReviewSession('s1', 'o', 'r', 42, deps());
    await session.load();
    session.setViewed('src/app.ts', true);
    const s = session.snapshot();
    expect(s.viewed['src/app.ts']).toBe(s.fileHashes['src/app.ts']!);
    session.setViewed('src/app.ts', false);
    expect(session.snapshot().viewed).toEqual({});
  });

  test('a restored draft holding an accepted finding turns back into that finding', async () => {
    const first = new ReviewSession('s1', 'o', 'r', 42, deps());
    await first.load();
    await settle(first);
    const id = first.snapshot().findings.items[0]!.id;
    const saved: PersistedReview = {
      version: 1, owner: 'o', repo: 'r', number: 42, headSha: 'abc1234', updatedAt: 'now',
      draft: { verdict: null, body: '', comments: [{ id, path: 'src/app.ts', line: 14, side: 'RIGHT', startLine: null, body: 'Mine now.', suggestion: null }] },
    };
    const session = new ReviewSession('s2', 'o', 'r', 42, deps({ store: new MemoryStore(saved) }));
    await session.load();
    await settle(session);
    const s = session.snapshot();
    expect(s.draft.comments).toEqual([]);
    expect(s.findings.items[0]!.state).toBe('accepted');
    expect(s.findings.items[0]!.editedBody).toBe('Mine now.');
  });

  test('chat answers land in the conversation', async () => {
    const session = new ReviewSession('s1', 'o', 'r', 42, deps());
    await session.load();
    await session.ask('Why?', 'File: src/app.ts');
    const { session: chat, pending } = session.snapshot().chat;
    expect(pending).toBe(false);
    expect(chat.turns.map((t) => t.role)).toEqual(['user', 'agent']);
  });
});

describe('mergeTriage', () => {
  test('keeps a decision made while verification was running', () => {
    const base = { ...finding, id: 'f', verdict: 'plausible' as const, refutations: [] } as unknown as TriagedFinding;
    const current: TriagedFinding[] = [{ ...base, state: 'accepted', editedBody: 'x', asSuggestion: false }];
    const merged = mergeTriage(current, [{ ...base, verdict: 'confirmed' }]);
    expect(merged[0]!.state).toBe('accepted');
    expect(merged[0]!.verdict).toBe('confirmed');
  });
});

describe('fullDraft and absorbAccepted', () => {
  test('do not double a comment that is both staged and an accepted finding', () => {
    const base = { ...finding, id: 'f', verdict: 'confirmed' as const, refutations: [], state: 'accepted' as const, editedBody: null, asSuggestion: false } as unknown as TriagedFinding;
    const draft = { verdict: null, body: '', comments: [{ id: 'f', path: 'src/app.ts', line: 14, side: 'RIGHT' as const, startLine: null, body: 'b', suggestion: null }] };
    expect(fullDraft(draft, [base]).comments).toHaveLength(1);
    expect(absorbAccepted([{ ...base, state: 'pending' }], draft).draft.comments).toHaveLength(0);
  });
});
