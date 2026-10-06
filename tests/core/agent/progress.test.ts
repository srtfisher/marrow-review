import { test, expect } from 'bun:test';
import { describeToolUse, isRead } from '../../../src/core/agent/progress.js';
import { toolName } from '../../../src/core/agent/types.js';

test('a read names the file relative to the checkout', () => {
  expect(describeToolUse('Read', { file_path: '/wt/src/app.ts' }, '/wt')).toBe('reading src/app.ts');
});

test('an API-mode read names the path it fetched', () => {
  expect(describeToolUse(toolName('read_file'), { path: 'src/app.ts' })).toBe('reading src/app.ts');
  expect(isRead(toolName('read_file'))).toBe(true);
});

test('a search quotes what it looked for', () => {
  expect(describeToolUse('Grep', { pattern: 'retry(' })).toBe('searching for “retry(”');
});

test('a very long path keeps its tail, where the file name is', () => {
  const long = `src/${'deep/'.repeat(20)}file.ts`;
  const said = describeToolUse('Read', { file_path: long });
  expect(said.endsWith('file.ts')).toBe(true);
  expect(said.length).toBeLessThan(80);
});

test('a tool it does not know is still named, not dropped', () => {
  expect(describeToolUse('Mystery', {})).toBe('using Mystery');
});
