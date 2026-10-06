import { test, expect, describe, afterEach } from 'bun:test';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALL_PASSES, type PassSettings } from '../../src/core/session/passes.js';
import { ReviewSession } from '../../src/core/session/session.js';
import { startServer, type AppContext, type RunningServer } from '../../src/server/index.js';
import { deps } from '../core/session/fixtures.js';

let running: RunningServer | null = null;
afterEach(async () => { await running?.close(); running = null; });

function app(over: Partial<AppContext> = {}): AppContext & { created: number } {
  const ctx = {
    created: 0,
    repo: { root: '/clone', owner: 'o', repo: 'r' },
    viewer: 'me', version: '0.0.0', filter: 'open' as const, initial: null, passes: ALL_PASSES,
    listPulls: async () => [{ number: 42, title: 'T', author: 'a', state: 'open' as const, isDraft: false, headSha: 's', baseRef: 'main', headRef: 'f', updatedAt: 'now', htmlUrl: '' }],
    createSession: (id: string, owner: string, repo: string, number: number, passes: PassSettings) => {
      ctx.created += 1;
      return new ReviewSession(id, owner, repo, number, deps({ config: { ...deps().config, passes } }));
    },
    extras: { request: async (route: string) => ({ data: route === 'GET /emojis' ? { tada: 'https://x/tada.png' } : '<p>hi</p>' }) },
    ...over,
  };
  return ctx;
}

async function start(ctx = app(), staticDir: string | null = null) {
  running = await startServer({ app: ctx, staticDir });
  const base = `http://127.0.0.1:${running.port}`;
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { 'x-marrow-token': running!.token, 'content-type': 'application/json', ...init.headers } });
  return { base, call, ctx };
}

