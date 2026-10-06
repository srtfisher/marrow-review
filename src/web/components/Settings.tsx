import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import type { PassSettings } from '../lib/types.js';
import { Icon } from './icons.js';
import { Kbd, usePopover } from './ui.js';

const ROWS: ReadonlyArray<{ pass: keyof PassSettings; label: string; on: string; off: string }> = [
  { pass: 'abridge', label: 'Abridge', on: 'Claude judges which hunks carry meaning.', off: 'The rules alone fold noise; everything else is kept.' },
  { pass: 'group', label: 'Group', on: 'Orders the diff by intent.', off: 'Lays the diff out by directory.' },
  { pass: 'find', label: 'Review', on: 'Five reviewers, each from one angle, draft findings.', off: 'No findings. Press ⇧R in a review to run it anyway.' },
  { pass: 'verify', label: 'Score', on: 'Scores each finding 0–100; low scores fold away.', off: 'Findings arrive unscored, all shown.' },
];

/** The model passes a newly opened review runs. An open review keeps the ones it started with. */
export function Settings({ open: controlled, onOpen, shortcut = true }: { open?: boolean; onOpen?: (open: boolean) => void; shortcut?: boolean }) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = onOpen ?? setOwn;
  const close = useCallback(() => setOpen(false), [setOpen]);
  const { ref, position } = usePopover(open, close, 352);
  const [passes, setPasses] = useState<PassSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    api.app().then((info) => current && setPasses(info.passes), (e: Error) => current && setError(e.message));
    return () => { current = false; };
  }, [open]);

  const toggle = (pass: keyof PassSettings) => {
    if (!passes) return;
    const previous = passes;
    const next = { ...passes, [pass]: !passes[pass] };
    setPasses(next);
    setError(null);
    api.settings(next).then(
      (saved) => { setPasses(saved); window.marrowDesktop?.savePasses(saved); },
      (e: Error) => { setPasses(previous); setError(e.message); },
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-keyshortcuts={shortcut ? ',' : undefined}
        title="Model passes for the next review"
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-fg-muted hover:bg-btn-hover hover:text-fg"
      >
        <Icon name="gear" size={12} />Passes{shortcut && <Kbd>,</Kbd>}
      </button>
      {open && (
        <div className={`absolute top-full z-40 mt-1 w-[22rem] rounded-md border border-border bg-overlay p-3 shadow-xl ${position}`}>
          <h3 className="mb-2 text-sm font-semibold">Model passes</h3>
          {!passes && !error && <p className="text-sm text-fg-muted">Loading…</p>}
          {passes && (
            <ul className="space-y-2">
              {ROWS.map(({ pass, label, on, off }) => {
                const blocked = pass === 'verify' && !passes.find;
                const enabled = passes[pass] && !blocked;
                return (
                  <li key={pass}>
                    <label className={`flex items-start gap-2 text-sm ${blocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={blocked}
                        onChange={() => toggle(pass)}
                        className="mt-0.5 accent-[var(--gh-accent-emphasis)]"
                      />
                      <span>
                        <span className="font-medium">{label}</span>
                        <span className="block text-xs text-fg-muted">{blocked ? 'Needs Review.' : enabled ? on : off}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <p className="mt-3 border-t border-border-muted pt-2 text-xs text-fg-muted">
            Applies to pull requests opened from now on. One already open keeps its own.
          </p>
        </div>
      )}
    </div>
  );
}
