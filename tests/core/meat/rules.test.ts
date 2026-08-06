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
    expect(evaluateFile(file('packages/ui/dist/index.js'), noCtx)?.rule).toBe('build-output');
  });

  test('keeps a file whose own name matches a build directory', () => {
    expect(evaluateFile(file('scripts/build'), noCtx)).toBeNull();
    expect(evaluateFile(file('src/out'), noCtx)).toBeNull();
  });

  test('drops snapshots and minified files', () => {
    expect(evaluateFile(file('src/__snapshots__/a.test.ts.snap'), noCtx)?.rule).toBe('snapshot');
    expect(evaluateFile(file('public/app.min.js'), noCtx)?.rule).toBe('minified');
  });

  test('drops binary files', () => {
    expect(evaluateFile(file('logo.png', { status: 'binary' }), noCtx)?.rule).toBe('binary');
  });

  test('drops deleted files whole', () => {
    const deleted = file('src/old.ts', {
      status: 'deleted',
      hunks: [hunk([line('del', 'export const a = 1;'), line('del', 'export const b = 2;')])],
    });
    expect(evaluateFile(deleted, noCtx)?.rule).toBe('file-deleted');
  });

  test('keeps a file that merely lost lines', () => {
    const shrunk = file('src/app.ts', {
      hunks: [hunk([line('del', 'validate(input);')])],
    });
    expect(evaluateFile(shrunk, noCtx)).toBeNull();
  });

  test('drops 100%-similarity renames', () => {
    const renamed = file('b.ts', { status: 'renamed', similarity: 100, oldPath: 'a.ts' });
    expect(evaluateFile(renamed, noCtx)?.rule).toBe('pure-rename');
  });

  test('drops a move git reported without a similarity line', () => {
    const renamed = file('b.ts', { status: 'renamed', similarity: null, oldPath: 'a.ts' });
    expect(evaluateFile(renamed, noCtx)?.rule).toBe('pure-rename');
  });

  test('keeps a rename that also changed content', () => {
    const renamed = file('b.ts', {
      status: 'renamed',
      similarity: 87,
      oldPath: 'a.ts',
      hunks: [hunk([line('del', 'return a + b;'), line('add', 'return a - b;')])],
    });
    expect(evaluateFile(renamed, noCtx)).toBeNull();
  });

  test('keeps a rename git rounded up to 100% that still edits a line', () => {
    const renamed = file('b.ts', {
      status: 'renamed',
      similarity: 100,
      oldPath: 'a.ts',
      hunks: [hunk([line('del', 'const timeout = 30;'), line('add', 'const timeout = 300;')])],
    });
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
    expect(evaluateHunk(h, 'src/a.ts')?.rule).toBe('whitespace-only');
  });

  test('drops re-indentation where indentation is not syntax', () => {
    const h = hunk([line('del', '  const a = 1;'), line('add', '      const a = 1;')]);
    expect(evaluateHunk(h, 'src/a.ts')?.rule).toBe('whitespace-only');
  });

  test('keeps a re-parented YAML key', () => {
    const h = hunk([line('del', '  timeout: 30'), line('add', '      timeout: 30')]);
    expect(evaluateHunk(h, '.github/workflows/ci.yml')).toBeNull();
    expect(evaluateHunk(h, 'deploy/values.yaml')).toBeNull();
  });

  test('keeps a dedented Python statement', () => {
    const h = hunk([line('del', '        commit()'), line('add', '    commit()')]);
    expect(evaluateHunk(h, 'app/db.py')).toBeNull();
  });

  test('keeps a Makefile recipe that lost its leading tab', () => {
    const h = hunk([line('del', '\tgo build ./...'), line('add', '    go build ./...')]);
    expect(evaluateHunk(h, 'Makefile')).toBeNull();
    expect(evaluateHunk(h, 'build/rules.mk')).toBeNull();
  });

  test('still drops trailing-whitespace edits in indentation-sensitive files', () => {
    const h = hunk([line('del', '    commit()  '), line('add', '    commit()')]);
    expect(evaluateHunk(h, 'app/db.py')?.rule).toBe('whitespace-only');
  });

  test('keeps reordered statements', () => {
    const h = hunk([
      line('del', 'doA();'),
      line('del', 'doB();'),
      line('add', 'doB();'),
      line('add', 'doA();'),
    ]);
    expect(evaluateHunk(h, 'src/a.ts')).toBeNull();
  });

  test('drops import-only hunks', () => {
    const h = hunk([
      line('add', "import { z } from 'zod';"),
      line('del', "import { y } from 'yup';"),
    ]);
    expect(evaluateHunk(h, 'src/a.ts')?.rule).toBe('imports-only');
  });

  test('drops use-statement-only hunks in PHP and Rust', () => {
    expect(evaluateHunk(hunk([line('add', 'use App\\Models\\Post;')]), 'src/a.php')?.rule).toBe(
      'imports-only',
    );
    expect(evaluateHunk(hunk([line('add', 'use std::fmt;')]), 'src/a.rs')?.rule).toBe(
      'imports-only',
    );
  });

  test('keeps indented PHP trait use statements', () => {
    const h = hunk([line('add', '    use HasFactory;')]);
    expect(evaluateHunk(h, 'src/Post.php')).toBeNull();
  });

  test('keeps a re-export, which changes the public surface', () => {
    const h = hunk([line('add', "export { x } from './y.js';")]);
    expect(evaluateHunk(h, 'src/index.ts')).toBeNull();
  });

  test('labels a blank-line-only hunk as such, not as imports', () => {
    const h = hunk([line('add', ''), line('add', '   ')]);
    expect(evaluateHunk(h, 'src/a.ts')?.rule).toBe('blank-lines');
  });

  test('keeps an import hunk that also changes code', () => {
    const h = hunk([line('add', "import { z } from 'zod';"), line('add', 'const x = z.string();')]);
    expect(evaluateHunk(h, 'src/a.ts')).toBeNull();
  });

  test('drops license header changes', () => {
    const h = hunk([
      line('del', ' * Copyright (c) 2025 Example Corp'),
      line('add', ' * Copyright (c) 2026 Example Corp'),
    ]);
    expect(evaluateHunk(h, 'src/a.ts')?.rule).toBe('license-header');
    expect(evaluateHunk(hunk([line('add', '# Copyright 2026 Example Corp')]), 'app/db.py')?.rule).toBe(
      'license-header',
    );
  });

  test('keeps code that merely mentions copyright', () => {
    const h = hunk([
      line('del', "$c = get_option('copyright');"),
      line('add', "$c = $_GET['copyright'];"),
    ]);
    expect(evaluateHunk(h, 'src/theme.php')).toBeNull();
  });

  test('keeps a hunk with no changed lines out of scope', () => {
    expect(evaluateHunk(hunk([line('context', 'unchanged')]), 'src/a.ts')).toBeNull();
  });

  test('keeps a substantive change', () => {
    const h = hunk([line('del', 'return a + b;'), line('add', 'return a - b;')]);
    expect(evaluateHunk(h, 'src/a.ts')).toBeNull();
  });
});
