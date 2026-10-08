import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isShown } from '../lib/findings.js';
import { SHORTCUTS } from '../lib/keymap.js';
import { githubProblem, syntaxProblems } from '../api.js';
import type { GitHubProblem, SessionSnapshot, SyntaxProblem, Verdict } from '../lib/types.js';
import { Composer } from './Composer.js';
import { GitHubNotice } from './GitHubNotice.js';
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

const VERDICT_TEXT: Record<Verdict, { label: string; help: string; digit: string }> = {
  COMMENT: { label: 'Comment', help: 'Submit general feedback without explicit approval.', digit: '1' },
  APPROVE: { label: 'Approve', help: 'Submit feedback and approve merging these changes.', digit: '2' },
  REQUEST_CHANGES: { label: 'Request changes', help: 'Submit feedback that must be addressed before merging.', digit: '3' },
};
const VERDICTS = Object.keys(VERDICT_TEXT) as Verdict[];

export function SubmitDialog({
  open, onClose, snapshot, context, comments, onSubmit, onCheck,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: SessionSnapshot;
  context: string;
  /** How many inline comments will post: the reviewer's plus accepted findings. */
  comments: { mine: number; findings: number };
  onSubmit: (verdict: Verdict, body: string, ignoreSyntax: boolean) => Promise<void>;
  /** Lints the suggestions that would post; submit checks again, so this is only an early warning. */
  onCheck: () => Promise<SyntaxProblem[]>;
}) {
  const [verdict, setVerdict] = useState<Verdict>(snapshot.draft.verdict ?? 'COMMENT');
  const [body, setBody] = useState(snapshot.draft.body);
  const [error, setError] = useState<{ message: string; github: GitHubProblem | null } | null>(null);
  const [problems, setProblems] = useState<SyntaxProblem[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setProblems(null);
    // A check that fails to run says nothing; submit checks again anyway.
    onCheck().then((found) => { if (current && found.length > 0) setProblems(found); }, () => {});
    return () => { current = false; };
  }, [open]);
  const isAuthor = snapshot.pr?.viewerIsAuthor === true;
  const pendingFindings = snapshot.findings.items.filter((f) => f.state === 'pending' && isShown(f, snapshot.scoreThreshold)).length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(verdict, body, problems !== null);
    } catch (e) {
      const found = syntaxProblems(e);
      if (found) setProblems(found);
      else setError({ message: (e as Error).message, github: githubProblem(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Finish your review" width="44rem">
      <div
        className="space-y-4 px-4 py-3"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); return; }
          // e.code, because on a Mac ⌥1 reports e.key as "¡".
          const v = e.altKey && !e.metaKey && !e.ctrlKey ? VERDICTS.find((x) => e.code === `Digit${VERDICT_TEXT[x].digit}`) : undefined;
          if (!v) return;
          e.preventDefault();
          if (!(isAuthor && v !== 'COMMENT')) setVerdict(v);
        }}
      >
        <Composer value={body} onChange={setBody} context={context} label="Review summary" placeholder="Leave a summary (optional)" minRows={4} autoFocus />
        <fieldset className="space-y-2">
          {VERDICTS.map((v) => {
            const blocked = isAuthor && v !== 'COMMENT';
            return (
              <label key={v} className={`flex gap-2 ${blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                <input type="radio" name="verdict" checked={verdict === v} disabled={blocked} onChange={() => setVerdict(v)} aria-keyshortcuts={`Alt+${VERDICT_TEXT[v].digit}`} className="mt-1 accent-[var(--gh-accent-emphasis)]" />
                <span>
                  <span className="font-semibold">{VERDICT_TEXT[v].label}</span>{!blocked && <span className="text-fg-muted"><Kbd>{`⌥${VERDICT_TEXT[v].digit}`}</Kbd></span>}
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
        {/* Sticky, because a failure otherwise lands below the fold of a short window and looks like nothing happened. */}
        <div className="sticky bottom-0 -mx-4 -mb-3 space-y-3 border-t border-border bg-overlay px-4 py-3">
          {problems && (
            <div role="alert" className="space-y-1.5 rounded-md border border-attention/40 px-3 py-2 text-sm">
              <p className="text-attention">{problems.length === 1 ? 'A suggestion does' : `${problems.length} suggestions do`} not parse as PHP once applied.</p>
              <ul className="space-y-1">
                {problems.map((p) => (
                  <li key={`${p.commentId}:${p.message}`}>
                    <span className="font-mono text-xs">{p.path}:{p.startLine === null ? p.line : `${p.startLine}-${p.line}`}</span>
                    <span className="block text-xs text-fg-muted">{p.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <GitHubNotice message={error.message} github={error.github}>
              {/* With no response, GitHub may have created the review before the connection dropped. */}
              {error.github && error.github.status === null
                ? <p className="text-fg">GitHub may have received it anyway. <a href={snapshot.pr?.htmlUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">Check the pull request</a> before submitting again; your draft is kept.</p>
                : error.github && <p className="text-fg">Nothing was posted; your draft is kept.</p>}
            </GitHubNotice>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button tone="primary" onClick={() => void submit()} disabled={busy}>{busy ? 'Submitting…' : problems ? 'Submit anyway' : 'Submit review'}<Kbd>⌘↵</Kbd></Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
