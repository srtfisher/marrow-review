import { useEffect, useRef, useState } from 'react';
import { isLow, scoreTone } from '../lib/findings.js';
import { relativeTime } from '../lib/format.js';
import type { ReviewThread, StagedComment, TriagedFinding, TriageAction } from '../lib/types.js';
import { Composer } from './Composer.js';
import { Icon } from './icons.js';
import { Avatar, Button, Label, Markdown } from './ui.js';

const LENS_LABEL = { conventions: 'conventions', bugs: 'bugs', history: 'history', priorComments: 'prior comments', codeComments: 'code comments' } as const;

function SuggestionPreview({ code }: { code: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-canvas-subtle px-3 py-1 text-xs text-fg-muted">Suggested change</div>
      <pre className="overflow-x-auto font-mono text-xs leading-5">
        {code.split('\n').map((line, i) => (
          <div key={i} className="bg-diff-add px-2 whitespace-pre"><span className="mr-2 select-none text-fg-muted">+</span>{line}</div>
        ))}
      </pre>
    </div>
  );
}

export function FindingCard({
  finding, focused, context, onAction, editNonce = 0, threshold,
}: {
  finding: TriagedFinding;
  threshold: number;
  focused: boolean;
  context: string;
  onAction: (action: TriageAction, body?: string) => void;
  /** Bumped by the `e` key; the focused card opens its editor when it changes. */
  editNonce?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(finding.editedBody ?? finding.body);
  // Seeded at mount, so scrolling a card back into focus does not replay an old keypress.
  const seen = useRef(editNonce);
  useEffect(() => {
    if (editNonce === seen.current) return;
    seen.current = editNonce;
    if (focused) { setDraft(finding.editedBody ?? finding.body); setEditing(true); }
  }, [editNonce, focused, finding.editedBody, finding.body]);
  const isQuestion = finding.kind === 'question';
  const body = finding.editedBody ?? finding.body;

  if (finding.state === 'dropped') {
    return (
      <div className="flex items-center gap-2 border-l-4 border-done/30 bg-canvas-subtle px-4 py-1.5 text-xs text-fg-muted" data-finding={finding.id}>
        <Icon name="sparkle" size={12} className="text-done/60" />
        <span className="flex-1 truncate line-through">{finding.title}</span>
        <Button size="sm" tone="invisible" onClick={() => onAction('reset')}>Undo drop</Button>
      </div>
    );
  }

  return (
    <div
      data-finding={finding.id}
      className={`border-l-4 border-done bg-done-subtle/40 px-4 py-3 ${focused ? 'ring-2 ring-inset ring-done/40' : ''}`}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-done"><Icon name="sparkle" size={12} />Claude</span>
        {isQuestion ? <Label tone="accent">question</Label>
          : <Label tone={finding.severity === 'blocking' ? 'danger' : 'muted'}>{finding.severity}</Label>}
        <Label>{finding.type}</Label>
        {finding.score !== null && (
          <Label tone={scoreTone(finding.score, threshold)} title={finding.scoreReason ?? ''}>score {finding.score}</Label>
        )}
        {finding.lenses?.length > 0 && (
          <span className="text-xs text-fg-muted">via {finding.lenses.map((l) => LENS_LABEL[l]).join(', ')}</span>
        )}
        {finding.confidence !== 'high' && <span className="text-xs text-fg-muted">{finding.confidence} confidence</span>}
        {finding.state === 'accepted' && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-success"><Icon name="check" size={12} />Will post{finding.asSuggestion ? ' as a suggestion' : ''}</span>
        )}
      </div>
      <p className="mb-1 font-semibold">{finding.title}</p>
      {editing ? (
        <Composer
          value={draft}
          onChange={setDraft}
          context={context}
          autoFocus
          submitLabel="Save and accept"
          onSubmit={() => { onAction('edit', draft); setEditing(false); }}
          onCancel={() => { setDraft(body); setEditing(false); }}
        />
      ) : (
        <Markdown text={body} context={context} />
      )}
      {finding.failureScenario && !editing && (
        <div className="mt-2 rounded-md border border-border bg-canvas px-3 py-2 text-sm">
          <span className="text-xs font-semibold text-fg-muted">Failure scenario</span>
          <p className="whitespace-pre-wrap">{finding.failureScenario}</p>
        </div>
      )}
      {finding.suggestion && !editing && <div className="mt-2"><SuggestionPreview code={finding.suggestion} /></div>}
      {isLow(finding, threshold) && (
        <div className="mt-2 rounded-md border border-border bg-canvas px-3 py-2 text-xs text-fg-muted">
          <p className="font-semibold">Low confidence — scored {finding.score}, below {threshold}</p>
          {finding.scoreReason && <p>{finding.scoreReason}</p>}
        </div>
      )}
      {!editing && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {finding.state === 'pending' ? (
            <>
              <Button size="sm" tone="primary" icon="check" shortcut={focused ? 'accept' : undefined} onClick={() => onAction('accept')}>Accept</Button>
              <Button size="sm" shortcut={focused ? 'edit' : undefined} onClick={() => setEditing(true)}>Edit</Button>
              {finding.suggestion && <Button size="sm" shortcut={focused ? 'suggest' : undefined} onClick={() => onAction('suggest')}>Post as suggestion</Button>}
              <Button size="sm" tone="invisible" icon="x" shortcut={focused ? 'drop' : undefined} onClick={() => onAction('drop')}>Drop</Button>
            </>
          ) : (
            <>
              <Button size="sm" shortcut={focused ? 'edit' : undefined} onClick={() => setEditing(true)}>Edit</Button>
              {finding.suggestion && (
                <Button size="sm" onClick={() => onAction('suggest')}>{finding.asSuggestion ? 'Post as comment' : 'Post as suggestion'}</Button>
              )}
              <Button size="sm" tone="invisible" onClick={() => onAction('reset')}>Undo</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PendingComment({
  comment, viewer, context, onSave, onDelete,
}: {
  comment: StagedComment;
  viewer: string;
  context: string;
  onSave: (body: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const range = comment.startLine !== null ? `lines ${comment.startLine}–${comment.line}` : `line ${comment.line}`;
  return (
    <div className="border-l-4 border-attention bg-canvas px-4 py-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        <Avatar login={viewer} size={20} />
        <span className="font-semibold">{viewer}</span>
        <Label tone="attention">Pending</Label>
        <span className="text-fg-muted">{comment.side === 'LEFT' ? 'removed ' : ''}{range}</span>
        <div className="flex-1" />
        {!editing && <Button size="sm" tone="invisible" onClick={() => setEditing(true)}>Edit</Button>}
        {!editing && <Button size="sm" tone="invisible" icon="x" onClick={onDelete}>Delete</Button>}
      </div>
      {editing ? (
        <Composer
          value={draft}
          onChange={setDraft}
          context={context}
          autoFocus
          submitLabel="Update comment"
          onSubmit={() => { onSave(draft); setEditing(false); }}
          onCancel={() => { setDraft(comment.body); setEditing(false); }}
        />
      ) : (
        <Markdown text={comment.suggestion === null ? comment.body : `${comment.body}\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``} context={context} />
      )}
    </div>
  );
}

export function ThreadCard({ thread }: { thread: ReviewThread }) {
  return (
    <div className="border-l-4 border-border bg-canvas px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-fg-muted">
        <Icon name="comment" size={12} />
        <span>Existing thread</span>
        {thread.isResolved && <Label tone="success">Resolved</Label>}
        {thread.isOutdated && <Label>Outdated</Label>}
      </div>
      <div className="space-y-3">
        {thread.comments.map((c, i) => (
          <div key={i} className="flex gap-2">
            <Avatar login={c.author} src={c.avatarUrl} size={24} />
            <div className="min-w-0 flex-1">
              <div className="text-xs">
                <span className="font-semibold">{c.author}</span>{' '}
                {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="text-fg-muted hover:text-accent hover:underline">{relativeTime(c.createdAt)}</a>
                  : <span className="text-fg-muted">{relativeTime(c.createdAt)}</span>}
              </div>
              {c.bodyHtml ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: c.bodyHtml }} /> : <p className="whitespace-pre-wrap">{c.body}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
