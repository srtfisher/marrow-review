/**
 * Ownership of the terminal screen for as long as the app runs.
 *
 * Ink can request the alternate buffer itself, but it gates that on its own
 * interactivity detection and it only restores on a clean unmount. Owning the
 * escapes here makes the behaviour one thing we control: entered once, cleared
 * once, and restored on every path out — clean exit, `q`, a crash, or a signal.
 *
 * The clear matters as much as the switch. A terminal configured with the
 * alternate screen disabled — tmux's `alternate-screen off` is the common
 * one — swallows the switch and leaves the previous scrollback showing behind
 * the UI, which is exactly what it looked like on the first real run.
 */

const ESC = '\u001B';
const ENTER_ALT = `${ESC}[?1049h`;
const LEAVE_ALT = `${ESC}[?1049l`;
/** Erase the whole screen, then home the cursor. */
const CLEAR = `${ESC}[2J${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

/** The slice of a writable stream this needs, so tests can supply a buffer. */
export interface ScreenStream {
  write(data: string): unknown;
  isTTY?: boolean | undefined;
}

export interface AlternateScreen {
  /** Restores the primary buffer and the cursor. Safe to call repeatedly. */
  leave(): void;
}

/**
 * Switches to the alternate screen buffer and clears it. A no-op on anything
 * that is not a terminal, so `--dry-run` and a piped invocation stay plain
 * stdout with no escapes in them.
 */
export function enterAlternateScreen(stream: ScreenStream = process.stdout): AlternateScreen {
  if (stream.isTTY !== true) return { leave: () => {} };

  stream.write(ENTER_ALT + CLEAR + HIDE_CURSOR);

  let left = false;
  return {
    leave() {
      // Idempotent: the exit hook, a signal, and the normal path all call this,
      // and a second `?1049l` would scroll the primary buffer.
      if (left) return;
      left = true;
      try {
        stream.write(SHOW_CURSOR + LEAVE_ALT);
      } catch {
        // The stream is already torn down. Nothing left to restore.
      }
    },
  };
}

/** The signal and exit surface of `process`, narrowed so tests can fake it. */
export interface ExitTarget {
  on(event: string, listener: () => void): unknown;
  exit(code: number): unknown;
}

/** Conventional shell exit codes: 128 plus the signal number. */
const SIGNAL_EXIT_CODES: ReadonlyArray<readonly [string, number]> = [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
];

/**
 * Restores the terminal however the process ends. Without this a crash after
 * the first frame, or a `kill` from another window, leaves the user staring at
 * an alternate buffer with no shell in it.
 */
export function restoreOnExit(screen: AlternateScreen, target: ExitTarget = process): void {
  target.on('exit', () => screen.leave());
  for (const [signal, code] of SIGNAL_EXIT_CODES) {
    // A listener suppresses Node's default terminate-on-signal, so exiting is
    // now this handler's job.
    target.on(signal, () => {
      screen.leave();
      target.exit(code);
    });
  }
}
