import { test, expect } from 'bun:test';
import { resolveGitHubToken } from '../../../src/core/github/auth.js';

test('prefers gh auth token', async () => {
  const run = async () => ({ stdout: 'gho_fromGh\n', code: 0 });
  const token = await resolveGitHubToken(run, { GITHUB_TOKEN: 'ghp_fromEnv' });
  expect(token).toBe('gho_fromGh');
});

test('falls back to GITHUB_TOKEN when gh fails', async () => {
  const run = async () => ({ stdout: '', code: 1 });
  const token = await resolveGitHubToken(run, { GITHUB_TOKEN: 'ghp_fromEnv' });
  expect(token).toBe('ghp_fromEnv');
});

test('throws an actionable error when neither is available', async () => {
  const run = async () => ({ stdout: '', code: 1 });
  await expect(resolveGitHubToken(run, {})).rejects.toThrow(/gh auth login/);
});

test('falls back to GITHUB_TOKEN when gh is not installed at all', async () => {
  const run = async () => ({ stdout: '', code: 1, missing: true });
  expect(await resolveGitHubToken(run, { GITHUB_TOKEN: 'ghp_fromEnv' })).toBe('ghp_fromEnv');
});

test('tells you to install gh rather than to log into one you do not have', async () => {
  const run = async () => ({ stdout: '', code: 1, missing: true });
  await expect(resolveGitHubToken(run, {})).rejects.toThrow(/cli\.github\.com/);
});
