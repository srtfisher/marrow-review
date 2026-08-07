import { execFile } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  code: number;
  /**
   * The command is not on PATH, as distinct from having run and failed.
   * Collapsing the two made "gh is not installed" say `gh auth login`, and made
   * a missing git say the clone was not a GitHub one.
   */
  missing?: boolean;
}

export type CommandRunner = (cmd: string, args: string[]) => Promise<CommandResult>;

export const defaultRunner: CommandRunner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, (error, stdout) => {
      const missing = (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
      resolve({ stdout, code: error ? 1 : 0, missing });
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
    gh.missing === true
      ? 'No GitHub credentials found. Install the GitHub CLI (https://cli.github.com) and run `gh auth login`, or set GITHUB_TOKEN.'
      : 'No GitHub credentials found. Run `gh auth login`, or set GITHUB_TOKEN.',
  );
}
