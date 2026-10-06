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

function searchOctokit(nodes: unknown[]) {
  const queries: string[] = [];
  return {
    queries,
    octokit: {
      ...fakeOctokit(),
      graphql: async (_query: string, vars: Record<string, unknown>) => {
        queries.push(String(vars.q));
        return { search: { nodes } };
      },
    },
  };
}

const searchHit = {
  number: 9, title: 'Add retries', isDraft: false, updatedAt: '2026-10-01T00:00:00Z', url: 'https://github.com/acme/api/pull/9',
  headRefName: 'retries', headRefOid: 'f00', baseRefName: 'main', author: { login: 'hubot' },
  repository: { name: 'api', owner: { login: 'acme' } },
};

test('review requests name the repository each one lives in', async () => {
  const { octokit } = searchOctokit([searchHit, {}]);
  const prs = await new GitHubClient('tok', octokit).listReviewRequests();
  expect(prs).toEqual([expect.objectContaining({ number: 9, owner: 'acme', repo: 'api', headRef: 'retries', headSha: 'f00' })]);
});

test('review requests search every repository unless one is named', async () => {
  const { octokit, queries } = searchOctokit([]);
  const client = new GitHubClient('tok', octokit);
  await client.listReviewRequests();
  await client.listPulls('octocat', 'marrow', 'review-requested');
  expect(queries[0]).toContain('review-requested:@me');
  expect(queries[0]).not.toContain('repo:');
  expect(queries[1]).toContain('repo:octocat/marrow');
});

// The list endpoint cannot filter by reviewer; answering from it showed every
// open pull request under "Needs my review".
test('the review-requested filter does not fall back to every open pull request', async () => {
  const { octokit } = searchOctokit([]);
  const prs = await new GitHubClient('tok', octokit).listPulls('octocat', 'marrow', 'review-requested');
  expect(prs).toEqual([]);
});