describe('startServer', () => {
  test('binds to loopback and puts the token in the URL', async () => {
    await start();
    expect(running!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{48}$/);
  });

  test('refuses an API call without the token', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/app`);
    expect(res.status).toBe(401);
  });

  test('accepts the token as a query parameter, for EventSource', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/app?token=${running!.token}`);
    expect(res.status).toBe(200);
  });

  test('lists pull requests for the clone it was started in', async () => {
    const { call } = await start();
    const body = await (await call('/api/pulls')).json() as { pulls: unknown[] };
    expect(body.pulls).toHaveLength(1);
  });

  test('opening the same pull request twice returns the same warm session', async () => {
    const { call, ctx } = await start();
    const open = () => call('/api/sessions', { method: 'POST', body: JSON.stringify({ number: 42 }) }).then((r) => r.json() as Promise<{ id: string }>);
    const a = await open();
    const b = await open();
    expect(a.id).toBe(b.id);
    expect(ctx.created).toBe(1);
  });

  test('changed pass settings reach the next review, not one already open', async () => {
    const { call } = await start();
    const open = (number: number) => call('/api/sessions', { method: 'POST', body: JSON.stringify({ number }) }).then((r) => r.json() as Promise<{ id: string }>);
    const status = async (id: string) => {
      let snap = await (await call(`/api/sessions/${id}`)).json() as { findings: { status: string } };
      for (let i = 0; i < 50 && !['done', 'off', 'failed'].includes(snap.findings.status); i += 1) {
        await new Promise((r) => setTimeout(r, 5));
        snap = await (await call(`/api/sessions/${id}`)).json() as typeof snap;
      }
      return snap.findings.status;
    };
    const before = await open(42);
    const res = await call('/api/settings', { method: 'PUT', body: JSON.stringify({ passes: { ...ALL_PASSES, find: false } }) });
    expect(res.status).toBe(200);
    expect(((await (await call('/api/app')).json()) as { passes: PassSettings }).passes.find).toBe(false);
    const after = await open(43);
    expect(await status(before.id)).toBe('done');
    expect(await status(after.id)).toBe('off');
  });

  test('refuses pass settings that are not four booleans', async () => {
    const { call } = await start();
    const res = await call('/api/settings', { method: 'PUT', body: JSON.stringify({ passes: { abridge: 'no' } }) });
    expect(res.status).toBe(400);
  });

  test('serves a snapshot and accepts triage and draft edits', async () => {
    const { call } = await start();
    const { id } = await (await call('/api/sessions', { method: 'POST', body: JSON.stringify({ number: 42 }) })).json() as { id: string };
    let snap = await (await call(`/api/sessions/${id}`)).json() as { findings: { status: string; items: Array<{ id: string; state: string }> } };
    for (let i = 0; i < 50 && snap.findings.status !== 'done'; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
      snap = await (await call(`/api/sessions/${id}`)).json() as typeof snap;
    }
    const fid = snap.findings.items[0]!.id;
    expect((await call(`/api/sessions/${id}/findings/${fid}`, { method: 'POST', body: JSON.stringify({ action: 'accept' }) })).status).toBe(200);
    const draft = { verdict: null, body: 'b', comments: [{ id: 'c', path: 'src/app.ts', line: 13, side: 'RIGHT', startLine: null, body: 'x', suggestion: null }] };
    expect((await call(`/api/sessions/${id}/draft`, { method: 'PUT', body: JSON.stringify(draft) })).status).toBe(200);
    const after = await (await call(`/api/sessions/${id}`)).json() as { draft: { comments: unknown[] }; findings: { items: Array<{ state: string }> } };
    expect(after.draft.comments).toHaveLength(1);
    expect(after.findings.items[0]!.state).toBe('accepted');
  });

  test('rejects a malformed comment rather than storing it', async () => {
    const { call } = await start();
    const { id } = await (await call('/api/sessions', { method: 'POST', body: JSON.stringify({ number: 42 }) })).json() as { id: string };
    const res = await call(`/api/sessions/${id}/draft`, { method: 'PUT', body: JSON.stringify({ comments: [{ id: 'c', path: 'a', line: 'one', side: 'UP', body: '' }] }) });
    expect(res.status).toBe(400);
  });

  test('a rejected submission comes back as a 422 with the reason', async () => {
    const { call } = await start();
    const { id } = await (await call('/api/sessions', { method: 'POST', body: JSON.stringify({ number: 42 }) })).json() as { id: string };
    await new Promise((r) => setTimeout(r, 20));
    const res = await call(`/api/sessions/${id}/submit`, { method: 'POST', body: JSON.stringify({ verdict: 'COMMENT', body: '' }) });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toContain('nothing to say');
  });

  test('streams a snapshot, then patches, over server-sent events', async () => {
    const { base, call } = await start();
    const { id } = await (await call('/api/sessions', { method: 'POST', body: JSON.stringify({ number: 42 }) })).json() as { id: string };
    const res = await fetch(`${base}/api/sessions/${id}/events?token=${running!.token}`);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toStartWith('event: snapshot\n');
    await reader.cancel();
  });

  test('proxies markdown previews and caches the emoji list', async () => {
    let emojiCalls = 0;
    const ctx = app({ extras: { request: async (route) => {
      if (route === 'GET /emojis') emojiCalls += 1;
      return { data: route === 'GET /emojis' ? { tada: 'u' } : '<p>rendered</p>' };
    } } });
    const { call } = await start(ctx);
    const md = await (await call('/api/markdown', { method: 'POST', body: JSON.stringify({ text: ':tada:' }) })).json() as { html: string };
    expect(md.html).toBe('<p>rendered</p>');
    await call('/api/emoji');
    await call('/api/emoji');
    expect(emojiCalls).toBe(1);
  });

  test('serves the built page for any non-API path and never escapes its directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-web-'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>marrow</title>');
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1)');
    const { base } = await start(app(), dir);
    expect(await (await fetch(`${base}/review/42`)).text()).toContain('<title>marrow</title>');
    expect((await fetch(`${base}/assets/app.js`)).headers.get('content-type')).toContain('javascript');
    expect(await (await fetch(`${base}/..%2f..%2fetc/passwd`)).text()).not.toContain('root:');
  });
});

