import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { explainGitHubFailure, GitHubError } from '../core/github/errors.js';
import type { GitHubStatus } from '../core/github/status.js';
import { listAssignees, listEmoji, renderMarkdown, type ExtrasApi } from '../core/github/extras.js';
import type { PullFilter, PullRequestSummary, RequestedPull } from '../core/github/types.js';
import type { RepoContext } from '../core/git/repo.js';
import type { Side, StagedComment, Verdict } from '../core/review/types.js';
import { VERDICTS } from '../core/review/verdicts.js';
import { parsePassSettings, type PassSettings } from '../core/session/passes.js';
import type { ReviewSession, TriageAction } from '../core/session/session.js';

export interface AppContext {
  /** The clone marrow was started in, if any; the picker's default repository. */
  repo: RepoContext | null;
  viewer: string;
  version: string;
  filter: PullFilter;
  /** Set when marrow was started with a pull request, so the page opens straight into it. */
  initial: { owner: string; repo: string; number: number } | null;
  /** The passes a new review runs, until the page changes them. */
  passes: PassSettings;
  listPulls(owner: string, repo: string, filter: PullFilter): Promise<PullRequestSummary[]>;
  /** Open pull requests awaiting the viewer's review, in any repository. */
  listReviewRequests(): Promise<RequestedPull[]>;
  createSession(id: string, owner: string, repo: string, number: number, passes: PassSettings): ReviewSession;
  extras: ExtrasApi;
  /** githubstatus.com, asked only after a GitHub call fails; absent means never asked. */
  githubStatus?: () => Promise<GitHubStatus | null>;
}

export interface ServerOptions {
  app: AppContext;
  /** The built page; null serves the API alone (tests, or a shell that bundles its own page). */
  staticDir: string | null;
  port?: number;
  token?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const MAX_BODY = 2_000_000;
const FILTERS: readonly PullFilter[] = ['open', 'review-requested', 'all'];
const ACTIONS: readonly TriageAction[] = ['accept', 'drop', 'edit', 'suggest', 'reset'];

function rethrowGitHub(error: unknown): never {
  throw new GitHubError(error);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request body too large.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Request body is not a JSON object.');
  }
}

