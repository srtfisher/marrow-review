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
 * Button-press reporting (`1000`) and not `1002`/`1003`: motion events arrive
 * continuously, and Ink repaints on input. Tracking a mouse across an idle
 * window would redraw the whole diff for nothing.
 */

/** Written to the terminal to start and stop reporting. */
export const MOUSE_ENABLE = '\u001B[?1000h\u001B[?1006h';
export const MOUSE_DISABLE = '\u001B[?1006l\u001B[?1000l';

export type MouseAction = 'press' | 'release' | 'wheel-up' | 'wheel-down';

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
  const low = code & 3;

  return {
    action: wheel
      ? (low === 0 ? 'wheel-up' : 'wheel-down')
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
