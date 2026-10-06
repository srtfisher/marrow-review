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

test('runs every model pass unless told not to', () => {
  expect(parseArgs([]).passes).toEqual({ abridge: true, group: true, find: true, verify: true });
});

test('switches off each pass named with --no-', () => {
  expect(parseArgs(['--no-abridge', '--no-verify']).passes).toEqual({ abridge: false, group: true, find: true, verify: false });
  expect(parseArgs(['--no-group', '--no-find']).passes).toEqual({ abridge: true, group: false, find: false, verify: true });
});

test('--no-open is not mistaken for a pass', () => {
  const args = parseArgs(['--no-open']);
  expect(args.open).toBe(false);
  expect(args.passes.find).toBe(true);
});

test('reviews one tier below the reasoning model and scores two below, unless told otherwise', () => {
  const args = parseArgs([]);
  expect([args.reviewModel, args.verifyModel]).toEqual(['sonnet', 'haiku']);
  expect(parseArgs(['--model', 'sonnet']).reviewModel).toBe('haiku');
  expect(parseArgs(['--review-model', 'opus', '--verify-model', 'sonnet'])).toMatchObject({ reviewModel: 'opus', verifyModel: 'sonnet' });
});

test('a full model id still steps down a tier for the cheaper passes', () => {
  expect(tierBelow('claude-opus-5-5')).toBe('sonnet');
  expect(tierBelow('claude-sonnet-5-5')).toBe('haiku');
  expect(tierBelow('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001');
  const args = parseArgs(['--model', 'claude-opus-5-5']);
  expect([args.meatModel, args.reviewModel, args.verifyModel]).toEqual(['sonnet', 'sonnet', 'haiku']);
});

test('a model from no known family is used as given', () => {
  expect(tierBelow('my-gateway-model')).toBe('my-gateway-model');
});
