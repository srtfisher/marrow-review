import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseUnifiedDiff } from '../../../src/core/diff/parse.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/diffs/${name}.diff`, import.meta.url), 'utf8');

describe('parseUnifiedDiff', () => {
  test('assigns old and new line numbers correctly', () => {
    const [file] = parseUnifiedDiff(fixture('modify'));
    expect(file!.path).toBe('src/app.ts');
    expect(file!.status).toBe('modified');
    expect(file!.additions).toBe(2);
    expect(file!.deletions).toBe(1);

    const hunk = file!.hunks[0]!;
    expect(hunk.oldStart).toBe(10);
    expect(hunk.newStart).toBe(10);
    expect(hunk.section).toBe('export function boot() {');

    // context, context, del, add, add, context, context
    expect(hunk.lines.map((l) => l.kind)).toEqual([
      'context', 'context', 'del', 'add', 'add', 'context', 'context',
    ]);

    const del = hunk.lines[2]!;
    expect(del.oldLine).toBe(12);
    expect(del.newLine).toBeNull();
    expect(del.text).toBe('  start(config);');

    const firstAdd = hunk.lines[3]!;
    expect(firstAdd.oldLine).toBeNull();
    expect(firstAdd.newLine).toBe(12);

    const trailing = hunk.lines[5]!;
    expect(trailing.oldLine).toBe(13);
    expect(trailing.newLine).toBe(14);
  });

  test('parses an added file', () => {
    const [file] = parseUnifiedDiff(fixture('added'));
    expect(file!.status).toBe('added');
    expect(file!.path).toBe('src/new.ts');
    expect(file!.hunks[0]!.lines.every((l) => l.kind === 'add')).toBe(true);
    expect(file!.hunks[0]!.lines[0]!.newLine).toBe(1);
  });

  test('parses a deleted file and keeps its old path', () => {
    const [file] = parseUnifiedDiff(fixture('deleted'));
    expect(file!.status).toBe('deleted');
    expect(file!.path).toBe('src/old.ts');
    expect(file!.deletions).toBe(2);
  });

  test('parses a pure rename with no hunks', () => {
    const [file] = parseUnifiedDiff(fixture('rename'));
    expect(file!.status).toBe('renamed');
    expect(file!.oldPath).toBe('src/a.ts');
    expect(file!.path).toBe('src/b.ts');
    expect(file!.similarity).toBe(100);
    expect(file!.hunks).toHaveLength(0);
  });

  test('marks binary files and produces no hunks', () => {
    const [file] = parseUnifiedDiff(fixture('binary'));
    expect(file!.status).toBe('binary');
    expect(file!.hunks).toHaveLength(0);
  });

  test('attaches no-newline markers to the preceding line', () => {
    const [file] = parseUnifiedDiff(fixture('no-newline'));
    const lines = file!.hunks[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]!.kind).toBe('del');
    expect(lines[0]!.noNewlineAtEof).toBe(true);
    expect(lines[1]!.kind).toBe('add');
    expect(lines[1]!.noNewlineAtEof).toBe(true);
  });

  test('parses multiple hunks with independent numbering', () => {
    const [file] = parseUnifiedDiff(fixture('multi-hunk'));
    expect(file!.hunks).toHaveLength(2);
    expect(file!.hunks[1]!.oldStart).toBe(20);
    expect(file!.hunks[1]!.newStart).toBe(21);
    expect(file!.hunks[1]!.section).toBe('function second()');
  });

  test('handles a hunk header with omitted counts', () => {
    const [file] = parseUnifiedDiff(fixture('no-newline'));
    const hunk = file!.hunks[0]!;
    expect(hunk.oldLines).toBe(1);
    expect(hunk.newLines).toBe(1);
  });
});
