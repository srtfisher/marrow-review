import { test, expect, describe } from 'bun:test';
import {
  DOUBLE_CLICK_MS, MOUSE_DISABLE, MOUSE_ENABLE, isDoubleClick, parseMouse,
} from '../../src/tui/mouse.js';

const ESC = '';

describe('parseMouse', () => {
  test('reads a left click, counting from zero where the terminal counts from one', () => {
    expect(parseMouse(`${ESC}[<0;42;13M`)).toEqual({
      action: 'press',
      button: 'left',
      column: 41,
      row: 12,
      shift: false,
      meta: false,
      ctrl: false,
    });
  });

  // Ink strips the escape before handing the sequence to a handler, so the
  // parser has to accept the sequence in the shape it will actually arrive in.
  test('accepts the sequence with the escape already stripped', () => {
    expect(parseMouse('[<0;42;13M')?.column).toBe(41);
  });

  test('tells a press from a release', () => {
    expect(parseMouse(`${ESC}[<0;1;1M`)?.action).toBe('press');
    expect(parseMouse(`${ESC}[<0;1;1m`)?.action).toBe('release');
  });

  test('reads the wheel, which is the whole reason this exists', () => {
    expect(parseMouse(`${ESC}[<64;5;5M`)?.action).toBe('wheel-up');
    expect(parseMouse(`${ESC}[<65;5;5M`)?.action).toBe('wheel-down');
    // A notch is not a button, so nothing downstream can treat it as one.
    expect(parseMouse(`${ESC}[<64;5;5M`)?.button).toBeNull();
  });

  test('names the three buttons', () => {
    expect(parseMouse(`${ESC}[<0;1;1M`)?.button).toBe('left');
    expect(parseMouse(`${ESC}[<1;1;1M`)?.button).toBe('middle');
    expect(parseMouse(`${ESC}[<2;1;1M`)?.button).toBe('right');
  });

  test('reads the modifier bits', () => {
    expect(parseMouse(`${ESC}[<4;1;1M`)?.shift).toBe(true);
    expect(parseMouse(`${ESC}[<8;1;1M`)?.meta).toBe(true);
    expect(parseMouse(`${ESC}[<16;1;1M`)?.ctrl).toBe(true);
    // Modifiers must not be mistaken for a different button.
    expect(parseMouse(`${ESC}[<20;1;1M`)?.button).toBe('left');
  });

  test('addresses a column past 223, which the old encoding could not', () => {
    expect(parseMouse(`${ESC}[<0;400;90M`)).toMatchObject({ column: 399, row: 89 });
  });

  // The reason this is tried before the keymap: left in, the sequence reaches it
  // as a string starting with `[`, which is the binding for "previous file".
  test('returns null for every real keystroke, so keys still reach the keymap', () => {
    for (const input of ['j', 'k', '[', ']', 'q', '?', '', '\r', ESC, `${ESC}[A`, `${ESC}[<`]) {
      expect(parseMouse(input)).toBeNull();
    }
  });

  test('rejects a report with a zero coordinate rather than reading it as -1', () => {
    expect(parseMouse(`${ESC}[<0;0;5M`)).toBeNull();
    expect(parseMouse(`${ESC}[<0;5;0M`)).toBeNull();
  });
});

describe('the enable and disable sequences', () => {
  // A shell left in reporting mode prints `[<0;12;7M` at the prompt on every
  // click, and nothing tells the user which program did that to their terminal.
  test('disable undoes exactly what enable turned on', () => {
    const modes = (s: string) => [...s.matchAll(/\?(\d+)[hl]/g)].map((m) => m[1]).sort();
    expect(modes(MOUSE_ENABLE)).toEqual(modes(MOUSE_DISABLE));
    expect(MOUSE_ENABLE.endsWith('h')).toBe(true);
    expect(MOUSE_DISABLE.endsWith('l')).toBe(true);
  });

  test('asks for SGR reporting, without which wide terminals cannot be addressed', () => {
    expect(MOUSE_ENABLE).toContain('?1006h');
  });
});

describe('drag', () => {
  // Motion while a button is held. This is the gesture GitHub sweeps a line
  // range with, and it is why reporting moved from 1000 to 1002.
  test('reads motion with the left button down as a drag', () => {
    expect(parseMouse(`${ESC}[<32;10;4M`)).toMatchObject({
      action: 'drag', button: 'left', column: 9, row: 3,
    });
  });

  test('keeps the modifiers on a drag', () => {
    expect(parseMouse(`${ESC}[<36;1;1M`)).toMatchObject({ action: 'drag', shift: true });
  });

  // 64 is the wheel bit and 32 is the motion bit. Reading one as the other
  // would turn every notch of the wheel into a selection sweep.
  test('does not mistake a wheel notch for motion', () => {
    expect(parseMouse(`${ESC}[<64;5;5M`)?.action).toBe('wheel-up');
    expect(parseMouse(`${ESC}[<65;5;5M`)?.action).toBe('wheel-down');
  });

  test('a plain press is still a press', () => {
    expect(parseMouse(`${ESC}[<0;5;5M`)?.action).toBe('press');
  });
});

describe('isDoubleClick', () => {
  test('two presses on one row, close together', () => {
    expect(isDoubleClick({ row: 7, at: 1000 }, { row: 7, at: 1000 + DOUBLE_CLICK_MS })).toBe(true);
  });

  test('too slow is two separate clicks', () => {
    expect(isDoubleClick({ row: 7, at: 1000 }, { row: 7, at: 1001 + DOUBLE_CLICK_MS })).toBe(false);
  });

  test('a different row is two separate clicks, however fast', () => {
    // Otherwise a quick correction of a mis-aimed click opens a composer on a
    // line the reviewer was moving away from.
    expect(isDoubleClick({ row: 7, at: 1000 }, { row: 8, at: 1010 })).toBe(false);
  });

  test('the first click of the session is never a double', () => {
    expect(isDoubleClick(null, { row: 7, at: 1000 })).toBe(false);
  });
});

describe('the reporting mode', () => {
  test('asks for button-event tracking, which is what reports a drag', () => {
    expect(MOUSE_ENABLE).toContain('?1002h');
    // 1003 reports motion with no button held too, and would repaint the whole
    // diff every time the pointer crossed an idle window.
    expect(MOUSE_ENABLE).not.toContain('?1003h');
  });
});
