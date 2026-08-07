import stringWidth from 'string-width';

/**
 * A faint wash behind added and deleted lines, so the eye finds them without
 * reading the gutter.
 *
 * This is the one place in the app that names a colour value, and it is a
 * deliberate exception to the rule in `.interface-design/system.md` that
 * everything binds to ANSI slot names. There is no subtle background in the
 * sixteen-slot palette: `bgGreen` is the loudest thing that can be put on a
 * terminal, and the dim attribute does not apply to backgrounds. A tint this
 * faint has to state its own value.
 *
 * The price of stating it is that the value only works against one kind of
 * background — a dark tint on a Solarized Light terminal is a black bar. So the
 * terminal is asked what its background is rather than assumed, and when it
 * will not say, or cannot render the colour, there is simply no tint.
 */

/** Which half of the range the terminal's own background sits in. */
export type Tone = 'dark' | 'light';

export interface DiffTint {
  add: string;
  del: string;
}

/**
 * Tuned by eye at roughly 8% of the distance from the terminal background to a
 * saturated green/red — present when you sweep the pane, invisible when you are
 * reading one line. Red is the fainter of the two on purpose: deletions are
 * usually the taller block, and matching the green's weight turned the pane pink.
 */
export const DIFF_TINT: Record<Tone, DiffTint> = {
  dark: { add: '#12280f', del: '#2b0f10' },
  light: { add: '#e6f4e2', del: '#fbe9e9' },
};

/** OSC 11 with no argument is "report the background colour". */
export const OSC11_QUERY = ']11;?';

/**
 * xterm answers `\e]11;rgb:1e1e/1e1e/1e1e\e\\`, or the same BEL-terminated.
 * Channels come back in one to four hex digits and the width is the scale, so
 * `f`, `ff`, and `ffff` all mean full.
 */
const OSC11_REPLY = /\]11;rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i;

function channel(hex: string): number {
  return Number.parseInt(hex, 16) / (16 ** hex.length - 1);
}

/**
 * Weighted for perceived brightness rather than the arithmetic mean: a mid green
 * background is light to look at and a mid blue one is not, and the mean calls
 * them the same.
 */
export function parseOsc11(response: string): Tone | null {
  const [, r, g, b] = OSC11_REPLY.exec(response) ?? [];
  if (r === undefined || g === undefined || b === undefined) return null;
  const luminance = 0.299 * channel(r) + 0.587 * channel(g) + 0.114 * channel(b);
  return luminance < 0.5 ? 'dark' : 'light';
}

/**
 * `COLORFGBG` is the older convention — rxvt, konsole, and a few others export
 * it — and its last field is the ANSI colour the terminal is painted in. Used
 * only when the terminal will not answer the query.
 */
export function toneFromEnv(env: Record<string, string | undefined>): Tone | null {
  const parts = env['COLORFGBG']?.split(';');
  const background = parts?.[parts.length - 1];
  if (background === undefined) return null;
  const slot = Number.parseInt(background, 10);
  if (!Number.isInteger(slot)) return null;
  // Of the sixteen, 7 (white) and 9–15 (the bright half) are the light ones.
  return slot === 7 || slot >= 9 ? 'light' : 'dark';
}

/**
 * Below 256 colours there is no subtle background to fall back to — the value
 * would be quantised to `bgGreen`, which is the exact thing this must not do.
 * Node reports 1, 4, 8, or 24 bits.
 */
export function canTint(colorDepth: number): boolean {
  return colorDepth >= 8;
}

/** The write side of the probe, narrowed so tests can supply a buffer. */
export interface TintStdout {
  write(data: string): unknown;
  isTTY?: boolean | undefined;
  getColorDepth?: (() => number) | undefined;
}

/** The read side of the probe, narrowed for the same reason. */
export interface TintStdin {
  isTTY?: boolean | undefined;
  isRaw?: boolean | undefined;
  setRawMode?: ((mode: boolean) => unknown) | undefined;
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
  off(event: 'data', listener: (chunk: unknown) => void): unknown;
  resume(): unknown;
  pause(): unknown;
  isPaused?: (() => boolean) | undefined;
}

export interface TintProbe {
  stdin: TintStdin;
  stdout: TintStdout;
  env: Record<string, string | undefined>;
  /**
   * A terminal that answers at all answers immediately; this bound only exists
   * for the ones that never will. Anything a reviewer types inside the window is
   * swallowed, so it is short enough not to eat the first keystroke of a fast
   * start.
   */
  timeoutMs?: number;
}

/**
 * Asks the terminal for its background colour and returns the tint to use, or
 * null for no tint at all.
 *
 * Runs before Ink mounts, because it borrows raw mode on stdin and Ink owns
 * that afterwards. Every exit path puts stdin back exactly as it was found: a
 * raw-mode flag left set here outlives a crash and leaves the user's shell
 * without line editing.
 */
export async function detectTint({
  stdin, stdout, env, timeoutMs = 100,
}: TintProbe): Promise<DiffTint | null> {
  if (stdout.getColorDepth !== undefined && !canTint(stdout.getColorDepth())) return null;
  // Not a terminal on both ends, so there is nothing to ask: the query bytes
  // would land in the output and no reply would ever come back.
  if (stdout.isTTY !== true || stdin.isTTY !== true || stdin.setRawMode === undefined) {
    const tone = toneFromEnv(env);
    return tone === null ? null : DIFF_TINT[tone];
  }

  const tone = await queryTone(stdin, stdout, timeoutMs) ?? toneFromEnv(env) ?? 'dark';
  return DIFF_TINT[tone];
}

function queryTone(stdin: TintStdin, stdout: TintStdout, timeoutMs: number): Promise<Tone | null> {
  const setRawMode = stdin.setRawMode;
  if (setRawMode === undefined) return Promise.resolve(null);

  const wasRaw = stdin.isRaw === true;
  const wasPaused = stdin.isPaused?.() ?? true;

  return new Promise<Tone | null>((resolve) => {
    let buffer = '';
    let settled = false;

    const finish = (tone: Tone | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdin.off('data', onData);
      if (!wasRaw) setRawMode.call(stdin, false);
      if (wasPaused) stdin.pause();
      resolve(tone);
    };

    const onData = (chunk: unknown) => {
      // Reassembled rather than parsed per chunk: the reply arrives split at an
      // arbitrary byte often enough that per-chunk parsing looks like a terminal
      // that does not support the query.
      buffer += String(chunk);
      const tone = parseOsc11(buffer);
      if (tone !== null) finish(tone);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    // Nothing should be held open waiting for a terminal that will not answer.
    timer.unref?.();

    setRawMode.call(stdin, true);
    stdin.on('data', onData);
    stdin.resume();
    stdout.write(OSC11_QUERY);
  });
}

/**
 * Pads an already-coloured string out to `width` visible columns.
 *
 * The band has to reach the pane edge or it is not a band — a tint that stops
 * where the code stops draws a ragged right edge that tracks line length, which
 * reads as noise rather than structure. `String.padEnd` cannot do this: the
 * syntax highlighter's escape sequences are characters that occupy no columns.
 */
export function padToWidth(text: string, width: number): string {
  const visible = stringWidth(text);
  return visible >= width ? text : text + ' '.repeat(width - visible);
}
