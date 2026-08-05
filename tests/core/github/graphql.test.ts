import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fetchPullContext } from '../../../src/core/github/graphql.js';

const payload = JSON.parse(
  readFileSync(new URL('../../fixtures/github/threads-checks.json', import.meta.url), 'utf8'),
);

test('maps review threads', async () => {
  const ctx = await fetchPullContext(async () => payload, 'o', 'r', 42);
  expect(ctx.threads).toHaveLength(1);
  expect(ctx.threads[0]!.path).toBe('mdv/SmartTypography.swift');
  expect(ctx.threads[0]!.line).toBe(57);
  expect(ctx.threads[0]!.comments[0]!.author).toBe('tqbf');
});

test('maps both CheckRun and StatusContext into CheckRun', async () => {
  const ctx = await fetchPullContext(async () => payload, 'o', 'r', 42);
  expect(ctx.checks).toHaveLength(2);

  const run = ctx.checks.find((c) => c.name === 'unit-tests')!;
  expect(run.conclusion).toBe('failure');
  expect(run.output).toBe('3 tests failed');

  const legacy = ctx.checks.find((c) => c.name === 'ci/legacy')!;
  expect(legacy.conclusion).toBe('success');
  expect(legacy.detailsUrl).toBe('https://ci.example.com/1');
});

test('surfaces a pending review id so the UI can warn', async () => {
  const ctx = await fetchPullContext(async () => payload, 'o', 'r', 42);
  expect(ctx.viewerPendingReviewId).toBe('PRR_pending1');
});

test('returns empty context when the PR has no threads or checks', async () => {
  const empty = {
    repository: {
      pullRequest: {
        reviewThreads: { nodes: [] },
        reviews: { nodes: [] },
        commits: { nodes: [] },
      },
    },
  };
  const ctx = await fetchPullContext(async () => empty, 'o', 'r', 42);
  expect(ctx.threads).toEqual([]);
  expect(ctx.checks).toEqual([]);
  expect(ctx.viewerPendingReviewId).toBeNull();
});
