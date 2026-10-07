import { test, expect, describe } from 'bun:test';
import { SCORE_SCHEMA } from '../../../src/core/findings/score.js';
import { FINDINGS_SCHEMA } from '../../../src/core/findings/schema.js';
import { GROUPING_SCHEMA } from '../../../src/core/group/index.js';
import { CLASSIFY_SCHEMA } from '../../../src/core/meat/classify.js';
import { ALL_PASSES } from '../../../src/core/session/passes.js';
import { absorbAccepted, fullDraft, mergeTriage, ReviewSession, type SessionConfig } from '../../../src/core/session/session.js';
import type { PersistedReview } from '../../../src/core/store/review.js';
import type { TriagedFinding } from '../../../src/core/findings/triage.js';
import { deps, finding, MemoryStore, pr, resolved, RoutingTransport, settle } from './fixtures.js';

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
    expect(s.findings.items[0]!.score).toBe(90);
    expect(s.findings.items[0]!.lenses).toEqual(['bugs']);
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

  test('a load that fails on GitHub\'s side carries githubstatus.com\'s account and fails the step it was on', async () => {
    const outage = { description: 'Partial System Outage', incidents: [], degraded: ['Pull Requests: major outage'] };
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({
      client: { getPull: async () => { throw Object.assign(new Error(''), { status: 503, response: { status: 503, headers: {} } }); }, listCommitSubjects: async () => [] },
      githubStatus: async () => outage,
    }));
    await session.load();
    const s = session.snapshot();
    expect(s.loadError).toBe('Could not load #42: GitHub answered HTTP 503 without saying why.');
    expect(s.loadProblem).toMatchObject({ status: 503, onGitHubsSide: true, report: outage });
    expect(s.steps.find((st) => st.id === 'pull')!.state).toBe('failed');
  });

  test('a degraded source is said out loud', async () => {
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({
      resolveSource: async () => ({ ...resolved, degraded: 'could not prepare a local checkout' }),
    }));
    await session.load();
    expect(session.snapshot().notes.map((n) => n.text)).toContain('could not prepare a local checkout');
  });

  test('a question is never scored', async () => {
    const transport = new RoutingTransport([{ ...finding, kind: 'question', failureScenario: null, severity: 'non-blocking' }]);
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({ transport }));
    await session.load();
    await settle(session);
    expect(transport.requests.some((r) => r.schema === SCORE_SCHEMA)).toBe(false);
    expect(session.snapshot().findings.items[0]!.score).toBeNull();
  });

  test('the threshold follows effort', () => {
    expect(new ReviewSession('s1', 'o', 'r', 42, deps()).snapshot().scoreThreshold).toBe(80);
    expect(new ReviewSession('s1', 'o', 'r', 42, deps({ config: { ...deps().config, effort: 'high' } })).snapshot().scoreThreshold).toBe(60);
  });

  test('changed files, conventions, and history are gathered for the reviewers', async () => {
    const transport = new RoutingTransport();
    const graphqlQueries: string[] = [];
    const base = deps();
    const session = new ReviewSession('s1', 'o', 'r', 42, {
      ...base,
      transport,
      graphql: async (query, vars) => { graphqlQueries.push(query); return base.graphql(query, vars); },
      contents: { rest: { repos: { getContent: async ({ path }: { path: string }) => {
        if (path === 'CLAUDE.md') return { data: { type: 'file', encoding: 'base64', content: Buffer.from('Never busy-wait.').toString('base64') } };
        throw Object.assign(new Error('nf'), { status: 404 });
      } } } } as never,
      resolveSource: async () => ({ ...resolved, source: { ...resolved.source, readHead: async () => 'const x = 1;\n' } }),
    });
    await session.load();
    await settle(session);
    const prompts = transport.requests.filter((r) => r.schema === FINDINGS_SCHEMA).map((r) => r.prompt);
    expect(prompts.some((p) => p.includes('Never busy-wait.'))).toBe(true);
    expect(prompts.some((p) => p.includes('1  const x = 1;'))).toBe(true);
    expect(graphqlQueries.some((q) => q.includes('FileHistory'))).toBe(true);
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
  test('keeps a decision made while scoring was running', () => {
    const base = { ...finding, id: 'f', lenses: ['bugs'], score: null, scoreReason: null } as unknown as TriagedFinding;
    const current: TriagedFinding[] = [{ ...base, state: 'accepted', editedBody: 'x', asSuggestion: false }];
    const merged = mergeTriage(current, [{ ...base, score: 88 }]);
    expect(merged[0]!.state).toBe('accepted');
    expect(merged[0]!.score).toBe(88);
  });
});

describe('fullDraft and absorbAccepted', () => {
  test('do not double a comment that is both staged and an accepted finding', () => {
    const base = { ...finding, id: 'f', lenses: ['bugs'], score: 90, scoreReason: null, state: 'accepted' as const, editedBody: null, asSuggestion: false } as unknown as TriagedFinding;
    const draft = { verdict: null, body: '', comments: [{ id: 'f', path: 'src/app.ts', line: 14, side: 'RIGHT' as const, startLine: null, body: 'b', suggestion: null }] };
    expect(fullDraft(draft, [base]).comments).toHaveLength(1);
    expect(absorbAccepted([{ ...base, state: 'pending' }], draft).draft.comments).toHaveLength(0);
  });
});

