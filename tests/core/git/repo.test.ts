import { test, expect } from 'bun:test';
import { parseRemoteUrl, detectRepo } from '../../../src/core/git/repo.js';

test('parses an ssh remote', () => {
  expect(parseRemoteUrl('git@github.com:octocat/marrow.git')).toEqual({
    owner: 'octocat',
    repo: 'marrow',
  });
});

test('parses an https remote with and without .git', () => {
  expect(parseRemoteUrl('https://github.com/octocat/marrow.git')).toEqual({
    owner: 'octocat',
    repo: 'marrow',
  });
  expect(parseRemoteUrl('https://github.com/octocat/marrow')).toEqual({
    owner: 'octocat',
    repo: 'marrow',
  });
});

test('returns null for a non-GitHub remote', () => {
  expect(parseRemoteUrl('https://gitlab.com/a/b.git')).toBeNull();
});

test('detectRepo returns null outside a git repo', async () => {
  const run = async () => ({ stdout: '', code: 1 });
  expect(await detectRepo('/tmp', run)).toBeNull();
});

test('detectRepo combines root and remote', async () => {
  const run = async (_cmd: string, args: string[]) => {
    if (args.includes('--show-toplevel')) return { stdout: '/repo\n', code: 0 };
    return { stdout: 'git@github.com:octocat/marrow.git\n', code: 0 };
  };
  expect(await detectRepo('/repo/src', run)).toEqual({
    root: '/repo',
    owner: 'octocat',
    repo: 'marrow',
  });
});
