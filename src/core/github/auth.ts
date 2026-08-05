import { execFile } from 'node:child_process';

export type CommandRunner = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; code: number }>;

export const defaultRunner: CommandRunner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, (error, stdout) => {
      resolve({ stdout, code: error ? 1 : 0 });
    });
  });

export async function resolveGitHubToken(
  run: CommandRunner = defaultRunner,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const gh = await run('gh', ['auth', 'token']);
  const fromGh = gh.stdout.trim();
  if (gh.code === 0 && fromGh.length > 0) return fromGh;

  const fromEnv = env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  throw new Error(
    'No GitHub credentials found. Run `gh auth login`, or set GITHUB_TOKEN.',
  );
}
