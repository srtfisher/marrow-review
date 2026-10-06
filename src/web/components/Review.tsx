import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api.js';
import { useReviewNotice, useSession, type Theme } from '../hooks.js';
import { placeByRow, rangeAnchor, suggestionText, type Anchor } from '../lib/anchor.js';
import { isLow, isShown } from '../lib/findings.js';
import { insertSuggestion } from '../lib/autocomplete.js';
import { actionFor, type Action } from '../lib/keymap.js';
import { stepFile, stepMarked, stepSection } from '../lib/nav.js';
import { buildPage, navRows, type LineRow, type ViewOptions } from '../lib/rows.js';
import type { StagedComment, TriagedFinding, TriageAction, Verdict } from '../lib/types.js';
import { AskPanel } from './AskPanel.js';
import { FindingCard, PendingComment, ThreadCard } from './Cards.js';
import { Composer } from './Composer.js';
import { ShortcutsDialog, SubmitDialog } from './Dialogs.js';
import { DiffContext, DiffFile, type DiffContextValue } from './DiffFile.js';
import { Header, StepList } from './Header.js';
import { Icon } from './icons.js';
import { Overview } from './Overview.js';
import { Sidebar } from './Sidebar.js';
import { Button, Label, Markdown } from './ui.js';

interface ComposerState {
  rowKey: string;
  anchor: Anchor;
  body: string;
  suggestion: string | null;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function newId(): string {
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function scrollToRow(key: string, block: ScrollLogicalPosition = 'nearest'): void {
  document.querySelector(`[data-row="${CSS.escape(key)}"]`)?.scrollIntoView({ block });
}

export function Review({
  sessionId, viewer, theme, onTheme, onHome,
}: {
  sessionId: string;
  viewer: string;
  theme: Theme;
  onTheme: () => void;
  onHome: () => void;
}) {
  const { snapshot, dropped } = useSession(sessionId);
  useReviewNotice(snapshot);
  const [view, setView] = useState<ViewOptions>({ fullDiff: false, revealAll: false, revealed: new Set(), collapsed: new Set() });
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ from: string; to: string } | null>(null);
  const [rangeMode, setRangeMode] = useState(false);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [sidebar, setSidebar] = useState<'groups' | 'files'>('groups');
  const [showThreads, setShowThreads] = useState(true);
  const [showLow, setShowLow] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askScope, setAskScope] = useState<{ label: string; context: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitted, setSubmitted] = useState<{ url: string; demoted: number } | null>(null);
  const [editNonce, setEditNonce] = useState(0);
  const dragging = useRef(false);

  const context = snapshot ? `${snapshot.owner}/${snapshot.repo}` : '';

