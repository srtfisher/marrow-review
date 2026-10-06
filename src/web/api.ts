import type {
  PassSettings, PullFilter, PullRequestSummary, RequestedPull, ReviewDraft, SessionSnapshot, Side, TriageAction, Verdict,
} from './lib/types.js';

const params = new URLSearchParams(window.location.search);
const STORED = 'marrow:token';
// Kept for the tab's lifetime, so a reload from a bookmark without the query still works.
const token = params.get('token') ?? sessionStorage.getItem(STORED) ?? '';
if (token) sessionStorage.setItem(STORED, token);

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`./api${path}`, {
    method,
    headers: { 'x-marrow-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export interface AppInfo {
  repo: { owner: string; repo: string } | null;
  viewer: string;
  version: string;
  filter: PullFilter;
  initial: { owner: string; repo: string; number: number } | null;
  passes: PassSettings;
}

const qs = (o: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => e[1] !== undefined)).toString();

export const api = {
  app: () => call<AppInfo>('GET', '/app'),
  settings: (passes: PassSettings) => call<{ passes: PassSettings }>('PUT', '/settings', { passes }).then((r) => r.passes),
  pulls: (filter: PullFilter, owner?: string, repo?: string) =>
    call<{ pulls: PullRequestSummary[] }>('GET', `/pulls?${qs({ filter, owner, repo })}`).then((r) => r.pulls),
  reviewRequests: () => call<{ pulls: RequestedPull[] }>('GET', '/review-requests').then((r) => r.pulls),
  open: (owner: string, repo: string, number: number) => call<{ id: string }>('POST', '/sessions', { owner, repo, number }),
  draft: (id: string, draft: ReviewDraft) => call('PUT', `/sessions/${id}/draft`, draft),
  triage: (id: string, findingId: string, action: TriageAction, body?: string) =>
    call('POST', `/sessions/${id}/findings/${findingId}`, { action, body }),
  viewed: (id: string, path: string, viewed: boolean) => call('POST', `/sessions/${id}/viewed`, { path, viewed }),
  chat: (id: string, question: string, context?: string, fresh?: boolean) =>
    call('POST', `/sessions/${id}/chat`, { question, context, fresh }),
  retry: (id: string) => call('POST', `/sessions/${id}/retry`),
  submit: (id: string, verdict: Verdict, body: string) =>
    call<{ url: string; demoted: unknown[] }>('POST', `/sessions/${id}/submit`, { verdict, body }),
  file: (id: string, path: string, side: Side) =>
    call<{ text: string }>('GET', `/sessions/${id}/file?${qs({ path, side })}`).then((r) => r.text),
  markdown: (text: string, context?: string) => call<{ html: string }>('POST', '/markdown', { text, context }).then((r) => r.html),
  emoji: () => call<{ emoji: Record<string, string> }>('GET', '/emoji').then((r) => r.emoji),
  mentions: (q: string, owner?: string, repo?: string) =>
    call<{ users: Array<{ login: string; avatarUrl: string }> }>('GET', `/mentions?${qs({ q, owner, repo })}`).then((r) => r.users),

  /** Snapshot first, then patches. Returns a function that closes the stream. */
  events(id: string, onSnapshot: (s: SessionSnapshot) => void, onPatch: (p: Partial<SessionSnapshot>) => void, onDrop: () => void): () => void {
    const source = new EventSource(`./api/sessions/${id}/events?token=${encodeURIComponent(token)}`);
    source.addEventListener('snapshot', (e) => onSnapshot(JSON.parse((e as MessageEvent<string>).data) as SessionSnapshot));
    source.addEventListener('patch', (e) => onPatch(JSON.parse((e as MessageEvent<string>).data) as Partial<SessionSnapshot>));
    // EventSource reconnects on its own; a snapshot follows every reconnect.
    source.onerror = () => { if (source.readyState === EventSource.CLOSED) onDrop(); };
    return () => source.close();
  },
};

const markdownCache = new Map<string, Promise<string>>();
/** GitHub-rendered HTML for `text`, memoized for the page's lifetime. */
export function renderMarkdown(text: string, context?: string): Promise<string> {
  const key = `${context ?? ''}\n${text}`;
  let cached = markdownCache.get(key);
  if (!cached) {
    cached = api.markdown(text, context);
    cached.catch(() => markdownCache.delete(key));
    markdownCache.set(key, cached);
  }
  return cached;
}

let emojiList: Promise<Record<string, string>> | null = null;
export function emojiMap(): Promise<Record<string, string>> {
  emojiList ??= api.emoji().catch(() => { emojiList = null; return {}; });
  return emojiList;
}
