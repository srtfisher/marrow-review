import { defaultRunner, type CommandRunner } from '../github/auth.js';

export interface RepoContext {
  root: string;
  owner: string;
  repo: string;
}

const SSH_RE = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/;
const HTTPS_RE = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/;

export function parseRemoteUrl(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  for (const re of [SSH_RE, HTTPS_RE]) {
    const m = re.exec(trimmed);
    if (m) return { owner: m[1]!, repo: m[2]! };
  }
  return null;
}

/**
 * Why detection failed, in the words the caller should print.
 *
 * Every failure used to read "not inside a GitHub clone", which is a lie when
 * the truth is that git is not installed — the reviewer then goes looking for a
 * remote that was fine all along.
 */
export type RepoDetection =
  | { ok: true; repo: RepoContext }
  | { ok: false; reason: string };

export async function detectRepo(
  cwd: string,
  run: CommandRunner = defaultRunner,
): Promise<RepoDetection> {
  const top = await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel']);
  if (top.missing === true) {
    return { ok: false, reason: 'git is not installed, or not on PATH. marrow reads the repository through it.' };
  }
  if (top.code !== 0) {
    return { ok: false, reason: 'Not inside a git repository. Run marrow from a clone of the repository you want to review.' };
  }

  const remote = await run('git', ['-C', cwd, 'remote', 'get-url', 'origin']);
  if (remote.code !== 0) {
    return { ok: false, reason: 'This repository has no `origin` remote. marrow finds the pull requests through it.' };
  }

  const parsed = parseRemoteUrl(remote.stdout);
  if (!parsed) {
    return { ok: false, reason: `\`origin\` is not a GitHub remote (${remote.stdout.trim()}). marrow reviews pull requests on github.com.` };
  }

  return { ok: true, repo: { root: top.stdout.trim(), ...parsed } };
}
