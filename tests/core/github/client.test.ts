import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GitHubClient } from '../../../src/core/github/client.js';

const detail = JSON.parse(
  readFileSync(new URL('../../fixtures/github/pr-detail.json', import.meta.url), 'utf8'),
);
const list = JSON.parse(
  readFileSync(new URL('../../fixtures/github/pr-list.json', import.meta.url), 'utf8'),
);

function fakeOctokit(diff = 'diff --git a/x b/x\n') {
  return {
    rest: {
      pulls: {
        get: async ({ mediaType }: { mediaType?: { format?: string } }) =>
          mediaType?.format === 'diff' ? { data: diff } : { data: detail },
        list: async () => ({ data: list }),
      },
    },
    paginate: async () => list,
  };
}

test('maps a PR detail response to the domain type', async () => {
  const client = new GitHubClient('tok', fakeOctokit());
  const pr = await client.getPull('octocat', 'marrow', 42, 'octocat');

  expect(pr.number).toBe(42);
  expect(pr.author).toBe('hubot');
  expect(pr.state).toBe('open');
  expect(pr.headSha).toBe('abc1234def5678');
  expect(pr.baseRef).toBe('main');
  expect(pr.changedFiles).toBe(3);
  expect(pr.diff).toContain('diff --git');
  expect(pr.viewerIsAuthor).toBe(false);
});

test('flags the viewer as author when logins match', async () => {
  const client = new GitHubClient('tok', fakeOctokit());
  const pr = await client.getPull('octocat', 'marrow', 42, 'hubot');
  expect(pr.viewerIsAuthor).toBe(true);
});

test('reports merged state distinctly from closed', async () => {
  const merged = { ...detail, state: 'closed', merged: true };
  const octokit = {
    rest: {
      pulls: {
        get: async ({ mediaType }: { mediaType?: { format?: string } }) =>
          mediaType?.format === 'diff' ? { data: '' } : { data: merged },
        list: async () => ({ data: [] }),
      },
    },
    paginate: async () => [],
  };
  const client = new GitHubClient('tok', octokit);
  const pr = await client.getPull('octocat', 'marrow', 42, 'octocat');
  expect(pr.state).toBe('merged');
});

test('maps a PR list response', async () => {
  const client = new GitHubClient('tok', fakeOctokit());
  const prs = await client.listPulls('octocat', 'marrow', 'open');
  expect(prs).toHaveLength(2);
  expect(prs[0]!.title).toBe('Fix thematic-break rendering');
  expect(prs[0]!.headRef).toBe('fix/thematic-break');
  expect(prs[1]!.isDraft).toBe(true);
});

// The fixture carries the nulls the live endpoint really sends. A summary that
// exposed a size at all would have to invent one, and inventing it is exactly
// how every row came to read `0 files`.
test('a list summary carries no size figures at all', async () => {
  const client = new GitHubClient('tok', fakeOctokit());
  const prs = await client.listPulls('octocat', 'marrow', 'open');
  expect(prs[0]!).not.toHaveProperty('changedFiles');
  expect(prs[0]!).not.toHaveProperty('additions');
  expect(prs[0]!).not.toHaveProperty('deletions');
  expect(prs[0]!.updatedAt).toBe('2026-08-01T12:00:00Z');
});
