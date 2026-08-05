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

export async function detectRepo(
  cwd: string,
  run: CommandRunner = defaultRunner,
): Promise<RepoContext | null> {
  const top = await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel']);
  if (top.code !== 0) return null;

  const remote = await run('git', ['-C', cwd, 'remote', 'get-url', 'origin']);
  if (remote.code !== 0) return null;

  const parsed = parseRemoteUrl(remote.stdout);
  if (!parsed) return null;

  return { root: top.stdout.trim(), ...parsed };
}
