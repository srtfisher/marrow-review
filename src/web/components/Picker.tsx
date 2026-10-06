import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type AppInfo } from '../api.js';
import { parseTarget, relativeTime } from '../lib/format.js';
import type { PullFilter, PullRequestSummary } from '../lib/types.js';
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

  const target = parseTarget(query);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    if (!pulls) return [];
    if (!q || target?.owner) return pulls;
    return pulls.filter((p) => `${p.number} ${p.title} ${p.author}`.toLowerCase().includes(q));
  }, [pulls, query, target?.owner]);
  useEffect(() => setCursor(0), [query, filter]);

  const submit = () => {
    if (target?.owner && target.repo) {
      if (target.number !== null) onOpen(target.owner, target.repo, target.number);
      else { onRepo(target.owner, target.repo); setQuery(''); }
      return;
    }
    const pick = shown[cursor];
    if (pick && repo) onOpen(repo.owner, repo.repo, pick.number);
    else if (target?.number !== null && target?.number !== undefined && repo) onOpen(repo.owner, repo.repo, target.number);
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col px-4 py-8">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold text-done">marrow</h1>
        <p className="text-sm text-fg-muted">a large diff, abridged to what carries meaning</p>
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
              if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
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
          {shown.map((p, i) => (
            <li key={p.number} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => repo && onOpen(repo.owner, repo.repo, p.number)}
                className={`flex w-full items-start gap-3 border-b border-border-muted px-4 py-2.5 text-left last:border-b-0 ${i === cursor ? 'bg-accent-subtle' : 'hover:bg-canvas-subtle'}`}
              >
                <Icon name="pr" className={`mt-0.5 ${p.isDraft ? 'text-fg-muted' : p.state === 'merged' ? 'text-done' : p.state === 'closed' ? 'text-danger' : 'text-success'}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.title} {p.isDraft && <Label>Draft</Label>}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
                    #{p.number} · <Avatar login={p.author} size={14} />{p.author} · updated {relativeTime(p.updatedAt)}
                    <span className="font-mono">· {p.headRef}</span>
                  </p>
                </div>
                {i === cursor && <span className="self-center text-xs text-fg-muted"><Kbd>⏎</Kbd></span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
