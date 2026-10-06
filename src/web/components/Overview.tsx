import { useState, type ReactNode } from 'react';
import type { SessionSnapshot } from '../lib/types.js';
import { isShown } from '../lib/findings.js';
import { Icon } from './icons.js';
import { Button, Kbd, Label, Markdown, Spinner } from './ui.js';

export function Overview({
  snapshot, context, outside, onRetry,
}: {
  snapshot: SessionSnapshot;
  context: string;
  /** Findings and comments with no line on the page; shown here so they are never off-screen for good. */
  outside: ReactNode;
  onRetry: () => void;
}) {
  const [showBody, setShowBody] = useState(false);
  const pr = snapshot.pr;
  const g = snapshot.grouping;
  const summary = g?.overallSummary || snapshot.meat?.summary || '';
  const failing = snapshot.checks.filter((c) => c.conclusion === 'failure');
  const items = snapshot.findings.items;
  const shown = items.filter((f) => isShown(f, snapshot.scoreThreshold ?? 80));
  const blocking = shown.filter((f) => f.severity === 'blocking' && f.kind === 'issue').length;
  const questions = shown.filter((f) => f.kind === 'question').length;
  const rest = shown.length - blocking - questions;
  const low = items.length - shown.length;
  const findStep = snapshot.steps.find((s) => s.id === 'find');
  const verifyStep = snapshot.steps.find((s) => s.id === 'verify');

  return (
    <section className="mb-6 rounded-md border border-border" id="overview">
      <div className="flex items-center gap-2 rounded-t-md border-b border-border bg-canvas-subtle px-4 py-2">
        <h2 className="font-semibold">Overview</h2>
        {g && (
          <span className="text-xs text-fg-muted">
            {g.source === 'model' || g.source === 'cache' ? 'grouped by intent' : g.source === 'single' ? 'small change, one group' : 'grouped by directory'}
          </span>
        )}
      </div>
      <div className="space-y-4 px-4 py-3">
        {summary ? <Markdown text={summary} context={context} /> : <p className="flex items-center gap-2 text-fg-muted"><Spinner />Reading the change…</p>}

        {pr?.body.trim() && (
          <div>
            <button type="button" onClick={() => setShowBody((s) => !s)} className="inline-flex items-center gap-1 text-xs font-semibold text-fg-muted hover:text-fg" aria-expanded={showBody}>
              <Icon name={showBody ? 'chevronDown' : 'chevronRight'} size={12} />Description from {pr.author}
            </button>
            {showBody && <div className="mt-2 rounded-md border border-border-muted px-3 py-2"><Markdown text={pr.body} context={context} /></div>}
          </div>
        )}

        {failing.length > 0 && (
          <div className="rounded-md border border-danger/40 bg-danger-subtle px-3 py-2 text-sm">
            <p className="font-semibold text-danger">{failing.length} failing check{failing.length === 1 ? '' : 's'}</p>
            <ul className="mt-1 list-disc pl-5">
              {failing.map((c) => (
                <li key={c.name}>
                  {c.detailsUrl ? <a href={c.detailsUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{c.name}</a> : c.name}
                  {c.output && <span className="text-fg-muted"> — {c.output}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1 font-semibold text-done"><Icon name="sparkle" size={14} />Claude's review</span>
          {snapshot.findings.status === 'finding' && (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-fg-muted">
              <Spinner size={12} /><span className="truncate">reviewing{findStep?.detail ? ` — ${findStep.detail}` : '…'}</span>
            </span>
          )}
          {snapshot.findings.status === 'verifying' && verifyStep?.state === 'running' && (
            <span className="inline-flex items-center gap-1.5 text-fg-muted"><Spinner size={12} />scoring — {verifyStep.detail ?? `${items.length} findings`}</span>
          )}
          {snapshot.findings.status === 'off' && (
            <>
              <span className="text-fg-muted">Review pass off.</span>
              <Button size="sm" shortcut="retry" onClick={onRetry}>Run it</Button>
            </>
          )}
          {snapshot.findings.status === 'failed' && (
            <>
              <span className="text-attention">{snapshot.findings.error?.summary} Your review is unaffected.</span>
              {snapshot.findings.error?.retryable !== false && <Button size="sm" shortcut="retry" onClick={onRetry}>Retry</Button>}
            </>
          )}
          {(snapshot.findings.status === 'done' || snapshot.findings.status === 'verifying') && (
            <>
              <Label tone={blocking > 0 ? 'danger' : 'muted'}>{blocking} blocking</Label>
              <Label>{rest} non-blocking</Label>
              {questions > 0 && <Label tone="accent">{questions} question{questions === 1 ? '' : 's'}</Label>}
              {low > 0 && <span className="text-xs text-fg-muted">{low} low confidence<Kbd>v</Kbd></span>}
              {snapshot.findings.status === 'done' && items.length === 0 && <span className="text-fg-muted">Nothing worth raising.</span>}
            </>
          )}
        </div>
        {outside}
      </div>
    </section>
  );
}
