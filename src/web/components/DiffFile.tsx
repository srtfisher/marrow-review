import { createContext, Fragment, memo, useContext, useState, type ReactNode } from 'react';
import { api } from '../api.js';
import { useHighlight, type Token } from '../highlight.js';
import { ariaKey, keyLabel } from '../lib/keymap.js';
import type { Block, FileView, LineRow } from '../lib/rows.js';
import type { DiffLine, TriagedFinding } from '../lib/types.js';
import { Icon } from './icons.js';
import { Kbd, Label } from './ui.js';

export interface DiffContextValue {
  sessionId: string;
  cursorKey: string | null;
  selected: ReadonlySet<string>;
  highlight: boolean;
  findingsByRow: Map<string, TriagedFinding[]>;
  /** Rendered under a row: cards, and the composer when it is anchored there. */
  renderBelow: (rowKey: string) => ReactNode;
  onRowMouseDown: (row: LineRow, extend: boolean) => void;
  onRowMouseEnter: (row: LineRow) => void;
  onCommentHere: (row: LineRow) => void;
  onReveal: (key: string) => void;
  onToggleCollapsed: (key: string) => void;
  viewed: Record<string, string>;
  fileHashes: Record<string, string>;
  onViewed: (path: string, viewed: boolean) => void;
  onJumpSection: (key: string) => void;
  sectionLabels: Record<string, string>;
  htmlUrl: string;
}

export const DiffContext = createContext<DiffContextValue | null>(null);

function useDiff(): DiffContextValue {
  const value = useContext(DiffContext);
  if (!value) throw new Error('DiffContext missing');
  return value;
}

const TONE = {
  add: { code: 'bg-diff-add', num: 'bg-diff-add-num', sign: '+' },
  del: { code: 'bg-diff-del', num: 'bg-diff-del-num', sign: '-' },
  context: { code: '', num: '', sign: ' ' },
} as const;

function Code({ text, tokens }: { text: string; tokens: Token[] | null | undefined }) {
  if (!tokens) return <>{text}</>;
  return <>{tokens.map((t, i) => <span key={i} className="shiki-token" style={t.style}>{t.content}</span>)}</>;
}

const CONTEXT_STEP = 20;