  const page = useMemo(
    () => (snapshot?.meat ? buildPage(snapshot.meat, snapshot.sections, view) : []),
    [snapshot?.meat, snapshot?.sections, view],
  );
  const rows = useMemo(() => navRows(page), [page]);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);
  const cursorIndex = cursorKey ? rowIndex.get(cursorKey) ?? -1 : -1;
  const cursorRow = cursorIndex >= 0 ? rows[cursorIndex]! : null;

  // The cursor starts on the first line, and lands somewhere sensible if its row folds away.
  useEffect(() => {
    if (rows.length === 0) return;
    if (cursorKey === null || !rowIndex.has(cursorKey)) setCursorKey(rows[0]!.key);
  }, [rows, rowIndex, cursorKey]);

  const findings = useMemo(
    () => (snapshot?.findings.items ?? []).filter((f) => showLow || isShown(f, snapshot?.scoreThreshold ?? 80)),
    [snapshot?.findings.items, snapshot?.scoreThreshold, showLow],
  );
  const placedFindings = useMemo(() => placeByRow(rows, findings), [rows, findings]);
  const placedComments = useMemo(() => placeByRow(rows, snapshot?.draft.comments ?? []), [rows, snapshot?.draft.comments]);
  const placedThreads = useMemo(
    () => placeByRow(rows, showThreads ? (snapshot?.threads ?? []).filter((t) => !t.isOutdated) : []),
    [rows, snapshot?.threads, showThreads],
  );
  const marked = useMemo(() => new Set([...placedFindings.byRow.keys(), ...placedComments.byRow.keys()]), [placedFindings, placedComments]);
  const focusedFinding: TriagedFinding | null = cursorKey ? placedFindings.byRow.get(cursorKey)?.find((f) => f.state !== 'dropped') ?? null : null;

  const selected = useMemo(() => {
    if (!selection || selection.from === selection.to) return new Set<string>();
    const a = rowIndex.get(selection.from);
    const b = rowIndex.get(selection.to);
    if (a === undefined || b === undefined) return new Set<string>();
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const end = rows[b]!;
    return new Set(rows.slice(lo, hi + 1).filter((r) => r.fileIndex === end.fileIndex).map((r) => r.key));
  }, [selection, rowIndex, rows]);

  const moveTo = useCallback((index: number, block: ScrollLogicalPosition = 'nearest') => {
    const row = rows[index];
    if (!row) return;
    setCursorKey(row.key);
    if (rangeMode) setSelection((s) => (s ? { ...s, to: row.key } : s));
    requestAnimationFrame(() => scrollToRow(row.key, block));
  }, [rows, rangeMode]);

  const currentAnchor = useCallback((): { anchor: Anchor; rowKey: string } | null => {
    if (!cursorRow) return null;
    if (selection && selected.size > 1) {
      const anchor = rangeAnchor(rows, selection.from, selection.to);
      if (anchor) return { anchor, rowKey: selection.to };
    }
    return { anchor: { path: cursorRow.path, side: cursorRow.side, line: cursorRow.number, startLine: null }, rowKey: cursorRow.key };
  }, [cursorRow, selection, selected.size, rows]);

  const openComposer = useCallback((withSuggestion: boolean) => {
    const target = currentAnchor();
    if (!target) return;
    const suggestion = suggestionText(rows, target.anchor);
    const body = withSuggestion && suggestion !== null ? insertSuggestion('', 0, suggestion).text : '';
    setComposer({ ...target, body, suggestion });
    setRangeMode(false);
  }, [currentAnchor, rows]);

  const saveDraft = useCallback((comments: StagedComment[]) => {
    if (!snapshot) return;
    void api.draft(sessionId, { ...snapshot.draft, comments });
  }, [snapshot, sessionId]);

  const saveComposer = useCallback(() => {
    if (!composer || !snapshot || !composer.body.trim()) return;
    const { anchor } = composer;
    saveDraft([...snapshot.draft.comments, {
      id: newId(), path: anchor.path, line: anchor.line, side: anchor.side, startLine: anchor.startLine, body: composer.body, suggestion: null,
    }]);
    setComposer(null);
    setSelection(null);
  }, [composer, snapshot, saveDraft]);

  const triage = useCallback((id: string, action: TriageAction, body?: string) => {
    void api.triage(sessionId, id, action, body);
  }, [sessionId]);

  const ask = useCallback(() => {
    const target = currentAnchor();
    if (target && cursorRow) {
      const { anchor } = target;
      const lines = selected.size > 1 ? rows.filter((r) => selected.has(r.key)) : rows.filter((r) => r.fileIndex === cursorRow.fileIndex && r.hunkIndex === cursorRow.hunkIndex);
      const header = snapshot?.meat?.files[cursorRow.fileIndex]?.hunks[cursorRow.hunkIndex]?.hunk.header ?? '';
      const text = lines.map((r) => `${r.line.kind === 'add' ? '+' : r.line.kind === 'del' ? '-' : ' '}${r.line.text}`).join('\n');
      const range = anchor.startLine !== null ? `${anchor.startLine}–${anchor.line}` : `${anchor.line}`;
      setAskScope({ label: `${anchor.path}:${range}`, context: `File: ${anchor.path}\n${header}\n${text}` });
    }
    setAskOpen(true);
  }, [currentAnchor, cursorRow, rows, selected, snapshot?.meat]);

  const jumpSection = useCallback((key: string) => {
    const row = rows.find((r) => r.sectionKey === key);
    // Not moveTo: its deferred row scroll would land after this one and bury the heading under the sticky file header.
    if (row) setCursorKey(row.key);
    document.getElementById(`section-${key}`)?.scrollIntoView({ block: 'start' });
  }, [rows]);

  const jumpFile = useCallback((fileIndex: number) => {
    const i = rows.findIndex((r) => r.fileIndex === fileIndex);
    if (i >= 0) moveTo(i, 'center');
    else document.querySelector(`[data-file$=":${fileIndex}"]`)?.scrollIntoView({ block: 'start' });
  }, [rows, moveTo]);

  const toggleViewed = useCallback((path: string, viewed: boolean) => {
    void api.viewed(sessionId, path, viewed);
    // A viewed file folds to its header, as on GitHub.
    setView((v) => {
      const collapsed = new Set(v.collapsed);
      for (const s of page) for (const f of s.files) {
        if (f.meatFile.file.path !== path) continue;
        const key = `${s.section.key}:${f.layout.fileIndex}`;
        if (viewed) collapsed.add(key); else collapsed.delete(key);
      }
      return { ...v, collapsed };
    });
  }, [sessionId, page]);

  const run = useCallback((action: Action) => {
    if (!snapshot) return;
    const i = Math.max(0, cursorIndex);
    switch (action) {
      case 'down': return moveTo(Math.min(i + 1, rows.length - 1));
      case 'up': return moveTo(Math.max(i - 1, 0));
      case 'nextFile': return moveTo(stepFile(rows, i, 1), 'center');
      case 'prevFile': return moveTo(stepFile(rows, i, -1), 'center');
      case 'nextGroup': return moveTo(stepSection(rows, i, 1), 'center');
      case 'prevGroup': return moveTo(stepSection(rows, i, -1), 'center');
      case 'nextFinding': { const j = stepMarked(rows, i, marked, 1); if (j >= 0) moveTo(j, 'center'); return; }
      case 'prevFinding': { const j = stepMarked(rows, i, marked, -1); if (j >= 0) moveTo(j, 'center'); return; }
      case 'comment': return openComposer(false);
      case 'range':
        if (rangeMode) { setRangeMode(false); setSelection(null); } else if (cursorKey) { setRangeMode(true); setSelection({ from: cursorKey, to: cursorKey }); }
        return;
      case 'suggest':
        if (focusedFinding?.suggestion) return triage(focusedFinding.id, 'suggest');
        return openComposer(true);
      case 'accept': if (focusedFinding) triage(focusedFinding.id, 'accept'); return;
      case 'drop': if (focusedFinding) triage(focusedFinding.id, 'drop'); return;
      case 'edit': if (focusedFinding) setEditNonce((n) => n + 1); return;
      case 'reveal': {
        if (!cursorRow) return;
        const file = snapshot.meat?.files[cursorRow.fileIndex];
        if (!file) return;
        setView((v) => ({ ...v, revealed: new Set([...v.revealed, `${cursorRow.fileIndex}:*`, ...file.hunks.map((_, h) => `${cursorRow.fileIndex}:${h}`)]) }));
        return;
      }
      case 'revealAll': return setView((v) => ({ ...v, revealAll: !v.revealAll }));
      case 'fullDiff': return setView((v) => ({ ...v, fullDiff: !v.fullDiff }));
      case 'sidebar': return setSidebar((m) => (m === 'groups' ? 'files' : 'groups'));
      case 'threads': return setShowThreads((s) => !s);
      case 'lowConfidence': return setShowLow((s) => !s);
      case 'viewed': {
        if (!cursorRow) return;
        const path = cursorRow.path;
        const isViewed = snapshot.viewed[path] !== undefined && snapshot.viewed[path] === snapshot.fileHashes[path];
        toggleViewed(path, !isViewed);
        if (!isViewed) moveTo(stepFile(rows, i, 1), 'center');
        return;
      }
      case 'ask': return ask();
      case 'openGithub': if (snapshot.pr?.htmlUrl) window.open(`${snapshot.pr.htmlUrl}/files`, '_blank', 'noopener'); return;
      case 'help': return setHelpOpen(true);
      case 'usage': return setUsageOpen((o) => !o);
      case 'settings': return setSettingsOpen((o) => !o);
      case 'submit': return setSubmitOpen(true);
      case 'retry': if (['failed', 'done', 'off'].includes(snapshot.findings.status)) void api.retry(sessionId); return;
      case 'escape':
        if (composer) setComposer(null);
        else if (askOpen) setAskOpen(false);
        else if (usageOpen) setUsageOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else { setSelection(null); setRangeMode(false); }
        return;
    }
  }, [snapshot, cursorIndex, rows, moveTo, marked, openComposer, rangeMode, cursorKey, focusedFinding, triage, cursorRow, toggleViewed, ask, sessionId, composer, askOpen, usageOpen, settingsOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const action = actionFor(e.key);
      if (!action) return;
      e.preventDefault();
      run(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const renderBelow = useCallback((rowKey: string): ReactNode => {
    if (!snapshot) return null;
    const threads = placedThreads.byRow.get(rowKey) ?? [];
    const fs = placedFindings.byRow.get(rowKey) ?? [];
    const cs = placedComments.byRow.get(rowKey) ?? [];
    const here = composer?.rowKey === rowKey;
    if (threads.length + fs.length + cs.length === 0 && !here) return null;
    return (
      <div className="divide-y divide-border">
        {threads.map((t, i) => <ThreadCard key={`t${i}`} thread={t} />)}
        {fs.map((f) => (
          <FindingCard key={f.id} finding={f} threshold={snapshot.scoreThreshold} focused={f.id === focusedFinding?.id} editNonce={editNonce} context={context} onAction={(a, b) => triage(f.id, a, b)} />
        ))}
        {cs.map((c) => (
          <PendingComment
            key={c.id}
            comment={c}
            viewer={viewer}
            context={context}
            onSave={(body) => saveDraft(snapshot.draft.comments.map((x) => (x.id === c.id ? { ...x, body } : x)))}
            onDelete={() => saveDraft(snapshot.draft.comments.filter((x) => x.id !== c.id))}
          />
        ))}
        {here && composer && (
          <div className="bg-canvas-subtle p-3">
            <p className="mb-2 text-xs text-fg-muted">
              Commenting on {composer.anchor.side === 'LEFT' ? 'removed ' : ''}
              {composer.anchor.startLine !== null ? `lines ${composer.anchor.startLine}–${composer.anchor.line}` : `line ${composer.anchor.line}`}
            </p>
            <Composer
              value={composer.body}
              onChange={(body) => setComposer((c) => (c ? { ...c, body } : c))}
              onSubmit={saveComposer}
              onCancel={() => setComposer(null)}
              suggestion={composer.suggestion}
              context={context}
              autoFocus
              submitLabel="Add review comment"
            />
          </div>
        )}
      </div>
    );
  }, [snapshot, viewer, placedThreads, placedFindings, placedComments, composer, focusedFinding?.id, editNonce, context, triage, saveDraft, saveComposer]);

  const diffContext: DiffContextValue | null = snapshot ? {
    sessionId,
    cursorKey,
    selected,
    highlight: true,
    findingsByRow: placedFindings.byRow,
    renderBelow,
    onRowMouseDown: (row: LineRow, extend: boolean) => {
      dragging.current = true;
      if (extend && cursorKey) setSelection((s) => ({ from: s?.from ?? cursorKey, to: row.key }));
      else setSelection({ from: row.key, to: row.key });
      setCursorKey(row.key);
    },
    onRowMouseEnter: (row: LineRow) => {
      if (!dragging.current) return;
      setSelection((s) => (s ? { ...s, to: row.key } : { from: row.key, to: row.key }));
      setCursorKey(row.key);
    },
    onCommentHere: (row: LineRow) => {
      if (!selected.has(row.key)) { setSelection(null); setCursorKey(row.key); }
      const anchor = selected.has(row.key) && selection ? rangeAnchor(rows, selection.from, selection.to) : null;
      const a = anchor ?? { path: row.path, side: row.side, line: row.number, startLine: null };
      setComposer({ rowKey: anchor && selection ? selection.to : row.key, anchor: a, body: '', suggestion: suggestionText(rows, a) });
    },
    onReveal: (key: string) => setView((v) => ({ ...v, revealed: new Set([...v.revealed, key]) })),
    onToggleCollapsed: (key: string) => setView((v) => {
      const collapsed = new Set(v.collapsed);
      if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
      return { ...v, collapsed };
    }),
    viewed: snapshot.viewed,
    fileHashes: snapshot.fileHashes,
    onViewed: toggleViewed,
    onJumpSection: jumpSection,
    sectionLabels: Object.fromEntries(snapshot.sections.map((s) => [s.key, s.label])),
    htmlUrl: snapshot.pr?.htmlUrl ?? '',
  } : null;

  if (submitted) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <Icon name="checkCircle" size={40} className="mx-auto text-success" />
        <h1 className="mt-4 text-xl font-semibold">Review submitted</h1>
        {submitted.demoted > 0 && <p className="mt-2 text-sm text-fg-muted">{submitted.demoted} comment(s) could not anchor and were moved into the summary.</p>}
        <div className="mt-6 flex justify-center gap-2">
          <a href={submitted.url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md border border-border bg-btn px-3 py-1.5 text-sm font-medium hover:bg-btn-hover">View on GitHub</a>
          <Button tone="primary" onClick={onHome}>Back to pull requests</Button>
        </div>
      </div>
    );
  }

  if (!snapshot || !diffContext) {
    return <div className="flex h-full items-center justify-center text-fg-muted">{dropped ? 'Lost the connection to marrow. Is it still running?' : 'Connecting…'}</div>;
  }

  if (snapshot.loadError || !snapshot.meat) {
    return (
      <div className="flex h-full flex-col">
        <Header snapshot={snapshot} theme={theme} onTheme={onTheme} onAsk={() => {}} onSubmit={() => {}} pending={0} onHome={onHome} />
        <div className="mx-auto w-full max-w-lg px-4 py-12">
          {snapshot.loadError
            ? <p className="rounded-md border border-danger/40 bg-danger-subtle px-4 py-3 text-danger">{snapshot.loadError}</p>
            : <div className="rounded-md border border-border p-4"><h2 className="mb-3 font-semibold">Loading #{snapshot.number}</h2><StepList steps={snapshot.steps} /></div>}
        </div>
      </div>
    );
  }

  const accepted = snapshot.findings.items.filter((f) => f.state === 'accepted').length;
  const pending = snapshot.draft.comments.length + accepted;
  const findingCount = (sectionKey: string) => {
    let n = 0;
    for (const [key, list] of placedFindings.byRow) if (rows[rowIndex.get(key) ?? -1]?.sectionKey === sectionKey) n += list.filter((f) => f.state !== 'dropped').length;
    return n;
  };
  const outsideFindings = placedFindings.unplaced;
  const outsideComments = placedComments.unplaced;

  return (
    <DiffContext.Provider value={diffContext}>
      <div className="flex h-full flex-col">
        <Header
          snapshot={snapshot}
          theme={theme}
          onTheme={onTheme}
          onAsk={ask}
          onSubmit={() => setSubmitOpen(true)}
          pending={pending}
          onHome={onHome}
          usageOpen={usageOpen}
          onUsage={setUsageOpen}
          settingsOpen={settingsOpen}
          onSettings={setSettingsOpen}
        />
        {(snapshot.notes.length > 0 || dropped) && (
          <div className="space-y-1 border-b border-border bg-canvas-subtle px-4 py-1.5 text-xs">
            {dropped && <p className="text-danger">Lost the connection to marrow; changes will not save until it is back.</p>}
            {snapshot.notes.map((n, i) => (
              <p key={i} className={n.tone === 'danger' ? 'text-danger' : n.tone === 'pending' ? 'text-attention' : 'text-fg-muted'}>{n.text}</p>
            ))}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-72 shrink-0 md:block">
            <Sidebar
              page={page}
              snapshot={snapshot}
              mode={sidebar}
              onMode={() => setSidebar((m) => (m === 'groups' ? 'files' : 'groups'))}
              activeSection={cursorRow?.sectionKey ?? null}
              activeFile={cursorRow?.fileIndex ?? null}
              onJumpSection={jumpSection}
              onJumpFile={jumpFile}
              findingCount={findingCount}
            />
          </div>
          <main className="min-w-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button size="sm" shortcut="fullDiff" pressed={view.fullDiff} onClick={() => run('fullDiff')}>{view.fullDiff ? 'Full diff' : 'Abridged'}</Button>
              <Button size="sm" shortcut="threads" pressed={showThreads} onClick={() => run('threads')}>Threads{snapshot.threads.length > 0 ? ` (${snapshot.threads.length})` : ''}</Button>
              <Button size="sm" shortcut="lowConfidence" pressed={showLow} onClick={() => run('lowConfidence')}>Low confidence ({snapshot.findings.items.filter((f) => isLow(f, snapshot.scoreThreshold)).length})</Button>
              <Button size="sm" shortcut="revealAll" pressed={view.revealAll} onClick={() => run('revealAll')}>Reveal folds</Button>
              <div className="flex-1" />
              {rangeMode && <Label tone="accent">selecting — move with j/k, then c</Label>}
              <Button size="sm" tone="invisible" shortcut="help" onClick={() => setHelpOpen(true)}>Shortcuts</Button>
            </div>
            <Overview
              snapshot={snapshot}
              context={context}
              onRetry={() => run('retry')}
              outside={(outsideFindings.length > 0 || outsideComments.length > 0) && (
                <div className="rounded-md border border-border">
                  <p className="border-b border-border bg-canvas-subtle px-3 py-1.5 text-xs font-semibold text-fg-muted">Not on a line shown below</p>
                  <div className="divide-y divide-border">
                    {outsideFindings.map((f) => (
                      <div key={f.id}>
                        <p className="px-4 pt-2 font-mono text-xs text-fg-muted">{f.path}:{f.line}</p>
                        <FindingCard finding={f} threshold={snapshot.scoreThreshold} focused={false} context={context} onAction={(a, b) => triage(f.id, a, b)} />
                      </div>
                    ))}
                    {outsideComments.map((c) => (
                      <div key={c.id}>
                        <p className="px-4 pt-2 font-mono text-xs text-fg-muted">{c.path}:{c.line}</p>
                        <PendingComment comment={c} viewer={viewer} context={context}
                          onSave={(body) => saveDraft(snapshot.draft.comments.map((x) => (x.id === c.id ? { ...x, body } : x)))}
                          onDelete={() => saveDraft(snapshot.draft.comments.filter((x) => x.id !== c.id))} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            />
            {page.map(({ section, files }) => (
              <section key={section.key} id={`section-${section.key}`} className={`mb-8 ${section.depth === 1 ? 'ml-4 border-l-2 border-border pl-4' : ''}`}>
                <div className="mb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className={`font-semibold ${section.depth === 0 ? 'text-lg' : 'text-base'}`}>{section.label}</h2>
                    {section.kind === 'group' && <Label>{section.category}</Label>}
                    <span className="text-xs text-fg-muted">{files.length} file{files.length === 1 ? '' : 's'}</span>
                  </div>
                  {section.summary && <Markdown text={section.summary} context={context} className="mt-1 text-sm text-fg-muted" />}
                  {section.kind === 'dropped' && <p className="mt-1 text-sm text-fg-muted">Every hunk in these files was dropped by a named rule. Nothing is hidden: reveal any of them.</p>}
                </div>
                {files.map((f) => <DiffFile key={`${section.key}:${f.layout.fileIndex}`} file={f} />)}
              </section>
            ))}
          </main>
          {askOpen && (
            <AskPanel
              chat={snapshot.chat}
              scope={askScope?.label ?? null}
              context={context}
              onAsk={(q, fresh) => void api.chat(sessionId, q, askScope?.context, fresh)}
              onClose={() => setAskOpen(false)}
            />
          )}
        </div>
      </div>
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      {submitOpen && (
        <SubmitDialog
          open={submitOpen}
          onClose={() => setSubmitOpen(false)}
          snapshot={snapshot}
          context={context}
          comments={{ mine: snapshot.draft.comments.length, findings: accepted }}
          onSubmit={async (verdict: Verdict, body: string) => {
            const result = await api.submit(sessionId, verdict, body);
            setSubmitOpen(false);
            setSubmitted({ url: result.url, demoted: result.demoted.length });
          }}
        />
      )}
    </DiffContext.Provider>
  );
}