function str(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be a string.`);
  return value;
}

function isSide(value: unknown): value is Side {
  return value === 'LEFT' || value === 'RIGHT';
}

function toComment(raw: unknown): StagedComment {
  const c = raw as Record<string, unknown>;
  const line = c.line;
  const startLine = c.startLine ?? null;
  if (typeof line !== 'number' || !isSide(c.side) || (startLine !== null && typeof startLine !== 'number')) {
    throw new HttpError(400, 'Each comment needs a numeric line and a LEFT or RIGHT side.');
  }
  return {
    id: str(c.id, 'comment id'),
    path: str(c.path, 'comment path'),
    line,
    side: c.side,
    startLine,
    body: str(c.body, 'comment body'),
    suggestion: c.suggestion === null || c.suggestion === undefined ? null : str(c.suggestion, 'suggestion'),
  };
}

function tokenMatches(given: string | null, token: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The local server behind the page. A library function rather than part of
 * the CLI, so a desktop shell can start the same server and point a window at
 * `url`. Bound to loopback on a port the OS picks, and every API call needs the
 * random token from the URL — other local processes and pages get nothing.
 */
export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const { app } = opts;
  const token = opts.token ?? randomBytes(24).toString('hex');
  const sessions = new Map<string, ReviewSession>();
  const streams = new Set<ServerResponse>();
  let emoji: Promise<Record<string, string>> | null = null;
  let passes: PassSettings = { ...app.passes };
  let counter = 0;

  function session(id: string): ReviewSession {
    const s = sessions.get(id);
    if (!s) throw new HttpError(404, 'No such review session; reopen the pull request.');
    return s;
  }

  function openSession(owner: string, repo: string, number: number): ReviewSession {
    // Reopening a pull request returns to the same review, warm: same draft,
    // same findings, no second model pass. Only a submitted one starts over.
    for (const s of sessions.values()) {
      const snap = s.snapshot();
      if (snap.owner === owner && snap.repo === repo && snap.number === number && !snap.submitted && !snap.loadError) return s;
    }
    counter += 1;
    const id = `${owner}-${repo}-${number}-${counter}`;
    const s = app.createSession(id, owner, repo, number, { ...passes });
    sessions.set(id, s);
    void s.load();
    return s;
  }

  function stream(req: IncomingMessage, res: ServerResponse, s: ReviewSession): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    write('snapshot', s.snapshot());
    const unsubscribe = s.subscribe((patch) => write('patch', patch));
    // Proxies and sleeping laptops drop idle streams; a comment keeps it alive.
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    streams.add(res);
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      streams.delete(res);
    });
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const given = (req.headers['x-marrow-token'] as string | undefined) ?? url.searchParams.get('token');
    if (!tokenMatches(given ?? null, token)) throw new HttpError(401, 'Missing or wrong token. Open the URL marrow printed.');

    const parts = url.pathname.split('/').filter(Boolean).slice(1);
    const method = req.method ?? 'GET';
    const route = `${method} /${parts.map((p, i) => (parts[0] === 'sessions' && i === 1 ? ':id' : parts[0] === 'sessions' && i === 3 ? ':fid' : p)).join('/')}`;

    switch (route) {
      case 'GET /app':
        return send(res, 200, {
          repo: app.repo ? { owner: app.repo.owner, repo: app.repo.repo } : null,
          viewer: app.viewer, version: app.version, filter: app.filter, initial: app.initial, passes,
        });

      case 'PUT /settings': {
        const next = parsePassSettings((await readJson(req)).passes);
        if (!next) throw new HttpError(400, 'passes must give abridge, group, find, and verify as booleans.');
        passes = next;
        return send(res, 200, { passes });
      }

      case 'GET /pulls': {
        const owner = url.searchParams.get('owner') ?? app.repo?.owner;
        const repo = url.searchParams.get('repo') ?? app.repo?.repo;
        if (!owner || !repo) throw new HttpError(400, 'Name a repository: owner and repo.');
        const filter = (url.searchParams.get('filter') ?? app.filter) as PullFilter;
        if (!FILTERS.includes(filter)) throw new HttpError(400, `filter must be one of ${FILTERS.join(', ')}.`);
        return send(res, 200, { pulls: await app.listPulls(owner, repo, filter).catch(rethrowGitHub) });
      }

      case 'GET /review-requests':
        return send(res, 200, { pulls: await app.listReviewRequests().catch(rethrowGitHub) });

      case 'POST /sessions': {
        const body = await readJson(req);
        const number = body.number;
        if (typeof number !== 'number' || !Number.isInteger(number)) throw new HttpError(400, 'number must be an integer.');
        const owner = typeof body.owner === 'string' ? body.owner : app.repo?.owner;
        const repo = typeof body.repo === 'string' ? body.repo : app.repo?.repo;
        if (!owner || !repo) throw new HttpError(400, 'Name a repository: owner and repo.');
        return send(res, 200, { id: openSession(owner, repo, number).id });
      }

      case 'GET /sessions/:id':
        return send(res, 200, session(parts[1]!).snapshot());

      case 'GET /sessions/:id/events':
        return stream(req, res, session(parts[1]!));

      case 'PUT /sessions/:id/draft': {
        const s = session(parts[1]!);
        const body = await readJson(req);
        const verdict = body.verdict ?? null;
        if (verdict !== null && !VERDICTS.includes(verdict as Verdict)) throw new HttpError(400, 'Unknown verdict.');
        if (!Array.isArray(body.comments)) throw new HttpError(400, 'comments must be a list.');
        s.updateDraft({ verdict: verdict as Verdict | null, body: str(body.body ?? '', 'body'), comments: body.comments.map(toComment) });
        return send(res, 200, { ok: true });
      }

      case 'POST /sessions/:id/findings/:fid': {
        const s = session(parts[1]!);
        const body = await readJson(req);
        const action = body.action as TriageAction;
        if (!ACTIONS.includes(action)) throw new HttpError(400, `action must be one of ${ACTIONS.join(', ')}.`);
        try {
          s.triage(parts[3]!, action, typeof body.body === 'string' ? body.body : undefined);
        } catch (error) {
          throw new HttpError(404, (error as Error).message);
        }
        return send(res, 200, { ok: true });
      }

      case 'POST /sessions/:id/viewed': {
        const s = session(parts[1]!);
        const body = await readJson(req);
        try {
          s.setViewed(str(body.path, 'path'), body.viewed === true);
        } catch (error) {
          throw new HttpError(404, (error as Error).message);
        }
        return send(res, 200, { ok: true });
      }

      case 'POST /sessions/:id/chat': {
        const s = session(parts[1]!);
        const body = await readJson(req);
        // Answered over the event stream; the request returns as soon as it is asked.
        void s.ask(str(body.question, 'question'), typeof body.context === 'string' ? body.context : undefined, body.fresh === true)
          .catch(() => {});
        return send(res, 202, { ok: true });
      }

      case 'POST /sessions/:id/retry':
        session(parts[1]!).retryFindings();
        return send(res, 202, { ok: true });

      case 'POST /sessions/:id/submit': {
        const s = session(parts[1]!);
        const body = await readJson(req);
        const verdict = body.verdict as Verdict;
        if (!VERDICTS.includes(verdict)) throw new HttpError(400, 'Choose a verdict.');
        try {
          return send(res, 200, await s.submit(verdict, str(body.body ?? '', 'body')));
        } catch (error) {
          if (error instanceof GitHubError) throw error;
          throw new HttpError(422, (error as Error).message);
        }
      }

      case 'GET /sessions/:id/file': {
        const s = session(parts[1]!);
        const path = url.searchParams.get('path');
        const side = url.searchParams.get('side') ?? 'RIGHT';
        if (!path || !isSide(side)) throw new HttpError(400, 'path and a LEFT or RIGHT side are required.');
        const text = await s.readFile(path, side);
        if (text === null) throw new HttpError(404, `${path} is not available on that side.`);
        return send(res, 200, { text });
      }

      case 'POST /markdown': {
        const body = await readJson(req);
        const context = typeof body.context === 'string' ? body.context : app.repo ? `${app.repo.owner}/${app.repo.repo}` : '';
        return send(res, 200, { html: await renderMarkdown(app.extras, str(body.text, 'text'), context) });
      }

      case 'GET /emoji':
        emoji ??= listEmoji(app.extras).catch((error: unknown) => { emoji = null; throw error; });
        return send(res, 200, { emoji: await emoji });

      case 'GET /mentions': {
        const owner = url.searchParams.get('owner') ?? app.repo?.owner;
        const repo = url.searchParams.get('repo') ?? app.repo?.repo;
        if (!owner || !repo) return send(res, 200, { users: [] });
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const users = await listAssignees(app.extras, owner, repo);
        return send(res, 200, { users: users.filter((u) => u.login.toLowerCase().includes(q)).slice(0, 8) });
      }

      default:
        throw new HttpError(404, `No route for ${method} ${url.pathname}.`);
    }
  }

  async function asset(res: ServerResponse, pathname: string): Promise<void> {
    if (!opts.staticDir) throw new HttpError(404, 'This server has no page.');
    const root = resolve(opts.staticDir);
    let target = resolve(root, `.${normalize(decodeURIComponent(pathname))}`);
    if (relative(root, target).startsWith('..')) throw new HttpError(404, 'Not found.');
    const isFile = await stat(target).then((s) => s.isFile(), () => false);
    // Anything that is not a built asset is a page route; the app routes itself.
    if (!isFile) target = join(root, 'index.html');
    const body = await readFile(target).catch(() => null);
    if (body === null) throw new HttpError(404, 'The page has not been built. Run `bun run build`.');
    const type = MIME[extname(target)] ?? 'application/octet-stream';
    const immutable = target.includes(`${join(root, 'assets')}`);
    res.writeHead(200, { 'content-type': type, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store' });
    res.end(body);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const handle = url.pathname.startsWith('/api/') ? api(req, res, url) : asset(res, url.pathname);
    handle.catch((error: unknown) => {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof HttpError) { send(res, error.status, { error: error.message }); return; }
      if (error instanceof GitHubError) {
        return explainGitHubFailure(error.failure, app.githubStatus ?? (async () => null))
          .then((github) => send(res, 502, { error: error.message, github }));
      }
      send(res, 500, { error: (error instanceof Error ? error.message.trim() : String(error)) || 'marrow failed without an error message.' });
    });
  });

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(opts.port ?? 0, '127.0.0.1', () => done());
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    port,
    token,
    close: () => new Promise<void>((done) => {
      for (const res of streams) res.end();
      server.close(() => done());
      server.closeAllConnections();
    }),
  };
}