function HunkBlock({ file, block }: { file: FileView; block: Extract<Block, { kind: 'hunk' }> }) {
  const ctx = useDiff();
  const hunk = file.meatFile.hunks[block.hunkIndex]!.hunk;
  const lines = hunk.lines;
  const tokens = useHighlight(file.meatFile.file.path, lines, ctx.highlight);
  const [above, setAbove] = useState(0);
  const [fileLines, setFileLines] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const all = file.meatFile.file.hunks;
  const position = all.indexOf(hunk);
  const prev = position > 0 ? all[position - 1] : undefined;
  const prevEnd = prev ? prev.newStart + prev.newLines - 1 : 0;
  const available = file.meatFile.file.status === 'deleted' ? 0 : Math.max(0, hunk.newStart - 1 - prevEnd);
  const shown = Math.min(above, available);
  const offset = hunk.oldStart - hunk.newStart;

  const expand = async () => {
    if (!fileLines) {
      setLoading(true);
      try {
        setFileLines((await api.file(ctx.sessionId, file.meatFile.file.path, 'RIGHT')).split('\n'));
      } catch {
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    setAbove((n) => n + CONTEXT_STEP);
  };

  const extra: DiffLine[] = fileLines && shown > 0
    ? Array.from({ length: shown }, (_, i) => {
      const newLine = hunk.newStart - shown + i;
      return { kind: 'context' as const, text: fileLines[newLine - 1] ?? '', oldLine: newLine + offset, newLine, noNewlineAtEof: false };
    })
    : [];

  return (
    <>
      <tr>
        <td colSpan={2} className="bg-diff-hunk px-2 text-center align-middle">
          {available > shown && (
            <button
              type="button"
              onClick={() => void expand()}
              title={`Show up to ${CONTEXT_STEP} more lines above`}
              className="rounded p-0.5 text-fg-muted hover:bg-accent-emphasis hover:text-white"
              aria-label="Expand context above"
            >
              <Icon name="unfold" size={14} className={loading ? 'opacity-40' : ''} />
            </button>
          )}
        </td>
        <td className="bg-diff-hunk px-2 py-1 text-fg-muted">
          <span>{block.header.replace(/@@ (.*?) @@.*/, '@@ $1 @@')}</span>
          {block.section && <span className="ml-2">{block.section}</span>}
          {block.dropped
            ? <span className="ml-3"><Label>dropped: {block.reason}</Label></span>
            : <span className="ml-3 font-sans text-[11px] opacity-70">{block.reason}</span>}
        </td>
      </tr>
      {extra.map((line) => (
        <tr key={`x${line.newLine}`} className="text-fg-muted">
          <td className="w-[1%] min-w-10 select-none px-2 text-right">{line.oldLine}</td>
          <td className="w-[1%] min-w-10 select-none px-2 text-right">{line.newLine}</td>
          <td className="whitespace-pre px-2"><span className="mr-2 select-none"> </span>{line.text}</td>
        </tr>
      ))}
      {block.rows.map((row) => <Row key={row.key} row={row} tokens={tokens?.[row.lineIndex]} />)}
    </>
  );
}

const Row = memo(function Row({ row, tokens }: { row: LineRow; tokens: Token[] | null | undefined }) {
  const ctx = useDiff();
  const tone = TONE[row.line.kind];
  const isCursor = ctx.cursorKey === row.key;
  const isSelected = ctx.selected.has(row.key);
  const below = ctx.renderBelow(row.key);
  const num = `w-[1%] min-w-10 cursor-pointer select-none px-2 text-right align-top text-fg-muted hover:text-fg ${
    isSelected ? 'bg-diff-selected-num' : tone.num
  }`;
  return (
    <>
      <tr data-row={row.key} data-cursor={isCursor || undefined} className="group">
        <td
          className={num}
          onMouseDown={(e) => { e.preventDefault(); ctx.onRowMouseDown(row, e.shiftKey); }}
          onMouseEnter={(e) => { if (e.buttons === 1) ctx.onRowMouseEnter(row); }}
        >
          {row.line.oldLine ?? ''}
        </td>
        <td
          className={num}
          onMouseDown={(e) => { e.preventDefault(); ctx.onRowMouseDown(row, e.shiftKey); }}
          onMouseEnter={(e) => { if (e.buttons === 1) ctx.onRowMouseEnter(row); }}
        >
          {row.line.newLine ?? ''}
        </td>
        <td className={`relative whitespace-pre px-2 align-top ${isSelected ? 'bg-diff-selected' : tone.code}`}>
          <button
            type="button"
            aria-label="Comment on this line"
            onClick={() => ctx.onCommentHere(row)}
            className={`absolute top-0 -left-2.5 z-10 flex h-5 w-5 items-center justify-center rounded-md bg-accent-emphasis text-white ${isCursor ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" /></svg>
          </button>
          <span className="mr-2 select-none text-fg-muted">{tone.sign}</span>
          <Code text={row.line.text} tokens={tokens} />
        </td>
      </tr>
      {below && (
        <tr>
          <td colSpan={3} className="border-y border-border bg-canvas p-0 font-sans text-sm leading-normal whitespace-normal">{below}</td>
        </tr>
      )}
    </>
  );
});

function Fold({ file, block }: { file: FileView; block: Extract<Block, { kind: 'fold' }> }) {
  const ctx = useDiff();
  const whole = file.meatFile.dropped !== null;
  const count = block.hunkIndexes.length;
  const reveal = () => {
    if (whole) ctx.onReveal(`${file.layout.fileIndex}:*`);
    else for (const i of block.hunkIndexes) ctx.onReveal(`${file.layout.fileIndex}:${i}`);
  };
  return (
    <tr>
      <td colSpan={3} className="border-y border-dashed border-border bg-canvas-subtle px-3 py-1.5 font-sans text-xs text-fg-muted">
        <button type="button" onClick={reveal} className="inline-flex items-center gap-2 hover:text-accent">
          <Icon name="unfold" size={12} />
          {whole
            ? <span>Whole file dropped: <span className="font-medium">{file.meatFile.dropped!.rule}</span></span>
            : <span>{count} hunk{count === 1 ? '' : 's'} folded ({block.lines} lines) · {block.reasons.join(', ')}</span>}
          <span className="text-accent">Reveal</span><Kbd>z</Kbd>
        </button>
      </td>
    </tr>
  );
}

export function DiffFile({ file }: { file: FileView }) {
  const ctx = useDiff();
  const f = file.meatFile.file;
  const collapseKey = `${file.sectionKey}:${file.layout.fileIndex}`;
  const hash = ctx.fileHashes[f.path];
  const viewedHash = ctx.viewed[f.path];
  const isViewed = viewedHash !== undefined && viewedHash === hash;
  const changedSince = viewedHash !== undefined && viewedHash !== hash;
  const findings = file.blocks.reduce((n, b) => n + (b.kind === 'hunk' ? b.rows.reduce((m, r) => m + (ctx.findingsByRow.get(r.key)?.length ?? 0), 0) : 0), 0);

  return (
    <div className="mb-4 rounded-md border border-border" data-file={collapseKey}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-t-md border-b border-border bg-canvas-subtle px-3 py-1.5">
        <button
          type="button"
          onClick={() => ctx.onToggleCollapsed(collapseKey)}
          className="rounded p-0.5 text-fg-muted hover:bg-btn-hover"
          aria-label={file.collapsed ? 'Expand file' : 'Collapse file'}
          aria-expanded={!file.collapsed}
        >
          <Icon name={file.collapsed ? 'chevronRight' : 'chevronDown'} />
        </button>
        <span className="min-w-0 truncate font-mono text-xs font-semibold">
          {f.oldPath && <span className="font-normal text-fg-muted">{f.oldPath} → </span>}{f.path}
        </span>
        {f.status !== 'modified' && <Label>{f.status}</Label>}
        <span className="font-mono text-xs"><span className="text-success">+{f.additions}</span> <span className="text-danger">−{f.deletions}</span></span>
        {findings > 0 && <Label tone="done">{findings} finding{findings === 1 ? '' : 's'}</Label>}
        {file.layout.alsoIn.length > 0 && (
          <span className="text-xs text-fg-muted">
            also in{' '}
            {file.layout.alsoIn.map((k, i) => (
              <Fragment key={k}>
                {i > 0 && ', '}
                <button type="button" className="text-accent hover:underline" onClick={() => ctx.onJumpSection(k)}>{ctx.sectionLabels[k] ?? k}</button>
              </Fragment>
            ))}
          </span>
        )}
        <div className="flex-1" />
        {changedSince && <Label tone="attention">changed since viewed</Label>}
        {ctx.htmlUrl && (
          <a href={`${ctx.htmlUrl}/files`} target="_blank" rel="noreferrer" className="text-xs text-fg-muted hover:text-accent" title="Open on GitHub">GitHub</a>
        )}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-btn px-2 py-0.5 text-xs hover:bg-btn-hover">
          <input type="checkbox" checked={isViewed} onChange={(e) => ctx.onViewed(f.path, e.target.checked)} aria-keyshortcuts={ariaKey('viewed')} className="accent-[var(--gh-accent-emphasis)]" />
          Viewed<Kbd>{keyLabel('viewed')}</Kbd>
        </label>
      </div>
      {!file.collapsed && (
        file.blocks.length === 0 ? (
          <p className="px-4 py-3 text-sm text-fg-muted">{f.status === 'binary' ? 'Binary file not shown.' : f.status === 'renamed' ? 'Renamed without changes.' : 'No changes to show.'}</p>
        ) : (
          <div className="overflow-x-auto rounded-b-md">
            <table className="w-full border-collapse font-mono text-xs leading-5">
              <tbody>
                {file.blocks.map((block) => (block.kind === 'fold'
                  ? <Fold key={`f${block.hunkIndexes[0]}`} file={file} block={block} />
                  : <HunkBlock key={`h${block.hunkIndex}`} file={file} block={block} />))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
