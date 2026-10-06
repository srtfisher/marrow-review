import { test, expect, describe } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRubric, conventionPaths, loadStandards, readConventions, MAX_CONVENTIONS_CHARS,
} from '../../../src/core/review/rubric.js';

const base = { effort: 'medium' as const, standards: '', conventions: '' };

describe('buildRubric', () => {
  test('names both severities and every type in precedence order', () => {
    const rubric = buildRubric(base);
    expect(rubric).toContain('blocking: must change before merge');
    expect(rubric).toContain('non-blocking:');
    expect(rubric).toContain('Security, Correctness, Performance, Accessibility, Maintainability, Tests, Docs, Process');
  });

  test('requires a failure scenario for correctness issues', () => {
    expect(buildRubric(base)).toContain('failureScenario');
  });

  test('rules out what /code-review rules out', () => {
    const rubric = buildRubric(base);
    expect(rubric).toContain('Pre-existing issues');
    expect(rubric).toContain('Test coverage, documentation, general code quality');
    expect(rubric).toContain('drop it rather than hedge');
  });

  test('effort changes what is asked for', () => {
    expect(buildRubric({ ...base, effort: 'low' })).not.toBe(buildRubric({ ...base, effort: 'high' }));
  });
});

describe('readConventions', () => {
  test('reads CLAUDE.md and AGENTS.md under their own headings', async () => {
    const files: Record<string, string> = { 'CLAUDE.md': 'one', 'AGENTS.md': 'two' };
    const text = await readConventions(async (p) => files[p] ?? null);
    expect(text).toContain('### CLAUDE.md\none');
    expect(text).toContain('### AGENTS.md\ntwo');
  });

  test('reads each changed directory\'s convention files after the root\'s', async () => {
    const files: Record<string, string> = { 'CLAUDE.md': 'root', 'src/api/CLAUDE.md': 'api rules' };
    const text = await readConventions(async (p) => files[p] ?? null, ['src/api/a.ts', 'src/api/b.ts', 'README.md']);
    expect(text).toContain('### CLAUDE.md\nroot');
    expect(text).toContain('### src/api/CLAUDE.md\napi rules');
    expect(text.indexOf('root')).toBeLessThan(text.indexOf('api rules'));
  });

  test('asks once per directory, not once per file', () => {
    expect(conventionPaths(['a/x.ts', 'a/y.ts'])).toEqual(['CLAUDE.md', 'AGENTS.md', 'a/CLAUDE.md', 'a/AGENTS.md']);
  });

  test('a read that fails costs the conventions, not the review', async () => {
    expect(await readConventions(async () => { throw new Error('404'); })).toBe('');
  });

  test('truncates conventions longer than the cap', async () => {
    const text = await readConventions(async (p) => (p === 'CLAUDE.md' ? 'x'.repeat(50_000) : null));
    expect(text.length).toBeLessThan(MAX_CONVENTIONS_CHARS + 50);
    expect(text).toContain('truncated');
  });
});

describe('loadStandards', () => {
  test('reads markdown and yaml files in name order and skips the rest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-standards-'));
    await writeFile(join(dir, 'b.yml'), 'rule: b');
    await writeFile(join(dir, 'a.md'), 'Rule A');
    await writeFile(join(dir, 'notes.txt'), 'ignored');
    const text = await loadStandards(dir);
    expect(text.indexOf('a.md')).toBeLessThan(text.indexOf('b.yml'));
    expect(text).not.toContain('ignored');
  });
});
