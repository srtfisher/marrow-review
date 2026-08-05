import { test, expect } from 'bun:test';
import { parseArgs, tierBelow } from '../../src/cli/args.js';

test('defaults to opus with sonnet for the meat pass', () => {
  const args = parseArgs([]);
  expect(args.model).toBe('opus');
  expect(args.meatModel).toBe('sonnet');
  expect(args.prNumber).toBeNull();
  expect(args.dryRun).toBe(false);
  expect(args.useApiKey).toBe(false);
});

test('parses a bare PR number', () => {
  expect(parseArgs(['42']).prNumber).toBe(42);
});

test('parses a PR URL', () => {
  expect(parseArgs(['https://github.com/octocat/marrow/pull/42']).prNumber).toBe(42);
});

test('--model shifts the meat model down a tier', () => {
  const args = parseArgs(['--model', 'sonnet']);
  expect(args.model).toBe('sonnet');
  expect(args.meatModel).toBe('haiku');
});

test('--meat-model overrides independently', () => {
  const args = parseArgs(['--model', 'opus', '--meat-model', 'haiku']);
  expect(args.meatModel).toBe('haiku');
});

test('parses flags', () => {
  const args = parseArgs(['--dry-run', '--use-api-key', '42']);
  expect(args.dryRun).toBe(true);
  expect(args.useApiKey).toBe(true);
  expect(args.prNumber).toBe(42);
});

test('haiku stays at haiku', () => {
  expect(tierBelow('haiku')).toBe('haiku');
});

test('rejects an unknown flag with a clear message', () => {
  expect(() => parseArgs(['--nope'])).toThrow(/Unknown option: --nope/);
});