describe('usage', () => {
  test('each pass reports what it spent, under its own name', async () => {
    const session = new ReviewSession('s1', 'o', 'r', 42, deps());
    const patched: string[] = [];
    session.subscribe((p) => { if (p.usage) patched.push(...Object.keys(p.usage)); });
    await session.load();
    await settle(session);
    const usage = session.snapshot().usage;
    expect(usage.abridge?.runs).toBe(1);
    expect(usage.find?.runs).toBe(1);
    expect(usage.verify?.runs).toBe(1);
    // A one-file change is grouped without a model call, so it spends nothing.
    expect(usage.group).toBeUndefined();
    expect(patched).toContain('verify');
  });
});

describe('switched-off passes', () => {
  const passes = (over: Partial<SessionConfig['passes']>) => ({ ...deps().config, passes: { ...ALL_PASSES, ...over } });
  const step = (session: ReviewSession, id: string) => session.snapshot().steps.find((s) => s.id === id)!;

  test('abridge off runs the rules alone and says so', async () => {
    const transport = new RoutingTransport();
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({ transport, config: passes({ abridge: false }) }));
    await session.load();
    await settle(session);
    expect(session.snapshot().meat?.classifierSkipped).toBe(true);
    expect(transport.requests.some((r) => r.schema === CLASSIFY_SCHEMA)).toBe(false);
    expect(step(session, 'abridge').state).toBe('skipped');
    expect(step(session, 'abridge').detail).toContain('rules only');
  });

  test('group off lays the diff out by directory without asking the model', async () => {
    const transport = new RoutingTransport();
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({ transport, config: passes({ group: false }) }));
    await session.load();
    await settle(session);
    expect(session.snapshot().grouping?.source).toBe('directory');
    expect(session.snapshot().grouping?.error).toBeNull();
    expect(transport.requests.some((r) => r.schema === GROUPING_SCHEMA)).toBe(false);
    expect(step(session, 'group').state).toBe('skipped');
  });

  test('find off skips find and verify, and reads as off rather than as nothing found', async () => {
    const transport = new RoutingTransport();
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({ transport, config: passes({ find: false }) }));
    await session.load();
    await settle(session);
    expect(session.snapshot().findings.status).toBe('off');
    expect(transport.requests.some((r) => r.schema === FINDINGS_SCHEMA || r.schema === SCORE_SCHEMA)).toBe(false);
    expect(step(session, 'find').state).toBe('skipped');
    expect(step(session, 'verify').state).toBe('skipped');
  });

  test('retrying runs the find pass even when it was switched off', async () => {
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({ config: passes({ find: false }) }));
    await session.load();
    await settle(session);
    session.retryFindings();
    for (let i = 0; i < 50 && session.snapshot().findings.status !== 'done'; i += 1) await new Promise((r) => setTimeout(r, 2));
    expect(session.snapshot().findings.items).toHaveLength(1);
    expect(step(session, 'find').state).toBe('done');
  });

  test('scoring off leaves findings unscored, and all of them shown', async () => {
    const transport = new RoutingTransport();
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({ transport, config: passes({ verify: false }) }));
    await session.load();
    await settle(session);
    const s = session.snapshot();
    expect(s.findings.status).toBe('done');
    expect(s.findings.items[0]!.score).toBeNull();
    expect(transport.requests.some((r) => r.schema === SCORE_SCHEMA)).toBe(false);
    expect(step(session, 'verify').state).toBe('skipped');
  });
});

test('reviewers and the scorer each run on their own model', async () => {
  const transport = new RoutingTransport();
  const session = new ReviewSession('s1', 'o', 'r', 42, deps({ transport, config: { ...deps().config, reviewModel: 'sonnet', verifyModel: 'haiku' } }));
  await session.load();
  await settle(session);
  expect(transport.requests.filter((r) => r.schema === SCORE_SCHEMA).map((r) => r.model)).toEqual(['haiku']);
  expect(transport.requests.find((r) => r.schema === FINDINGS_SCHEMA)!.model).toBe('sonnet');
});

describe('reusing an earlier review', () => {
  test('reopening an unchanged pull request reuses its findings and scores instead of paying again', async () => {
    const shared = deps();
    const first = new ReviewSession('s1', 'o', 'r', 42, shared);
    await first.load();
    await settle(first);

    const transport = new RoutingTransport();
    const second = new ReviewSession('s2', 'o', 'r', 42, { ...shared, transport });
    await second.load();
    await settle(second);
    const s = second.snapshot();
    expect(transport.requests.some((r) => r.schema === FINDINGS_SCHEMA || r.schema === SCORE_SCHEMA)).toBe(false);
    expect(s.findings.items).toHaveLength(1);
    expect(s.findings.items[0]!.score).toBe(90);
    expect(s.fromCache).toEqual({ find: 1, verify: 1 });
    expect(s.steps.find((st) => st.id === 'find')!.detail).toContain('from cache');
  });

  test('retrying asks the model again even when a cached review exists', async () => {
    const transport = new RoutingTransport();
    const session = new ReviewSession('s1', 'o', 'r', 42, deps({ transport }));
    await session.load();
    await settle(session);
    const before = transport.requests.filter((r) => r.schema === FINDINGS_SCHEMA).length;
    session.retryFindings();
    for (let i = 0; i < 50 && transport.requests.filter((r) => r.schema === FINDINGS_SCHEMA).length === before; i += 1) await new Promise((r) => setTimeout(r, 2));
    expect(transport.requests.filter((r) => r.schema === FINDINGS_SCHEMA)).toHaveLength(before + 1);
  });
});
