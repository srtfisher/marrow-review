import { useCallback, useEffect, useRef, useState } from 'react';
import type { Theme } from '../hooks.js';
import type { SessionSnapshot, Step } from '../lib/types.js';
import { popoverAlign } from '../lib/popover.js';
import { formatCost, formatDuration, formatTokens, headlineTokens, usageRows } from '../lib/usage.js';
import { Icon } from './icons.js';
import { Avatar, Button, Kbd, Label, Spinner } from './ui.js';

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

/** Closes on an outside click, and picks the edge to hang from when it opens. */
function usePopover(open: boolean, onClose: () => void, width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [align, setAlign] = useState<'left' | 'right'>('left');
  useEffect(() => {
    if (!open) return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setAlign(popoverAlign(rect.left, rect.right, width, window.innerWidth));
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open, onClose, width]);
  const position = `${align === 'left' ? 'left-0' : 'right-0'} max-w-[calc(100vw-2rem)]`;
  return { ref, position };
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
  const close = useCallback(() => setOpen(false), []);
  const { ref, position } = usePopover(open, close, 384);
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
        <div className={`absolute top-full z-40 mt-1 w-96 rounded-md border border-border bg-overlay p-3 shadow-xl ${position}`}>
          <StepList steps={steps} />
        </div>
      )}
    </div>
  );
}

function Usage({ snapshot, open, onOpen }: { snapshot: SessionSnapshot; open: boolean; onOpen: (open: boolean) => void }) {
  const close = useCallback(() => onOpen(false), [onOpen]);
  const { ref, position } = usePopover(open, close, 544);
  const running = snapshot.steps.some((st) => st.state === 'running');
  const rows = usageRows(snapshot.usage);
  const total = snapshot.usageTotal;
  const cached = snapshot.meat?.files.reduce((n, f) => n + f.hunks.filter((h) => h.source === 'cache').length, 0) ?? 0;
  const cell = 'px-2 py-1 text-right font-mono tabular-nums';
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => onOpen(!open)}
        aria-expanded={open}
        aria-keyshortcuts="u"
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-fg-muted hover:bg-btn-hover hover:text-fg"
        title="Token usage by pass"
      >
        <span className="font-mono tabular-nums">{formatTokens(headlineTokens(total))}</span> tokens
        {total.costUsd > 0 && <span className="font-mono tabular-nums">· {formatCost(total.costUsd)}</span>}
        <Kbd>u</Kbd>
      </button>
      {open && (
        <div className={`absolute top-full z-40 mt-1 w-[34rem] overflow-x-auto rounded-md border border-border bg-overlay p-3 shadow-xl ${position}`}>
          <h3 className="mb-2 text-sm font-semibold">Token usage</h3>
          {rows.length === 0 ? (
            <p className="text-sm text-fg-muted">{running ? 'A model call is running; its usage appears when it finishes.' : 'No model calls were made.'}</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-fg-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-1 text-left font-medium">Pass</th>
                  <th className="px-2 py-1 text-right font-medium">Runs</th>
                  <th className="px-2 py-1 text-right font-medium">Input</th>
                  <th className="px-2 py-1 text-right font-medium">Output</th>
                  <th className="px-2 py-1 text-right font-medium" title="Context re-read from the prompt cache">Cache read</th>
                  <th className="px-2 py-1 text-right font-medium">Time</th>
                  <th className="px-2 py-1 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {[...rows, { label: 'Total', usage: total }].map(({ label, usage }) => (
                  <tr key={label} className={label === 'Total' ? 'border-t border-border font-semibold' : ''}>
                    <td className="px-2 py-1">{label}</td>
                    <td className={cell}>{usage.runs}{usage.failed > 0 && <span className="text-attention" title={`${usage.failed} failed`}> ({usage.failed}✕)</span>}</td>
                    <td className={cell}>{formatTokens(usage.inputTokens + usage.cacheCreationTokens)}</td>
                    <td className={cell}>{formatTokens(usage.outputTokens)}</td>
                    <td className={`${cell} text-fg-muted`}>{formatTokens(usage.cacheReadTokens)}</td>
                    <td className={cell}>{formatDuration(usage.durationMs)}</td>
                    <td className={cell}>{formatCost(usage.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-fg-muted">
            {rows.length > 0 && running && <>Passes still running are counted when each call finishes. </>}
            {cached > 0 && <>{cached} hunk{cached === 1 ? '' : 's'} came from the abridgement cache and cost nothing. </>}
            Time is summed per run, so passes that run in parallel add up past the wall clock.
            Cost is the API-equivalent estimate the agent SDK reports; a Claude Code subscription is not billed per token.
          </p>
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
  snapshot, theme, onTheme, onAsk, onSubmit, pending, onHome, usageOpen = false, onUsage = () => {},
}: {
  usageOpen?: boolean;
  onUsage?: (open: boolean) => void;
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
            {pr?.htmlUrl ? (
              <a href={pr.htmlUrl} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline" title="Open on GitHub">
                {pr.title} <span className="font-normal text-fg-muted">#{snapshot.number}</span>
              </a>
            ) : (
              <>{pr?.title ?? `Pull request #${snapshot.number}`} <span className="font-normal text-fg-muted">#{snapshot.number}</span></>
            )}
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
          {/* An older server sends no usage; the page outlives a rebuild under it. */}
          {snapshot.usageTotal && <Usage snapshot={snapshot} open={usageOpen} onOpen={onUsage} />}
        </div>
      )}
    </header>
  );
}
