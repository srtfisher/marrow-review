import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, emojiMap } from '../api.js';
import {
  findEmojiQuery, findMentionQuery, insertSuggestion, rankEmoji, replaceToken, type TokenQuery,
} from '../lib/autocomplete.js';
import { Avatar, Button, Kbd, Markdown } from './ui.js';

const MIRRORED = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth',
  'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight',
  'lineHeight', 'letterSpacing', 'tabSize',
] as const;

/** Where the caret sits inside a textarea, measured with an invisible mirror of it. */
function caretPosition(textarea: HTMLTextAreaElement, index: number): { top: number; left: number } {
  const mirror = document.createElement('div');
  const style = window.getComputedStyle(textarea);
  for (const property of MIRRORED) mirror.style[property] = style[property];
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '0' });
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop + Number.parseFloat(style.lineHeight || '20') - textarea.scrollTop;
  const left = marker.offsetLeft - textarea.scrollLeft;
  mirror.remove();
  return { top, left };
}

interface Option {
  key: string;
  label: string;
  image: string | null;
  insert: string;
}

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  /** The code a suggestion block would replace; null when suggestions do not apply here. */
  suggestion?: string | null;
  /** `owner/repo`, so previews and mentions resolve in this repository. */
  context: string;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  minRows?: number;
  label?: string;
}

export function Composer({
  value, onChange, onSubmit, onCancel, suggestion = null, context, placeholder, submitLabel = 'Comment',
  autoFocus = false, minRows = 5, label = 'Comment',
}: ComposerProps) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [token, setToken] = useState<{ kind: 'emoji' | 'mention'; query: TokenQuery } | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const [emoji, setEmoji] = useState<Record<string, string>>({});
  const ref = useRef<HTMLTextAreaElement>(null);
  const lookup = useRef(0);
  const [owner, repo] = context.split('/');

  useEffect(() => { void emojiMap().then(setEmoji); }, []);
  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [autoFocus]);

  const emojiNames = useMemo(() => Object.keys(emoji), [emoji]);

  useEffect(() => {
    if (!token) { setOptions([]); return; }
    if (token.kind === 'emoji') {
      setOptions(rankEmoji(token.query.query, emojiNames).map((n) => ({ key: n, label: `:${n}:`, image: emoji[n] ?? null, insert: `:${n}:` })));
      return;
    }
    const id = ++lookup.current;
    const timer = window.setTimeout(() => {
      api.mentions(token.query.query, owner, repo)
        .then((users) => {
          if (id !== lookup.current) return;
          setOptions(users.map((u) => ({ key: u.login, label: u.login, image: u.avatarUrl, insert: `@${u.login}` })));
        })
        .catch(() => setOptions([]));
    }, token.query.query ? 150 : 0);
    return () => window.clearTimeout(timer);
  }, [token?.kind, token?.query.query, token?.query.start, emojiNames, emoji, owner, repo]);

  const refresh = (el: HTMLTextAreaElement) => {
    const collapsed = el.selectionStart === el.selectionEnd;
    const mention = collapsed ? findMentionQuery(el.value, el.selectionStart) : null;
    const emojiQuery = collapsed && !mention ? findEmojiQuery(el.value, el.selectionStart) : null;
    const next = mention ? { kind: 'mention' as const, query: mention } : emojiQuery ? { kind: 'emoji' as const, query: emojiQuery } : null;
    if (next?.query.query !== token?.query.query) setActive(0);
    setToken(next);
    if (next) setAnchor(caretPosition(el, next.query.start));
  };

  const apply = (next: { text: string; caret: number }) => {
    onChange(next.text);
    setToken(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const choose = (option: Option) => {
    if (token) apply(replaceToken(ref.current?.value ?? value, token.query, option.insert));
  };

  const addSuggestion = () => {
    if (suggestion === null) return;
    setTab('write');
    const el = ref.current;
    apply(insertSuggestion(value, el?.selectionStart ?? value.length, suggestion));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (options.length > 0 && token) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + step + options.length) % options.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        choose(options[active]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setToken(null);
        return;
      }
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit?.();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g' && suggestion !== null) {
      event.preventDefault();
      addSuggestion();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (onCancel) onCancel(); else event.currentTarget.blur();
    }
  };

  const tabClass = (name: 'write' | 'preview') =>
    `-mb-px rounded-t-md border px-3 py-1.5 text-sm ${
      tab === name ? 'border-border border-b-canvas bg-canvas font-medium text-fg' : 'border-transparent text-fg-muted hover:text-fg'
    }`;

  return (
    <div className="rounded-md border border-border bg-canvas font-sans text-sm leading-normal">
      <div className="flex items-end gap-1 rounded-t-md border-b border-border bg-canvas-subtle px-2 pt-2">
        <button type="button" className={tabClass('write')} onClick={() => setTab('write')}>Write</button>
        <button type="button" className={tabClass('preview')} onClick={() => setTab('preview')}>Preview</button>
        <div className="flex-1" />
        {suggestion !== null && (
          <button
            type="button"
            onClick={addSuggestion}
            title="Insert a suggestion block (⌘G)"
            className="mb-1 rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-btn-hover hover:text-fg"
          >
            ± Suggest change<Kbd>⌘G</Kbd>
          </button>
        )}
      </div>
      <div className="relative p-2">
        {tab === 'write' ? (
          <>
            <textarea
              ref={ref}
              value={value}
              placeholder={placeholder}
              aria-label={label}
              aria-autocomplete="list"
              aria-expanded={options.length > 0}
              rows={minRows}
              onChange={(e) => { onChange(e.target.value); refresh(e.target); }}
              onKeyDown={onKeyDown}
              onClick={(e) => refresh(e.currentTarget)}
              onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refresh(e.currentTarget); }}
              onBlur={() => window.setTimeout(() => setToken(null), 150)}
              className="block w-full resize-y rounded-md border border-border bg-canvas-inset px-3 py-2 font-sans text-sm leading-5 outline-none focus:border-accent-emphasis focus:bg-canvas focus:ring-1 focus:ring-accent-emphasis"
            />
            {token && options.length > 0 && (
              <ul
                role="listbox"
                className="absolute z-30 w-64 overflow-hidden rounded-md border border-border bg-overlay py-1 shadow-lg"
                style={{ top: anchor.top + 12, left: Math.min(anchor.left + 8, 420) }}
              >
                {options.map((option, index) => (
                  <li key={option.key} role="option" aria-selected={index === active}>
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); choose(option); }}
                      onMouseEnter={() => setActive(index)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${index === active ? 'bg-accent-emphasis text-white' : ''}`}
                    >
                      {token.kind === 'mention'
                        ? <Avatar login={option.label} src={option.image} size={20} />
                        : option.image && <img src={option.image} alt="" className="h-5 w-5" />}
                      <span className="truncate font-medium">{option.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="min-h-24 px-2 py-2">
            {value.trim() ? <Markdown text={value} context={context} /> : <p className="text-fg-muted">Nothing to preview</p>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
        <p className="flex-1 text-xs text-fg-muted">
          Markdown · <kbd className="font-mono">@</kbd> mention · <kbd className="font-mono">:</kbd> emoji · <kbd className="font-mono">Esc</kbd> cancel
        </p>
        {onCancel && <Button size="sm" onClick={onCancel}>Cancel</Button>}
        {onSubmit && (
          <Button size="sm" tone="primary" onClick={onSubmit} disabled={!value.trim()}>
            {submitLabel}<Kbd>⌘↵</Kbd>
          </Button>
        )}
      </div>
    </div>
  );
}
