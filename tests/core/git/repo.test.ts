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

test('detectRepo says so outside a git repo', async () => {
  const run = async () => ({ stdout: '', code: 1 });
  const detected = await detectRepo('/tmp', run);
  expect(detected.ok).toBe(false);
  expect(detected.ok === false && detected.reason).toMatch(/not inside a git repository/i);
});

test('detectRepo blames git itself when git is not installed', async () => {
  const run = async () => ({ stdout: '', code: 1, missing: true });
  const detected = await detectRepo('/repo', run);
  expect(detected.ok === false && detected.reason).toMatch(/git is not installed/i);
  // The old message sent the reviewer looking for a remote that was fine.
  expect(detected.ok === false && detected.reason).not.toMatch(/origin/i);
});

test('detectRepo names a non-GitHub origin rather than calling it missing', async () => {
  const run = async (_cmd: string, args: string[]) => {
    if (args.includes('--show-toplevel')) return { stdout: '/repo\n', code: 0 };
    return { stdout: 'https://gitlab.com/a/b.git\n', code: 0 };
  };
  const detected = await detectRepo('/repo', run);
  expect(detected.ok === false && detected.reason).toMatch(/gitlab\.com/);
});

test('detectRepo combines root and remote', async () => {
  const run = async (_cmd: string, args: string[]) => {
    if (args.includes('--show-toplevel')) return { stdout: '/repo\n', code: 0 };
    return { stdout: 'git@github.com:octocat/marrow.git\n', code: 0 };
  };
  expect(await detectRepo('/repo/src', run)).toEqual({
    ok: true,
    repo: { root: '/repo', owner: 'octocat', repo: 'marrow' },
  });
});
