export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** `#/owner/repo/42` ↔ a pull request reference. */
export interface Route {
  owner: string | null;
  repo: string | null;
  number: number | null;
}

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length >= 3 && /^\d+$/.test(parts[2]!)) return { owner: parts[0]!, repo: parts[1]!, number: Number(parts[2]) };
  if (parts.length === 2) return { owner: parts[0]!, repo: parts[1]!, number: null };
  return { owner: null, repo: null, number: null };
}

/** Accepts a PR URL, `owner/repo#42`, `owner/repo`, or a bare number. */
export function parseTarget(input: string): Route | null {
  const text = input.trim();
  const url = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/.exec(text);
  if (url) return { owner: url[1]!, repo: url[2]!, number: Number(url[3]) };
  const ref = /^([\w.-]+)\/([\w.-]+)(?:#(\d+))?$/.exec(text);
  if (ref) return { owner: ref[1]!, repo: ref[2]!, number: ref[3] ? Number(ref[3]) : null };
  const num = /^#?(\d+)$/.exec(text);
  if (num) return { owner: null, repo: null, number: Number(num[1]) };
  return null;
}
