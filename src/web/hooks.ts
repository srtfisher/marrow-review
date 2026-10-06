import { useEffect, useState } from 'react';
import { api } from './api.js';
import type { SessionSnapshot } from './lib/types.js';

export function useSession(id: string | null): { snapshot: SessionSnapshot | null; dropped: boolean } {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [dropped, setDropped] = useState(false);
  useEffect(() => {
    if (!id) return;
    setSnapshot(null);
    setDropped(false);
    return api.events(
      id,
      (s) => { setSnapshot(s); setDropped(false); },
      (p) => setSnapshot((prev) => (prev ? { ...prev, ...p } : prev)),
      () => setDropped(true),
    );
  }, [id]);
  return { snapshot, dropped };
}

export type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'marrow:theme';

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private window */ }
  }, [theme]);
  const cycle = () => setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'));
  return [theme, cycle];
}

export function useMarkdown(text: string | null, render: (t: string) => Promise<string>): { html: string | null; error: string | null } {
  const [state, setState] = useState<{ text: string | null; html: string | null; error: string | null }>({ text: null, html: null, error: null });
  useEffect(() => {
    if (!text || !text.trim()) return;
    let current = true;
    render(text).then(
      (html) => current && setState({ text, html, error: null }),
      (e: Error) => current && setState({ text, html: null, error: e.message }),
    );
    return () => { current = false; };
  }, [text, render]);
  return state.text === text ? { html: state.html, error: state.error } : { html: null, error: null };
}
