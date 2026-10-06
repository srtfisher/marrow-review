import { useEffect, useRef, useState } from 'react';
import type { Theme } from '../hooks.js';
import type { SessionSnapshot, Step } from '../lib/types.js';
import { Icon } from './icons.js';
import { Avatar, Button, Label, Spinner } from './ui.js';

const STATE_PILL = {
  open: 'bg-success-emphasis text-white',
  closed: 'bg-danger text-white',
  merged: 'bg-done text-white',
} as const;

function elapsed(step: Step, now: number): string {
  if (step.startedAt === null) return '';
  const ms = (step.finishedAt ?? now) - step.startedAt;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function StepIcon({ step }: { step: Step }) {
  if (step.state === 'running') return <Spinner size={12} />;
  if (step.state === 'done') return <Icon name="check" size={12} className="text-success" />;
  if (step.state === 'failed') return <Icon name="alert" size={12} className="text-attention" />;
  if (step.state === 'skipped') return <Icon name="skip" size={12} className="text-fg-muted" />;
  return <Icon name="circle" size={12} className="text-fg-muted" />;
}

export function StepList({ steps }: { steps: Step[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!steps.some((s) => s.state === 'running')) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [steps]);
  return (
    <ul className="space-y-1.5">
      {steps.map((s) => (
        <li key={s.id} className="flex items-start gap-2 text-sm">
          <span className="mt-1"><StepIcon step={s} /></span>
          <div className="min-w-0 flex-1">
            <div className={s.state === 'pending' ? 'text-fg-muted' : ''}>{s.label}</div>
            {s.detail && <div className="text-xs text-fg-muted">{s.detail}</div>}
          </div>
          <span className="font-mono text-xs text-fg-muted">{elapsed(s, now)}</span>
        </li>
      ))}
    </ul>
  );
}

function Passes({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const running = steps.find((s) => s.state === 'running');
  const failed = steps.filter((s) => s.state === 'failed');
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs text-fg-muted hover:bg-btn-hover hover:text-fg"
        aria-expanded={open}
      >
        {running ? <><Spinner size={12} />{running.label}…</>
          : failed.length > 0 ? <><Icon name="alert" size={12} className="text-attention" />{failed.length} pass{failed.length === 1 ? '' : 'es'} degraded</>
            : <><Icon name="checkCircle" size={12} className="text-success" />All passes done</>}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-40 mt-1 w-96 rounded-md border border-border bg-overlay p-3 shadow-xl">
          <StepList steps={steps} />
        </div>
      )}
    </div>
  );
}

function Gauge({ snapshot }: { snapshot: SessionSnapshot }) {
  const meat = snapshot.meat;
  if (!meat) return null;
  const frac = meat.totalLines === 0 ? 1 : meat.keptLines / meat.totalLines;
  return (
    <div className="inline-flex items-center gap-2 text-xs text-fg-muted" title="How much of the diff the abridgement kept">
      <span className="relative inline-block h-1.5 w-24 overflow-hidden rounded-full bg-neutral-muted">
        <span className="absolute inset-y-0 left-0 rounded-full bg-done" style={{ width: `${Math.round(frac * 100)}%` }} />
      </span>
      <span>
        kept <span className="font-semibold text-fg">{meat.keptLines}/{meat.totalLines}</span> lines · {meat.keptFiles}/{meat.totalFiles} files
      </span>
      {meat.unclassified > 0 && (
        <Label tone="attention" title={meat.classifierError?.detail ?? ''}>{meat.unclassified} kept unjudged</Label>
      )}
    </div>
  );
}

export function Header({
  snapshot, theme, onTheme, onAsk, onSubmit, pending, onHome,
}: {
  snapshot: SessionSnapshot;
  theme: Theme;
  onTheme: () => void;
  onAsk: () => void;
  onSubmit: () => void;
  pending: number;
  onHome: () => void;
}) {
  const pr = snapshot.pr;
  const source = snapshot.source;
  return (
    <header className="border-b border-border bg-canvas px-4 py-2.5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onHome} className="font-semibold text-done hover:underline" title="All pull requests">marrow</button>
        <span className="text-fg-muted">/</span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg leading-tight font-semibold">
            {pr?.title ?? `Pull request #${snapshot.number}`} <span className="font-normal text-fg-muted">#{snapshot.number}</span>
          </h1>
        </div>
        <Button tone="invisible" icon={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'deviceDesktop'} onClick={onTheme} aria-label={`Theme: ${theme}`} title={`Theme: ${theme}`} />
        <Button tone="agent" icon="sparkle" shortcut="ask" onClick={onAsk}>Ask Claude</Button>
        <Button tone="primary" shortcut="submit" onClick={onSubmit} disabled={!pr}>
          Review changes{pending > 0 && <span className="rounded-full bg-white/20 px-1.5 text-xs">{pending}</span>}
        </Button>
      </div>
      {pr && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${pr.isDraft ? 'bg-fg-muted text-white' : STATE_PILL[pr.state]}`}>
            <Icon name="pr" size={12} />{pr.isDraft ? 'Draft' : pr.state[0]!.toUpperCase() + pr.state.slice(1)}
          </span>
          <span className="inline-flex items-center gap-1"><Avatar login={pr.author} size={16} /><span className="font-semibold">{pr.author}</span></span>
          <span className="inline-flex items-center gap-1 text-fg-muted">
            <span className="rounded-md bg-accent-subtle px-1.5 font-mono text-accent">{pr.baseRef}</span>←
            <span className="rounded-md bg-accent-subtle px-1.5 font-mono text-accent">{pr.headRef}</span>
          </span>
          <Gauge snapshot={snapshot} />
          {source && (
            <Label tone={source.canSearch ? 'muted' : 'attention'} title={source.canSearch ? 'The agent reads a local checkout' : 'The agent reads files through the GitHub API and cannot search the repository'}>
              source: {source.kind}{source.canSearch ? '' : ' · no search'}
            </Label>
          )}
          <Passes steps={snapshot.steps} />
        </div>
      )}
    </header>
  );
}
