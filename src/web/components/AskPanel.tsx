import { useEffect, useRef, useState } from 'react';
import type { SessionSnapshot } from '../lib/types.js';
import { Icon } from './icons.js';
import { Button, Markdown, Spinner } from './ui.js';

export function AskPanel({
  chat, scope, context, onAsk, onClose,
}: {
  chat: SessionSnapshot['chat'];
  /** What the next question is about, e.g. `src/app.ts:12–18`. */
  scope: string | null;
  context: string;
  onAsk: (question: string, fresh: boolean) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  // "New" starts the next question in a fresh conversation; until then the old turns are hidden.
  const [fresh, setFresh] = useState(false);
  const [hidden, setHidden] = useState(0);
  const turns = chat.session.turns.slice(hidden);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.session.turns.length, chat.pending]);

  const send = () => {
    const q = question.trim();
    if (!q || chat.pending) return;
    onAsk(q, fresh);
    if (fresh) { setFresh(false); setHidden(0); }
    setQuestion('');
  };

  return (
    <aside className="flex h-full w-[min(28rem,100vw)] flex-col border-l border-border bg-canvas" aria-label="Ask Claude">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Icon name="sparkle" className="text-done" />
        <h2 className="flex-1 font-semibold">Ask Claude</h2>
        {turns.length > 0 && <Button size="sm" tone="invisible" onClick={() => { setFresh(true); setHidden(chat.session.turns.length); }}>New conversation</Button>}
        <Button size="sm" tone="invisible" icon="x" onClick={onClose} aria-label="Close">Esc</Button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <p className="text-sm text-fg-muted">Ask about the code under the cursor. Claude reads the repository at the pull request's head, read-only.</p>
        )}
        {turns.map((t, i) => (
          t.role === 'user'
            ? <div key={i} className="ml-8 rounded-lg bg-accent-subtle px-3 py-2 text-sm whitespace-pre-wrap">{t.text}</div>
            : <div key={i} className="mr-4 rounded-lg border border-done/30 bg-done-subtle/40 px-3 py-2 text-sm"><Markdown text={t.text} context={context} /></div>
        ))}
        {chat.pending && <p className="flex items-center gap-2 text-sm text-fg-muted"><Spinner size={12} />Reading the code…</p>}
        <div ref={end} />
      </div>
      <div className="border-t border-border p-3">
        {scope && <p className="mb-1.5 truncate font-mono text-xs text-fg-muted">About {scope}</p>}
        <textarea
          ref={input}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          }}
          rows={3}
          placeholder="Why does this need a lock? ⏎ to ask, ⇧⏎ for a new line"
          className="block w-full resize-none rounded-md border border-border bg-canvas-inset px-3 py-2 text-sm outline-none focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
        />
      </div>
    </aside>
  );
}
