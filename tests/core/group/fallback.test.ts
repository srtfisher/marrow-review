import { test, expect, describe } from 'bun:test';
import { areaOf, categorize } from '../../../src/core/group/fallback.js';

describe('areaOf', () => {
  test('looks one level into container directories', () => {
    expect(areaOf('src/api/retry.ts')).toBe('src/api');
    expect(areaOf('packages/ui/button.tsx')).toBe('packages/ui');
  });

  test('does not look past an ordinary top-level directory', () => {
    expect(areaOf('docs/guide/intro.md')).toBe('docs');
  });

  test('a file directly inside a container is grouped under the container', () => {
    expect(areaOf('src/cli.ts')).toBe('src');
  });

  test('root files share one area', () => {
    expect(areaOf('package.json')).toBe('(root)');
  });
});

describe('categorize', () => {
  test('recognizes tests by directory and by suffix', () => {
    expect(categorize('tests/a.ts')).toBe('tests');
    expect(categorize('src/a.test.ts')).toBe('tests');
  });

  test('a file merely named like a test word is not a test', () => {
    expect(categorize('src/latest.ts')).toBe('other');
    expect(categorize('src/contest/entry.ts')).toBe('other');
  });
});
