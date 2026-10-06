import { test, expect, describe } from 'bun:test';
import { VERIFY_SCHEMA } from '../../../src/core/findings/verify.js';
import { absorbAccepted, fullDraft, mergeTriage, ReviewSession } from '../../../src/core/session/session.js';
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
