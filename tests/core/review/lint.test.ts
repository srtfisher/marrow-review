import { test, expect, describe } from 'bun:test';
import {
  applySuggestion, checkSuggestions, PHP_LINTER, phpLintOutcome, suggestionsOf, type LintOutcome, type SyntaxLinter,
} from '../../../src/core/review/lint.js';
import type { StagedComment } from '../../../src/core/review/types.js';

function comment(over: Partial<StagedComment> = {}): StagedComment {
  return { id: 'c1', path: 'src/Foo.php', line: 3, side: 'RIGHT', startLine: null, body: 'Fix this.', suggestion: null, ...over };
}

const HEAD = ['<?php', 'function a() {', '  return 1;', '}', ''].join('\n');

/** Treats any file containing BROKEN as a syntax error; PHP files only. */
class FakeLinter implements SyntaxLinter {
  readonly linted: string[] = [];
  constructor(private readonly outcome?: LintOutcome) {}
  handles(path: string): boolean { return path.endsWith('.php'); }
  async lint(_path: string, code: string): Promise<LintOutcome> {
    this.linted.push(code);
    if (this.outcome) return this.outcome;
    return code.includes('BROKEN') ? { kind: 'error', message: 'syntax error (line 3)' } : { kind: 'ok' };
  }
}

const readHead = (files: Record<string, string>) => async (path: string) => files[path] ?? null;

describe('suggestionsOf', () => {
  test('reads the suggestion field and every suggestion fence in the body', () => {
    const c = comment({
      suggestion: 'one',
      body: 'Try:\n```suggestion\ntwo\nlines\n```\nor\n```suggestion\n```\n',
    });
    expect(suggestionsOf(c)).toEqual(['one', 'two\nlines', '']);
  });

  test('ignores a plain code fence', () => {
    expect(suggestionsOf(comment({ body: '```php\nreturn 2;\n```' }))).toEqual([]);
  });
});

describe('applySuggestion', () => {
  test('replaces the one anchored line', () => {
    expect(applySuggestion(HEAD, comment({ line: 3 }), '  return 2;')).toBe(HEAD.replace('return 1;', 'return 2;'));
  });

  test('replaces a whole range, which may grow or shrink the file', () => {
    const out = applySuggestion(HEAD, comment({ startLine: 2, line: 4 }), 'function b(): int { return 1; }');
    expect(out).toBe('<?php\nfunction b(): int { return 1; }\n');
  });

  test('an empty suggestion deletes the anchored lines', () => {
    expect(applySuggestion(HEAD, comment({ line: 3 }), '')).toBe('<?php\nfunction a() {\n}\n');
  });
});

describe('checkSuggestions', () => {
  test('reports a suggestion that breaks the file', async () => {
    const linter = new FakeLinter();
    const problems = await checkSuggestions([comment({ suggestion: '  BROKEN' })], readHead({ 'src/Foo.php': HEAD }), linter);
    expect(problems).toEqual([{ commentId: 'c1', path: 'src/Foo.php', line: 3, startLine: null, message: 'syntax error (line 3)' }]);
  });

  test('passes a suggestion that parses', async () => {
    const problems = await checkSuggestions([comment({ suggestion: '  return 2;' })], readHead({ 'src/Foo.php': HEAD }), new FakeLinter());
    expect(problems).toEqual([]);
  });

  test('checks a suggestion fence in the reviewer\'s own comment', async () => {
    const c = comment({ body: '```suggestion\n  BROKEN\n```' });
    expect(await checkSuggestions([c], readHead({ 'src/Foo.php': HEAD }), new FakeLinter())).toHaveLength(1);
  });

  test('does not blame a suggestion for a file that was already broken', async () => {
    const problems = await checkSuggestions(
      [comment({ suggestion: 'BROKEN too' })], readHead({ 'src/Foo.php': `${HEAD}BROKEN` }), new FakeLinter(),
    );
    expect(problems).toEqual([]);
  });

  test('skips everything when the linter cannot run', async () => {
    const problems = await checkSuggestions(
      [comment({ suggestion: '  BROKEN' })], readHead({ 'src/Foo.php': HEAD }), new FakeLinter({ kind: 'skip' }),
    );
    expect(problems).toEqual([]);
  });

  test('leaves files the linter does not handle alone', async () => {
    const linter = new FakeLinter();
    const problems = await checkSuggestions(
      [comment({ path: 'src/foo.ts', suggestion: 'BROKEN' })], readHead({ 'src/foo.ts': HEAD }), linter,
    );
    expect(problems).toEqual([]);
    expect(linter.linted).toEqual([]);
  });

  test('leaves a suggestion on a deleted line alone', async () => {
    const linter = new FakeLinter();
    expect(await checkSuggestions([comment({ side: 'LEFT', suggestion: 'BROKEN' })], readHead({ 'src/Foo.php': HEAD }), linter)).toEqual([]);
  });

  test('skips a file it cannot read', async () => {
    const problems = await checkSuggestions(
      [comment({ suggestion: 'BROKEN' })], async () => { throw new Error('404'); }, new FakeLinter(),
    );
    expect(problems).toEqual([]);
  });

  test('reads and lints each head file once', async () => {
    const linter = new FakeLinter();
    let reads = 0;
    await checkSuggestions(
      [comment({ id: 'a', suggestion: 'x' }), comment({ id: 'b', line: 2, suggestion: 'y' })],
      async () => { reads += 1; return HEAD; },
      linter,
    );
    expect(reads).toBe(1);
    expect(linter.linted).toHaveLength(3);
  });
});

describe('phpLintOutcome', () => {
  test('passes on a clean exit', () => {
    expect(phpLintOutcome(0, 'No syntax errors detected in Standard input code\n')).toEqual({ kind: 'ok' });
  });

  test('keeps php\'s message and line without the stdin noise', () => {
    const out = '\nParse error: syntax error, unexpected token "}", expecting ";" in Standard input code on line 4\nErrors parsing Standard input code\n';
    expect(phpLintOutcome(255, out)).toEqual({ kind: 'error', message: 'syntax error, unexpected token "}", expecting ";" (line 4)' });
  });

  test('reports a compile-time fatal error too', () => {
    const out = 'PHP Fatal error:  Cannot redeclare function a() in Standard input code on line 7\n';
    expect(phpLintOutcome(255, out)).toEqual({ kind: 'error', message: 'Cannot redeclare function a() (line 7)' });
  });

  test('skips a failure it cannot read rather than guess', () => {
    expect(phpLintOutcome(1, 'Segmentation fault')).toEqual({ kind: 'skip' });
  });
});

describe('PHP_LINTER', () => {
  test('handles .php files and nothing else', () => {
    expect(PHP_LINTER.handles('src/Foo.php')).toBe(true);
    expect(PHP_LINTER.handles('src/foo.ts')).toBe(false);
    expect(PHP_LINTER.handles('php/readme.md')).toBe(false);
  });
});
