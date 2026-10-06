import { relative } from 'node:path';
import { toolName } from './types.js';

/** What a run is doing, as far as its tool calls show. */
export interface AgentProgress {
  /** Assistant turns so far. */
  turns: number;
  /** Files opened so far. */
  reads: number;
  /** The latest tool call, in words: "reading src/app.ts". */
  activity: string;
}

const READ_TOOLS = new Set(['Read', toolName('read_file')]);

function shortPath(path: unknown, cwd: string | undefined): string {
  if (typeof path !== 'string' || path.length === 0) return 'a file';
  const rel = cwd && path.startsWith(cwd) ? relative(cwd, path) : path;
  return rel.length > 60 ? `…${rel.slice(-59)}` : rel;
}

export function isRead(name: string): boolean {
  return READ_TOOLS.has(name);
}

export function describeToolUse(name: string, input: Record<string, unknown>, cwd?: string): string {
  if (isRead(name)) return `reading ${shortPath(input.file_path ?? input.path, cwd)}`;
  if (name === 'Grep') return `searching for ${typeof input.pattern === 'string' ? `“${input.pattern.slice(0, 40)}”` : 'a pattern'}`;
  if (name === 'Glob') return `listing ${typeof input.pattern === 'string' ? input.pattern : 'files'}`;
  if (name === toolName('list_dir')) return `listing ${shortPath(input.path, cwd)}`;
  if (name === toolName('read_hunks')) return 'reading hunks';
  if (/structured/i.test(name)) return 'writing up';
  return `using ${name}`;
}
