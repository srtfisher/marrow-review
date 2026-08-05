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

function withContexts(nodes: unknown[]): unknown {
  return {
    repository: {
      pullRequest: {
        reviewThreads: { nodes: [] },
        reviews: { nodes: [] },
        commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }] },
      },
    },
  };
}

test('an ERROR commit status is detectable as a failure', async () => {
  const payload = withContexts([
    {
      __typename: 'StatusContext',
      context: 'jenkins/pr-merge',
      state: 'ERROR',
      targetUrl: 'https://jenkins.example.com/9',
    },
  ]);
  const ctx = await fetchPullContext(async () => payload, 'o', 'r', 42);

  expect(ctx.checks[0]!.conclusion).toBe('failure');
  expect(ctx.checks.filter((c) => c.conclusion === 'failure')).toHaveLength(1);
});

test('a STARTUP_FAILURE check run is detectable as a failure', async () => {
  const payload = withContexts([
    {
      __typename: 'CheckRun',
      name: 'build',
      status: 'COMPLETED',
      conclusion: 'STARTUP_FAILURE',
      detailsUrl: null,
      summary: null,
    },
  ]);
  const ctx = await fetchPullContext(async () => payload, 'o', 'r', 42);

  expect(ctx.checks[0]!.conclusion).toBe('failure');
});

test('a PENDING commit status is not reported as completed', async () => {
  const payload = withContexts([
    { __typename: 'StatusContext', context: 'ci/slow', state: 'PENDING', targetUrl: null },
  ]);
  const ctx = await fetchPullContext(async () => payload, 'o', 'r', 42);

  expect(ctx.checks[0]!.status).toBe('pending');
  expect(ctx.checks[0]!.conclusion).toBeNull();
});

test('a stale check run is not reported as failing', async () => {
  const payload = withContexts([
    {
      __typename: 'CheckRun',
      name: 'lint',
      status: 'COMPLETED',
      conclusion: 'STALE',
      detailsUrl: null,
      summary: null,
    },
  ]);
  const ctx = await fetchPullContext(async () => payload, 'o', 'r', 42);

  expect(ctx.checks[0]!.conclusion).toBe('neutral');
});

test('a running check run has no conclusion', async () => {
  const payload = withContexts([
    {
      __typename: 'CheckRun',
      name: 'e2e',
      status: 'IN_PROGRESS',
      conclusion: null,
      detailsUrl: null,
      summary: null,
    },
  ]);
  const ctx = await fetchPullContext(async () => payload, 'o', 'r', 42);

  expect(ctx.checks[0]!.status).toBe('in_progress');
  expect(ctx.checks[0]!.conclusion).toBeNull();
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
