import { test, expect, describe } from 'bun:test';
import { MOUSE_DISABLE, MOUSE_ENABLE, parseMouse } from '../../src/tui/mouse.js';

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
