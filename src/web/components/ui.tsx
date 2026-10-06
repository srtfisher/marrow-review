import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useCallback } from 'react';
import { renderMarkdown } from '../api.js';
import { useMarkdown } from '../hooks.js';
import { ariaKey, keyLabel, type Action } from '../lib/keymap.js';
import { Icon, type IconName } from './icons.js';

export function Kbd({ children }: { children: string }) {
  return (
    <kbd aria-hidden="true" className="ml-1 inline-block min-w-5 rounded border border-current/30 px-1 text-center font-mono text-[11px] leading-4 font-normal opacity-80">
      {children}
    </kbd>
  );
}

type Tone = 'default' | 'primary' | 'agent' | 'danger' | 'invisible';

const TONES: Record<Tone, string> = {
  default: 'border-border bg-btn text-fg hover:bg-btn-hover',
  primary: 'border-success-emphasis bg-success-emphasis text-white hover:bg-success-emphasis-hover',
  agent: 'border-done/50 bg-done-subtle text-done hover:border-done',
  danger: 'border-border bg-btn text-danger hover:border-danger hover:bg-danger hover:text-white',
  invisible: 'border-transparent bg-transparent text-fg-muted hover:bg-btn-hover hover:text-fg',
};

export function Button({
  tone = 'default', icon, shortcut, size = 'md', pressed, children, className = '', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; icon?: IconName; shortcut?: Action; size?: 'sm' | 'md'; pressed?: boolean }) {
  const pad = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-sm';
  return (
    <button
      type="button"
      aria-keyshortcuts={shortcut ? ariaKey(shortcut) : undefined}
      aria-pressed={pressed}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${pad} ${TONES[tone]} ${pressed ? 'ring-2 ring-accent-emphasis/40' : ''} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 12 : 14} />}
      {children}
      {shortcut && <Kbd>{keyLabel(shortcut)}</Kbd>}
    </button>
  );
}

export function Label({ children, tone = 'muted', title }: { children: ReactNode; tone?: 'muted' | 'danger' | 'attention' | 'success' | 'done' | 'accent'; title?: string }) {
  const tones = {
    muted: 'border-border text-fg-muted',
    danger: 'border-danger/40 text-danger',
    attention: 'border-attention/40 text-attention',
    success: 'border-success/40 text-success',
    done: 'border-done/40 text-done',
    accent: 'border-accent/40 text-accent',
  };
  return <span title={title} className={`inline-flex items-center rounded-full border px-2 text-xs leading-5 font-medium whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className="spin shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Avatar({ login, src, size = 20 }: { login: string; src?: string | null; size?: number }) {
  const url = src ?? `https://github.com/${login}.png`;
  return (
    <img
      src={url.includes('?') ? url : `${url}?size=${size * 2}`}
      alt=""
      width={size}
      height={size}
      className="inline-block shrink-0 rounded-full object-cover"
      style={{ width: size, height: size, boxShadow: '0 0 0 1px var(--gh-border-muted)' }}
    />
  );
}

/** Markdown rendered by GitHub, so it reads exactly as it will once posted. */
export function Markdown({ text, context, className = '' }: { text: string; context?: string; className?: string }) {
  const render = useCallback((t: string) => renderMarkdown(t, context), [context]);
  const { html, error } = useMarkdown(text, render);
  if (!text.trim()) return null;
  if (html !== null) return <div className={`markdown-body ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
  // Until GitHub answers, or if it cannot, the source is still readable.
  return <div className={`whitespace-pre-wrap ${error ? '' : 'opacity-70'} ${className}`}>{text}</div>;
}

export function Donut({ done, total, size = 14 }: { done: number; total: number; size?: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const frac = total === 0 ? 0 : done / total;
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-label={`${done} of ${total} viewed`} className="shrink-0">
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--gh-border)" strokeWidth="2.5" />
      <circle
        cx="8" cy="8" r={r} fill="none" stroke={frac === 1 ? 'var(--gh-success)' : 'var(--gh-accent)'} strokeWidth="2.5"
        strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 8 8)" strokeLinecap="round"
      />
    </svg>
  );
}
