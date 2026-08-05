import type { DiffFile, DiffLine, Hunk } from '../diff/types.js';

export interface RuleContext {
  /** Glob patterns the repo declares as generated, from .gitattributes. */
  generatedPaths: Set<string>;
}

export interface RuleVerdict {
  drop: true;
  rule: string;
}

export const FILE_RULE_NAMES = [
  'linguist-generated',
  'lockfile',
  'build-output',
  'snapshot',
  'minified',
  'binary',
  'pure-rename',
] as const;

export const HUNK_RULE_NAMES = [
  'whitespace-only',
  'imports-only',
  'license-header',
] as const;

const LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'composer.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'go.sum',
  'poetry.lock',
  'uv.lock',
]);

const BUILD_DIRS = ['dist', 'build', 'vendor', 'node_modules', '.next', 'out'];

/**
 * Glob matcher supporting `*` (within a path segment) and `**` (across
 * segments). Deliberately small — we only ever match .gitattributes patterns
 * and our own rule patterns, not arbitrary user input.
 */
export function matchesGlob(pattern: string, path: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const source = escaped
    .replace(/\*\*\//g, '«DD»')
    .replace(/\*\*/g, '«DD2»')
    .replace(/\*/g, '[^/]*')
    .replace(/«DD»/g, '(?:[^/]+/)*')
    .replace(/«DD2»/g, '.*');
  return new RegExp(`^${source}$`).test(path);
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function evaluateFile(file: DiffFile, ctx: RuleContext): RuleVerdict | null {
  for (const pattern of ctx.generatedPaths) {
    if (matchesGlob(pattern, file.path)) {
      return { drop: true, rule: 'linguist-generated' };
    }
  }

  if (file.status === 'binary') return { drop: true, rule: 'binary' };

  if (file.status === 'renamed' && file.similarity === 100 && file.hunks.length === 0) {
    return { drop: true, rule: 'pure-rename' };
  }

  if (LOCKFILES.has(basename(file.path))) return { drop: true, rule: 'lockfile' };

  const segments = file.path.split('/');
  if (segments.some((s) => BUILD_DIRS.includes(s))) {
    return { drop: true, rule: 'build-output' };
  }

  if (segments.includes('__snapshots__') || file.path.endsWith('.snap')) {
    return { drop: true, rule: 'snapshot' };
  }

  if (/\.min\.(js|css)$/.test(file.path)) return { drop: true, rule: 'minified' };

  return null;
}

const IMPORT_RE =
  /^(?:use\s+[\w\\:{}, ]+;|\s*(?:import\b|export\s+(?:\*|\{)[^;]*\bfrom\b|from\s+\S+\s+import\b|require\s*\(|#include\b))/;

const LICENSE_RE = /copyright|licensed under|spdx-license-identifier|all rights reserved/i;

function changed(hunk: Hunk): DiffLine[] {
  return hunk.lines.filter((l) => l.kind !== 'context');
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function evaluateHunk(hunk: Hunk): RuleVerdict | null {
  const lines = changed(hunk);
  if (lines.length === 0) return null;

  const adds = lines.filter((l) => l.kind === 'add').map((l) => normalize(l.text));
  const dels = lines.filter((l) => l.kind === 'del').map((l) => normalize(l.text));

  // Whitespace-only: normalized added and deleted lines match positionally.
  if (adds.length === dels.length && adds.length > 0) {
    if (adds.every((a, i) => a === dels[i])) {
      return { drop: true, rule: 'whitespace-only' };
    }
  }

  if (lines.every((l) => l.text.trim() === '' || IMPORT_RE.test(l.text))) {
    return { drop: true, rule: 'imports-only' };
  }

  if (lines.every((l) => l.text.trim() === '' || LICENSE_RE.test(l.text))) {
    return { drop: true, rule: 'license-header' };
  }

  return null;
}
