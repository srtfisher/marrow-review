import { test, expect, describe } from 'bun:test';
import { evaluateFile, evaluateHunk, matchesGlob } from '../../../src/core/meat/rules.js';
import type { DiffFile, DiffLine, Hunk } from '../../../src/core/diff/types.js';

function file(path: string, over: Partial<DiffFile> = {}): DiffFile {
  return {
    path,
    oldPath: null,
    status: 'modified',
    similarity: null,
    hunks: [],
    additions: 1,
    deletions: 1,
    ...over,
  };
}

function line(kind: DiffLine['kind'], text: string): DiffLine {
  return { kind, text, oldLine: 1, newLine: 1, noNewlineAtEof: false };
}

function hunk(lines: DiffLine[]): Hunk {
  return {
    header: '@@ -1,1 +1,1 @@',
    section: '',
    oldStart: 1,
    oldLines: lines.length,
    newStart: 1,
    newLines: lines.length,
    lines,
  };
}

const noCtx = { generatedPaths: new Set<string>() };

describe('matchesGlob', () => {
  test('matches * within a segment only', () => {
    expect(matchesGlob('*.min.js', 'app.min.js')).toBe(true);
    expect(matchesGlob('*.min.js', 'src/app.min.js')).toBe(false);
  });

  test('matches ** across segments', () => {
    expect(matchesGlob('src/**/*.snap', 'src/a/b/x.snap')).toBe(true);
    expect(matchesGlob('**/*.pb.go', 'api/v1/service.pb.go')).toBe(true);
  });

  test('matches an exact path', () => {
    expect(matchesGlob('schema.json', 'schema.json')).toBe(true);
    expect(matchesGlob('schema.json', 'sub/schema.json')).toBe(false);
  });
});

describe('evaluateFile', () => {
  test('drops lockfiles', () => {
    expect(evaluateFile(file('pnpm-lock.yaml'), noCtx)?.rule).toBe('lockfile');
    expect(evaluateFile(file('sub/composer.lock'), noCtx)?.rule).toBe('lockfile');
    expect(evaluateFile(file('go.sum'), noCtx)?.rule).toBe('lockfile');
  });

  test('drops vendored and build output directories', () => {
    expect(evaluateFile(file('dist/bundle.js'), noCtx)?.rule).toBe('build-output');
    expect(evaluateFile(file('vendor/pkg/x.go'), noCtx)?.rule).toBe('build-output');
  });

  test('drops snapshots and minified files', () => {
    expect(evaluateFile(file('src/__snapshots__/a.test.ts.snap'), noCtx)?.rule).toBe('snapshot');
    expect(evaluateFile(file('public/app.min.js'), noCtx)?.rule).toBe('minified');
  });

  test('drops binary files', () => {
    expect(evaluateFile(file('logo.png', { status: 'binary' }), noCtx)?.rule).toBe('binary');
  });

  test('drops 100%-similarity renames', () => {
    const renamed = file('b.ts', { status: 'renamed', similarity: 100, oldPath: 'a.ts' });
    expect(evaluateFile(renamed, noCtx)?.rule).toBe('pure-rename');
  });

  test('keeps a rename that also changed content', () => {
    const renamed = file('b.ts', { status: 'renamed', similarity: 87, oldPath: 'a.ts' });
    expect(evaluateFile(renamed, noCtx)).toBeNull();
  });

  test('gitattributes linguist-generated outranks everything', () => {
    const ctx = { generatedPaths: new Set(['api/**/*.ts']) };
    expect(evaluateFile(file('api/v1/client.ts'), ctx)?.rule).toBe('linguist-generated');
  });

  test('keeps ordinary source files', () => {
    expect(evaluateFile(file('src/app.ts'), noCtx)).toBeNull();
  });
});

describe('evaluateHunk', () => {
  test('drops whitespace-only changes', () => {
    const h = hunk([line('del', 'const a = 1;'), line('add', 'const a = 1;  ')]);
    expect(evaluateHunk(h)?.rule).toBe('whitespace-only');
  });

  test('keeps reordered statements', () => {
    const h = hunk([
      line('del', 'doA();'),
      line('del', 'doB();'),
      line('add', 'doB();'),
      line('add', 'doA();'),
    ]);
    expect(evaluateHunk(h)).toBeNull();
  });

  test('drops import-only hunks', () => {
    const h = hunk([
      line('add', "import { z } from 'zod';"),
      line('del', "import { y } from 'yup';"),
    ]);
    expect(evaluateHunk(h)?.rule).toBe('imports-only');
  });

  test('drops use-statement-only hunks in PHP and Rust', () => {
    expect(evaluateHunk(hunk([line('add', 'use App\\Models\\Post;')]))?.rule).toBe('imports-only');
    expect(evaluateHunk(hunk([line('add', 'use std::fmt;')]))?.rule).toBe('imports-only');
  });

  test('keeps indented PHP trait use statements', () => {
    const h = hunk([line('add', '    use HasFactory;')]);
    expect(evaluateHunk(h)).toBeNull();
  });

  test('keeps an import hunk that also changes code', () => {
    const h = hunk([line('add', "import { z } from 'zod';"), line('add', 'const x = z.string();')]);
    expect(evaluateHunk(h)).toBeNull();
  });

  test('drops license header changes', () => {
    const h = hunk([
      line('del', ' * Copyright (c) 2025 Alley'),
      line('add', ' * Copyright (c) 2026 Alley'),
    ]);
    expect(evaluateHunk(h)?.rule).toBe('license-header');
  });

  test('keeps a hunk with no changed lines out of scope', () => {
    expect(evaluateHunk(hunk([line('context', 'unchanged')]))).toBeNull();
  });

  test('keeps a substantive change', () => {
    const h = hunk([line('del', 'return a + b;'), line('add', 'return a - b;')]);
    expect(evaluateHunk(h)).toBeNull();
  });
});
