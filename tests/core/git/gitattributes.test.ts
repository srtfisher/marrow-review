import { test, expect } from 'bun:test';
import { parseGeneratedPaths } from '../../../src/core/git/gitattributes.js';

test('collects linguist-generated patterns', () => {
  const attrs = [
    '*.pb.go linguist-generated=true',
    'schema.json linguist-generated',
    'src/**/*.snap linguist-generated=true',
    '*.md text',
    '# a comment linguist-generated',
    '',
  ].join('\n');

  const generated = parseGeneratedPaths(attrs);
  expect(generated.has('*.pb.go')).toBe(true);
  expect(generated.has('schema.json')).toBe(true);
  expect(generated.has('src/**/*.snap')).toBe(true);
  expect(generated.has('*.md')).toBe(false);
  expect(generated.size).toBe(3);
});

test('ignores linguist-generated=false', () => {
  expect(parseGeneratedPaths('dist/x.js linguist-generated=false').size).toBe(0);
});
