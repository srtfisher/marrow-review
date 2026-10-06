import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isShown } from '../lib/findings.js';
import { SHORTCUTS } from '../lib/keymap.js';
import type { SessionSnapshot, Verdict } from '../lib/types.js';
import { Composer } from './Composer.js';
import { Icon } from './icons.js';
import { Button, Kbd } from './ui.js';

export function Dialog({ open, onClose, title, children, width = '28rem' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ width: `min(${width}, calc(100vw - 2rem))` }}
      className="m-auto max-h-[calc(100vh-4rem)] rounded-xl border border-border bg-overlay p-0 text-fg shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex items-center border-b border-border px-4 py-3">
        <h2 className="flex-1 font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-fg-muted hover:bg-btn-hover hover:text-fg"><Icon name="x" /></button>
      </div>
      {open && children}
    </dialog>
  );
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width="40rem">
      <div className="grid gap-x-6 gap-y-4 px-4 py-3 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g}>
            <h3 className="mb-1 text-xs font-semibold text-fg-muted">{g}</h3>
            <dl className="divide-y divide-border-muted">
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4 py-1.5 text-sm">
                  <dt>{s.description}</dt>
                  <dd><kbd className="min-w-6 rounded border border-border bg-canvas-subtle px-1.5 text-center font-mono text-xs leading-5">{s.label}</kbd></dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section className="sm:col-span-2">
          <h3 className="mb-1 text-xs font-semibold text-fg-muted">Mouse</h3>
          <p className="text-sm">Click a line number to put the cursor there; drag or shift-click across the gutter to select a block; the <span className="rounded bg-accent-emphasis px-1 text-white">+</span> beside a line comments on it.</p>
        </section>
      </div>
    </Dialog>
  );
}

const VERDICT_TEXT: Record<Verdict, { label: string; help: string }> = {
  COMMENT: { label: 'Comment', help: 'Submit general feedback without explicit approval.' },
  APPROVE: { label: 'Approve', help: 'Submit feedback and approve merging these changes.' },
  REQUEST_CHANGES: { label: 'Request changes', help: 'Submit feedback that must be addressed before merging.' },
};

export function SubmitDialog({
  open, onClose, snapshot, context, comments, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: SessionSnapshot;
  context: string;
  /** How many inline comments will post: the reviewer's plus accepted findings. */
  comments: { mine: number; findings: number };
  onSubmit: (verdict: Verdict, body: string) => Promise<void>;
}) {
  const [verdict, setVerdict] = useState<Verdict>(snapshot.draft.verdict ?? 'COMMENT');
  const [body, setBody] = useState(snapshot.draft.body);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAuthor = snapshot.pr?.viewerIsAuthor === true;
  const pendingFindings = snapshot.findings.items.filter((f) => f.state === 'pending' && isShown(f, snapshot.scoreThreshold)).length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(verdict, body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Finish your review" width="44rem">
      <div
        className="space-y-4 px-4 py-3"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
      >
        <Composer value={body} onChange={setBody} context={context} label="Review summary" placeholder="Leave a summary (optional)" minRows={4} />
        <fieldset className="space-y-2">
          {(Object.keys(VERDICT_TEXT) as Verdict[]).map((v) => {
            const blocked = isAuthor && v !== 'COMMENT';
            return (
              <label key={v} className={`flex gap-2 ${blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                <input type="radio" name="verdict" checked={verdict === v} disabled={blocked} onChange={() => setVerdict(v)} className="mt-1 accent-[var(--gh-accent-emphasis)]" />
                <span>
                  <span className="font-semibold">{VERDICT_TEXT[v].label}</span>
                  <span className="block text-xs text-fg-muted">{blocked ? 'GitHub does not allow this on your own pull request.' : VERDICT_TEXT[v].help}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="rounded-md border border-border bg-canvas-subtle px-3 py-2 text-sm">
          <p>
            <span className="font-semibold">{comments.mine + comments.findings}</span> inline comment{comments.mine + comments.findings === 1 ? '' : 's'} will post
            {comments.findings > 0 && <> ({comments.findings} from Claude's findings)</>}.
          </p>
          {pendingFindings > 0 && <p className="text-attention">{pendingFindings} finding{pendingFindings === 1 ? ' is' : 's are'} still untriaged and will not be posted.</p>}
          <p className="text-xs text-fg-muted">A comment on a line GitHub cannot anchor moves into the summary instead of being lost.</p>
        </div>
        {error && <p className="rounded-md border border-danger/40 bg-danger-subtle px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" onClick={() => void submit()} disabled={busy}>{busy ? 'Submitting…' : 'Submit review'}<Kbd>⌘↵</Kbd></Button>
        </div>
      </div>
    </Dialog>
  );
}
