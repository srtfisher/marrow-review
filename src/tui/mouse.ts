/**
 * Mouse reporting, in the one dialect worth speaking.
 *
 * A reviewer scrolling a diff reaches for the wheel without deciding to, and a
 * tool that ignores it feels like it is not really running in the window. The
 * keyboard remains the way to do everything — this only removes the surprise of
 * the wheel doing nothing.
 *
 * SGR (`1006`) rather than the original X10 encoding, which packs the column and
 * row into single bytes and so cannot address past column 223 — the terminals
 * this tool is used in are wider than that. Every terminal that reports mouse
 * events at all has understood SGR for a decade.
 *
 * Button-event tracking (`1002`), not `1003`. The two get lumped together as
 * "the expensive ones" and only `1003` is: it reports motion with no button
 * held, so a pointer merely crossing an idle window would repaint the whole
 * diff. `1002` reports motion only while a button is down — which is exactly a
 * drag, and costs nothing the rest of the time. A drag is how a reviewer sweeps
 * the range of lines they want to comment on.
 */

/** Written to the terminal to start and stop reporting. */
export const MOUSE_ENABLE = '\u001B[?1002h\u001B[?1006h';
export const MOUSE_DISABLE = '\u001B[?1006l\u001B[?1002l';

export type MouseAction = 'press' | 'release' | 'drag' | 'wheel-up' | 'wheel-down';

export interface MouseReport {
  action: MouseAction;
  /** `left`, `middle`, `right`, or null for a wheel notch. */
  button: 'left' | 'middle' | 'right' | null;
  /** Zero-based, counting from the left of the terminal. */
  column: number;
  /** Zero-based, counting from the top of the terminal. */
  row: number;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
}

/** `\u001B[<` — or `[<`, which is what Ink hands a handler after stripping ESC. */
const SGR = /^(?:\u001B)?\[<(\d+);(\d+);(\d+)([Mm])$/;

const BUTTON = { 0: 'left', 1: 'middle', 2: 'right' } as const;

/**
 * A mouse report, or null for anything that is not one.
 *
 * Ink's input parser hands a CSI sequence to a handler whole and reports no key
 * name for it, so this can be tried first on every keystroke: real keys never
 * match, and a mouse report never reaches the keymap.
 */
export function parseMouse(input: string): MouseReport | null {
  const match = SGR.exec(input);
  if (!match) return null;

  const code = Number(match[1]);
  const column = Number(match[2]);
  const row = Number(match[3]);
  // A terminal counts from one; every layout number in this app counts from
  // zero, and mixing the two is a one-row-off cursor nobody can explain.
  if (!Number.isFinite(column) || !Number.isFinite(row) || column < 1 || row < 1) return null;

  const wheel = (code & 64) !== 0;
  // Motion. Checked only when the wheel bit is clear: a notch reports 64 or 65
  // and never sets 32, but reading the two the other way round would turn every
  // scroll of the wheel into a selection sweep.
  const motion = !wheel && (code & 32) !== 0;
  const low = code & 3;

  return {
    action: wheel
      ? (low === 0 ? 'wheel-up' : 'wheel-down')
      : motion
        ? 'drag'
        : (match[4] === 'M' ? 'press' : 'release'),
    button: wheel ? null : (BUTTON[low as 0 | 1 | 2] ?? null),
    column: column - 1,
    row: row - 1,
    shift: (code & 4) !== 0,
    meta: (code & 8) !== 0,
    ctrl: (code & 16) !== 0,
  };
}

/**
 * Rows a wheel notch moves. Three is the conventional notch, and it is small
 * enough that a diff still reads as scrolling rather than jumping.
 */
export const WHEEL_ROWS = 3;

/** How close two presses must be to read as one gesture. */
export const DOUBLE_CLICK_MS = 400;

export interface Click {
  row: number;
  /** Milliseconds, from whatever clock the caller is already holding. */
  at: number;
}

/**
 * Whether a press completes a double-click.
 *
 * The clock is passed in rather than read here so this stays a pure function
 * over two numbers and can be tested without one.
 *
 * The row has to match. Without that, a quick correction of a mis-aimed click
 * would open a composer on the line the reviewer was moving away from.
 */
export function isDoubleClick(previous: Click | null, next: Click): boolean {
  if (previous === null) return false;
  return previous.row === next.row && next.at - previous.at <= DOUBLE_CLICK_MS;
}
