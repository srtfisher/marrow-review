import { test, expect, describe } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRubric, loadStandards, readConventions, MAX_CONVENTIONS_CHARS,
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

  test('leaves out the standards and conventions sections when there are none', () => {
    const rubric = buildRubric(base);
    expect(rubric).not.toContain('## Team standards');
    expect(rubric).not.toContain('## Project conventions');
  });

  test('includes team standards and project conventions when supplied', () => {
    const rubric = buildRubric({ ...base, standards: 'Escape late.', conventions: 'Use Bun.' });
    expect(rubric).toContain('## Team standards');
    expect(rubric).toContain('Escape late.');
    expect(rubric).toContain('## Project conventions');
    expect(rubric).toContain('Use Bun.');
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
