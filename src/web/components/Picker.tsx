import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type AppInfo } from '../api.js';
import { parseTarget, relativeTime } from '../lib/format.js';
import type { PullFilter, PullRequestSummary, RequestedPull } from '../lib/types.js';
import { Settings } from './Settings.js';
import { Icon } from './icons.js';
import { Avatar, Kbd, Label, Spinner } from './ui.js';

const FILTERS: Array<{ id: PullFilter; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'review-requested', label: 'Needs my review' },
  { id: 'all', label: 'All' },
];

export function Picker({ app, repo, onOpen, onRepo }: {
  app: AppInfo;
  repo: { owner: string; repo: string } | null;
  onOpen: (owner: string, repo: string, number: number) => void;
  onRepo: (owner: string, repo: string) => void;
}) {
  const [filter, setFilter] = useState<PullFilter>(app.filter);
  const [pulls, setPulls] = useState<PullRequestSummary[] | null>(null);
  const [requested, setRequested] = useState<RequestedPull[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const load = () => {
    if (!repo) return;
    setError(null);
    api.pulls(filter, repo.owner, repo.repo).then(setPulls, (e: Error) => setError(e.message));
  };
  useEffect(() => { setPulls(null); load(); }, [filter, repo?.owner, repo?.repo]);
  useEffect(() => { input.current?.focus(); }, []);
  // An inbox that fails to load is simply not shown; the picker works without it.
  useEffect(() => { api.reviewRequests().then(setRequested, () => setRequested([])); }, []);

  const target = parseTarget(query);
  const q = target?.owner ? '' : query.trim().toLowerCase().replace(/^#/, '');
  const shown = useMemo(
    () => (pulls ?? []).filter((p) => `${p.number} ${p.title} ${p.author}`.toLowerCase().includes(q)),
    [pulls, q],
  );
  const inbox = useMemo(
    () => requested.filter((p) => `${p.number} ${p.title} ${p.author} ${p.owner}/${p.repo}`.toLowerCase().includes(q)),
    [requested, q],
  );
  // One cursor runs down the repository's list and on into the review requests.
  const rows = useMemo(() => [
    ...(repo ? shown.map((pull) => ({ owner: repo.owner, repo: repo.repo, pull, other: false })) : []),
    ...inbox.map((pull) => ({ owner: pull.owner, repo: pull.repo, pull, other: true })),
  ], [repo, shown, inbox]);
  useEffect(() => setCursor(0), [query, filter]);

  const submit = () => {
    if (target?.owner && target.repo) {
      if (target.number !== null) onOpen(target.owner, target.repo, target.number);
      else { onRepo(target.owner, target.repo); setQuery(''); }
      return;
    }
    const pick = rows[cursor];
    if (pick) onOpen(pick.owner, pick.repo, pick.pull.number);
    else if (target?.number !== null && target?.number !== undefined && repo) onOpen(repo.owner, repo.repo, target.number);
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col px-4 py-8">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-done">marrow</h1>
        <p className="flex-1 text-sm text-fg-muted">a large diff, abridged to what carries meaning</p>
        <Settings shortcut={false} />
      </div>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <Icon name="pr" className="text-fg-muted" />
        <span className="font-semibold">{repo ? `${repo.owner}/${repo.repo}` : 'No repository'}</span>
        {!repo && <span className="text-fg-muted">— type owner/repo, or paste a pull request URL</span>}
      </div>
      <div className="rounded-md border border-border">
        <div className="flex flex-wrap items-center gap-2 rounded-t-md border-b border-border bg-canvas-subtle px-3 py-2">
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
              if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              if (e.key === 'Tab') { e.preventDefault(); setFilter((f) => FILTERS[(FILTERS.findIndex((x) => x.id === f) + (e.shiftKey ? FILTERS.length - 1 : 1)) % FILTERS.length]!.id); }
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder="Filter by title, author, or number — or paste a URL"
            aria-label="Filter pull requests"
            className="min-w-64 flex-1 rounded-md border border-border bg-canvas px-3 py-1.5 text-sm outline-none focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
          />
          <div className="flex gap-1 rounded-lg bg-canvas p-0.5 ring-1 ring-border" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${filter === f.id ? 'bg-accent-emphasis text-white' : 'text-fg-muted hover:text-fg'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-fg-muted"><Kbd>⇥</Kbd></span>
        </div>
        {error && <p className="px-4 py-6 text-sm text-danger">Could not list pull requests: {error} <button type="button" className="text-accent underline" onClick={load}>Retry</button></p>}
        {repo && !pulls && !error && <p className="flex items-center gap-2 px-4 py-6 text-sm text-fg-muted"><Spinner />Asking GitHub…</p>}
        {pulls && shown.length === 0 && <p className="px-4 py-6 text-sm text-fg-muted">No pull requests match.</p>}
        <ul role="listbox" aria-label="Pull requests">
          {shown.map((p, i) => repo && (
            <PullRow key={p.number} pull={p} active={i === cursor} onHover={() => setCursor(i)} onOpen={() => onOpen(repo.owner, repo.repo, p.number)} />
          ))}
        </ul>
      </div>
      {inbox.length > 0 && (
        <div className="mt-6 rounded-md border border-border">
          <h2 className="flex items-center gap-2 rounded-t-md border-b border-border bg-canvas-subtle px-4 py-2 text-sm font-semibold">
            Review requested<span className="rounded-full bg-neutral-muted px-1.5 text-xs font-medium text-fg-muted">{inbox.length}</span>
          </h2>
          <ul role="listbox" aria-label="Review requested">
            {inbox.map((p, j) => {
              const i = rows.length - inbox.length + j;
              return (
                <PullRow key={`${p.owner}/${p.repo}#${p.number}`} pull={p} where={`${p.owner}/${p.repo}`} active={i === cursor} onHover={() => setCursor(i)} onOpen={() => onOpen(p.owner, p.repo, p.number)} />
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function PullRow({ pull: p, where, active, onHover, onOpen }: {
  pull: PullRequestSummary;
  where?: string;
  active: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  return (
    <li role="option" aria-selected={active}>
      <button
        type="button"
        onMouseEnter={onHover}
        onClick={onOpen}
        className={`flex w-full items-start gap-3 border-b border-border-muted px-4 py-2.5 text-left last:border-b-0 ${active ? 'bg-accent-subtle' : 'hover:bg-canvas-subtle'}`}
      >
        <Icon name="pr" className={`mt-0.5 ${p.isDraft ? 'text-fg-muted' : p.state === 'merged' ? 'text-done' : p.state === 'closed' ? 'text-danger' : 'text-success'}`} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{p.title} {p.isDraft && <Label>Draft</Label>}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
            {where && <span className="font-semibold text-fg">{where}</span>}
            #{p.number} · <Avatar login={p.author} size={14} />{p.author} · updated {relativeTime(p.updatedAt)}
            <span className="font-mono">· {p.headRef}</span>
          </p>
        </div>
        {active && <span className="self-center text-xs text-fg-muted"><Kbd>⏎</Kbd></span>}
      </button>
    </li>
  );
}
