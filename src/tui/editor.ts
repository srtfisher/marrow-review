import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function resolveEditor(env: NodeJS.ProcessEnv): string {
  return env.VISUAL?.trim() || env.EDITOR?.trim() || 'vi';
}

export interface EditorRunner {
  (command: string, args: string[]): Promise<number>;
}

const defaultRunner: EditorRunner = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });

export interface EditOptions {
  env?: NodeJS.ProcessEnv;
  run?: EditorRunner;
  tmpDir?: string;
}

/**
 * Opens `initial` in the user's editor and returns what they saved.
 *
 * A non-zero exit is treated as "cancelled": the original text is returned
 * untouched rather than whatever half-written state the file was left in.
 * Raw-mode suspend/resume belongs to the Ink caller, not here — keeping it out
 * is what lets this be tested with a fake runner.
 */
export async function editInEditor(
  initial: string,
  opts: EditOptions = {},
): Promise<string> {
  const env = opts.env ?? process.env;
  const run = opts.run ?? defaultRunner;
  const dir = opts.tmpDir ?? (await mkdtemp(join(tmpdir(), 'marrow-')));
  const file = join(dir, 'COMMENT_EDITMSG.md');

  await writeFile(file, initial, 'utf8');

  const [command, ...args] = resolveEditor(env).split(/\s+/);
  const code = await run(command ?? 'vi', [...args, file]);

  if (code !== 0) {
    if (!opts.tmpDir) await rm(dir, { recursive: true, force: true });
    return initial;
  }

  const edited = (await readFile(file, 'utf8')).replace(/\n+$/, '');
  if (!opts.tmpDir) await rm(dir, { recursive: true, force: true });
  return edited;
}
