import { test, expect } from 'bun:test';
import { buildHistoryQuery, fetchFileHistory, HISTORY_FILES } from '../../../src/core/github/history.js';

const commit = (sha: string, pr: number | null, threads: Array<{ path: string; bodies: string[] }> = []) => ({
  abbreviatedOid: sha, messageHeadline: `commit ${sha}`, committedDate: '2026-09-01T10:00:00Z',
  author: { name: 'Ada', user: { login: 'ada' } },
  associatedPullRequests: { nodes: pr === null ? [] : [{
    number: pr, title: `PR ${pr}`,
    reviewThreads: { nodes: threads.map((t) => ({ path: t.path, comments: { nodes: t.bodies.map((body) => ({ body, author: { login: 'rev' } })) } })) },
  }] },
});

test('asks for every file in one request, each path as a variable', async () => {
  const calls: Array<{ query: string; vars: Record<string, unknown> }> = [];
  await fetchFileHistory(async (query, vars) => { calls.push({ query, vars }); return { repository: { object: {} } }; }, 'o', 'r', 'base1', ['a.ts', 'b"; drop.ts'], 9);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.vars).toMatchObject({ owner: 'o', repo: 'r', oid: 'base1', p0: 'a.ts', p1: 'b"; drop.ts' });
  expect(calls[0]!.query).not.toContain('drop.ts');
});

test('keeps commits and the review comments made on the same file in their pull requests', async () => {
  const history = await fetchFileHistory(async () => ({ repository: { object: {
    f0: { nodes: [
      commit('aaa', 5, [{ path: 'a.ts', bodies: ['Cache this lookup.', 'Cache this lookup.'] }, { path: 'other.ts', bodies: ['Not about a.ts'] }]),
      commit('bbb', null),
    ] },
  } } }), 'o', 'r', 'base1', ['a.ts'], 9);
  expect(history[0]!.commits.map((c) => [c.sha, c.pr?.number ?? null])).toEqual([['aaa', 5], ['bbb', null]]);
  expect(history[0]!.priorComments).toEqual([{ pr: 5, author: 'rev', body: 'Cache this lookup.' }]);
});

test('ignores comments from the pull request under review', async () => {
  const history = await fetchFileHistory(async () => ({ repository: { object: {
    f0: { nodes: [commit('aaa', 9, [{ path: 'a.ts', bodies: ['Already here.'] }])] },
  } } }), 'o', 'r', 'base1', ['a.ts'], 9);
  expect(history[0]!.priorComments).toEqual([]);
});

test('asks about no more than the file cap, and nothing without a base commit', async () => {
  let asked = 0;
  const graphql = async (_q: string, vars: Record<string, unknown>) => { asked = Object.keys(vars).filter((k) => k.startsWith('p')).length; return { repository: { object: {} } }; };
  await fetchFileHistory(graphql, 'o', 'r', 'base1', Array.from({ length: 40 }, (_, i) => `f${i}.ts`), 9);
  expect(asked).toBe(HISTORY_FILES);
  expect(await fetchFileHistory(graphql, 'o', 'r', '', ['a.ts'], 9)).toEqual([]);
});

test('the query declares one variable per file', () => {
  expect(buildHistoryQuery(2)).toContain('$p0: String!, $p1: String!');
});
