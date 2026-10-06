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

test('parses a PR URL, keeping the repository it names', () => {
  const args = parseArgs(['https://github.com/octocat/marrow/pull/42']);
  expect(args.prNumber).toBe(42);
  expect(args.prRepo).toEqual({ owner: 'octocat', repo: 'marrow' });
});

test('parses an owner/repo#number reference', () => {
  expect(parseArgs(['octocat/marrow#7']).prRepo).toEqual({ owner: 'octocat', repo: 'marrow' });
});

test('a bare number names no repository', () => {
  expect(parseArgs(['42']).prRepo).toBeNull();
});

test('the server opens the browser on a port the OS picks unless told otherwise', () => {
  expect(parseArgs([]).open).toBe(true);
  expect(parseArgs([]).port).toBe(0);
  const args = parseArgs(['--no-open', '--port', '4321']);
  expect(args.open).toBe(false);
  expect(args.port).toBe(4321);
});

test('source and effort accept only their own values', () => {
  expect(parseArgs(['--source', 'api', '--effort', 'high'])).toMatchObject({ source: 'api', effort: 'high' });
  expect(() => parseArgs(['--source', 'ftp'])).toThrow('--source must be one of');
  expect(() => parseArgs(['--effort', 'max'])).toThrow('--effort must be one of');
});

test('an unknown filter is refused rather than passed to GitHub', () => {
  expect(() => parseArgs(['--filter', 'mine'])).toThrow('--filter must be one of');
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
