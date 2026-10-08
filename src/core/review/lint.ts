import { spawn } from 'node:child_process';
import type { StagedComment } from './types.js';

/** `skip`: the check could not run (no linter installed, a crash, a timeout), which is not a pass. */
export type LintOutcome = { kind: 'ok' } | { kind: 'error'; message: string } | { kind: 'skip' };

export interface SyntaxLinter {
  handles(path: string): boolean;
  lint(path: string, code: string): Promise<LintOutcome>;
}

export interface SyntaxProblem {
  commentId: string;
  path: string;
  line: number;
  startLine: number | null;
  message: string;
}

/** Thrown by submit so nothing is sent; the reviewer can choose to submit anyway. */
export class SuggestionSyntaxError extends Error {
  constructor(readonly problems: SyntaxProblem[]) {
    super(`${problems.length} suggestion${problems.length === 1 ? ' does' : 's do'} not parse.`);
  }
}

const SUGGESTION_FENCE = /^```suggestion[^\n]*\n([\s\S]*?)^```/gm;

/** The suggested replacements a comment carries: the finding's own, then any fences the reviewer wrote. */
export function suggestionsOf(comment: StagedComment): string[] {
  const fenced = [...comment.body.matchAll(SUGGESTION_FENCE)].map((m) => (m[1] ?? '').replace(/\n$/, ''));
  return comment.suggestion === null ? fenced : [comment.suggestion, ...fenced];
}

/** The file as it would read after clicking "Commit suggestion" on GitHub. */
export function applySuggestion(text: string, comment: StagedComment, code: string): string {
  const lines = text.split('\n');
  const replacement = code === '' ? [] : code.split('\n');
  return [...lines.slice(0, (comment.startLine ?? comment.line) - 1), ...replacement, ...lines.slice(comment.line)].join('\n');
}

/**
 * Lints each suggestion in place in its head file. A file that cannot be read, or
 * that fails before any suggestion is applied, is skipped: the check exists to
 * catch a broken suggestion, and must never be what stops a review going out.
 */
export async function checkSuggestions(
  comments: StagedComment[],
  readHead: (path: string) => Promise<string | null>,
  linter: SyntaxLinter,
): Promise<SyntaxProblem[]> {
  const heads = new Map<string, Promise<string | null>>();
  const cleanHead = (path: string) => {
    let head = heads.get(path);
    if (!head) {
      head = readHead(path)
        .catch(() => null)
        .then(async (text) => (text !== null && (await linter.lint(path, text)).kind === 'ok' ? text : null));
      heads.set(path, head);
    }
    return head;
  };

  const checked = await Promise.all(comments.map(async (c) => {
    if (c.side !== 'RIGHT' || !linter.handles(c.path)) return [];
    const codes = suggestionsOf(c);
    if (codes.length === 0) return [];
    const head = await cleanHead(c.path);
    if (head === null) return [];
    const outcomes = await Promise.all(codes.map((code) => linter.lint(c.path, applySuggestion(head, c, code))));
    return outcomes.flatMap((o): SyntaxProblem[] => (o.kind === 'error'
      ? [{ commentId: c.id, path: c.path, line: c.line, startLine: c.startLine, message: o.message }]
      : []));
  }));
  return checked.flat();
}

const PHP_ERROR = /(?:Parse|Fatal) error:\s*(.*?) in Standard input code on line (\d+)/;

export function phpLintOutcome(code: number | null, output: string): LintOutcome {
  if (code === 0) return { kind: 'ok' };
  const match = PHP_ERROR.exec(output);
  return match ? { kind: 'error', message: `${match[1]} (line ${match[2]})` } : { kind: 'skip' };
}

const PHP_TIMEOUT_MS = 10_000;

export const PHP_LINTER: SyntaxLinter = {
  handles: (path) => path.endsWith('.php'),
  lint: (_path, code) => new Promise((resolve) => {
    // A php.ini with display_errors off would otherwise fail with no message to show.
    const child = spawn('php', ['-d', 'display_errors=1', '-d', 'log_errors=0', '-l'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: PHP_TIMEOUT_MS,
    });
    let output = '';
    child.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { output += d.toString(); });
    // ENOENT when php is not installed.
    child.on('error', () => resolve({ kind: 'skip' }));
    child.on('close', (exit, signal) => resolve(signal ? { kind: 'skip' } : phpLintOutcome(exit, output)));
    child.stdin.on('error', () => {});
    child.stdin.end(code);
  }),
};
