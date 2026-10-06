import { execFile } from 'node:child_process';

/** The one line the CLI prints for other programs to read. */
export function parseServerUrl(line: string): string | null {
  const match = /^marrow: (http:\/\/\S+)$/.exec(line.trim());
  return match ? match[1]! : null;
}

export type ShellRunner = (shell: string, args: string[], timeoutMs: number) => Promise<string | null>;

const runShell: ShellRunner = (shell, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(shell, args, { timeout: timeoutMs }, (error, stdout) => resolve(error ? null : stdout));
  });

const FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

/**
 * An app opened from Finder gets launchd's PATH, `/usr/bin:/bin:/usr/sbin:/sbin`,
 * where `gh` is not found and marrow reports it as not installed. The login
 * shell knows the PATH the user's terminal has.
 */
export async function loginShellPath(env: NodeJS.ProcessEnv, run: ShellRunner = runShell): Promise<string> {
  const current = env.PATH ?? '';
  const shell = env.SHELL || '/bin/zsh';
  // A marker, because rc files are free to print to stdout before our command runs.
  const out = await run(shell, ['-ilc', 'printf "__MARROW_PATH__%s" "$PATH"'], 5000);
  const found = out?.split('__MARROW_PATH__')[1]?.trim();
  if (found) return found;
  const dirs = current.split(':').filter(Boolean);
  return [...dirs, ...FALLBACK_DIRS.filter((d) => !dirs.includes(d))].join(':');
}

/** The last `max` lines of what the CLI wrote to stderr, for the error page. */
export function tail(text: string, max = 20): string {
  return text.trimEnd().split('\n').slice(-max).join('\n');
}

export interface Notice {
  title: string;
  body: string;
}

/** The page is untrusted input to the main process; take two short strings or nothing. */
export function toNotice(raw: unknown): Notice | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { title, body } = raw as Record<string, unknown>;
  if (typeof title !== 'string' || typeof body !== 'string') return null;
  return { title: title.slice(0, 200), body: body.slice(0, 500) };
}

/**
 * Arguments for `osascript` to post a notice. macOS refuses notifications from
 * an ad-hoc signed app, but not from osascript. The text goes in as argv so the
 * page's strings never become AppleScript source. macOS shows it as Script
 * Editor's, so the title says who it is from.
 */
export function osascriptNotice(notice: Notice): string[] {
  return ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title "marrow" subtitle (item 1 of argv)', '-e', 'end run', notice.title, notice.body];
}

/** Mirrors the core's PassSettings; the shell imports nothing from marrow. */
export interface Passes {
  abridge: boolean;
  group: boolean;
  find: boolean;
  verify: boolean;
}

const PASS_NAMES = ['abridge', 'group', 'find', 'verify'] as const;

export function toPasses(raw: unknown): Passes | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!PASS_NAMES.every((name) => typeof r[name] === 'boolean')) return null;
  return { abridge: r.abridge as boolean, group: r.group as boolean, find: r.find as boolean, verify: r.verify as boolean };
}

/** Every pass runs unless switched off, so only the off ones need a flag. */
export function passFlags(passes: Passes | null): string[] {
  return passes ? PASS_NAMES.filter((name) => !passes[name]).map((name) => `--no-${name}`) : [];
}

/** The first directory in order holding an executable `name`. */
export function findExecutable(name: string, dirs: string[], isExecutable: (path: string) => boolean): string | null {
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = `${dir.replace(/\/+$/, '')}/${name}`;
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}
