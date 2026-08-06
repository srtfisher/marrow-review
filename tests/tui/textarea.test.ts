import { test, expect, describe } from 'bun:test';
import {
  backspace, fromText, insert, move, newline, toText,
} from '../../src/tui/textarea.js';

describe('fromText / toText', () => {
  test('round-trips, so nothing is lost passing through the buffer', () => {
    const text = '```suggestion\nconst x = 1;\n```';
    expect(toText(fromText(text))).toBe(text);
  });

  test('starts the caret at the end, where a pre-filled body is edited from', () => {
    const buffer = fromText('one\ntwo');
    expect(buffer.row).toBe(1);
    expect(buffer.col).toBe(3);
  });

  test('empty text is one empty line, not zero lines', () => {
    // Zero lines has no row for the caret to be on, and every function here
    // would then have to special-case a buffer that cannot be typed into.
    expect(fromText('').lines).toEqual(['']);
  });
});

describe('insert', () => {
  test('puts a character under the caret and moves past it', () => {
    const buffer = insert(fromText('ab'), 'c');
    expect(toText(buffer)).toBe('abc');
    expect(buffer.col).toBe(3);
  });

  test('inserts mid-line without disturbing the rest', () => {
    const buffer = insert(move(fromText('ac'), 'left'), 'b');
    expect(toText(buffer)).toBe('abc');
  });

  test('a pasted block arrives as one chunk and keeps its line breaks', () => {
    // A paste is one input event, and a block of code is the likeliest thing
    // to be pasted into a suggestion.
    const buffer = insert(fromText(''), 'const x = 1;\nconst y = 2;');
    expect(toText(buffer)).toBe('const x = 1;\nconst y = 2;');
    expect(buffer.row).toBe(1);
    expect(buffer.col).toBe(12);
  });
});

describe('newline', () => {
  test('splits the line at the caret', () => {
    const buffer = newline(move(fromText('abcd'), 'home'));
    expect(buffer.lines).toEqual(['', 'abcd']);
    expect(buffer.row).toBe(1);
    expect(buffer.col).toBe(0);
  });
});

describe('backspace', () => {
  test('deletes the character before the caret', () => {
    expect(toText(backspace(fromText('abc')))).toBe('ab');
  });

  test('at the start of a line, joins it to the one above', () => {
    const buffer = backspace(move(fromText('ab\ncd'), 'home'));
    expect(buffer.lines).toEqual(['abcd']);
    // The caret lands at the seam, which is where the text was joined.
    expect(buffer.row).toBe(0);
    expect(buffer.col).toBe(2);
  });

  test('at the very start it does nothing rather than throwing', () => {
    const buffer = fromText('abc');
    const home = { ...buffer, row: 0, col: 0 };
    expect(backspace(home)).toEqual(home);
  });
});

describe('move', () => {
  test('left at column zero steps up to the end of the line above', () => {
    const buffer = move(move(fromText('ab\ncd'), 'home'), 'left');
    expect(buffer.row).toBe(0);
    expect(buffer.col).toBe(2);
  });

  test('right at the end of a line steps down to the start of the next', () => {
    const buffer = move({ lines: ['ab', 'cd'], row: 0, col: 2 }, 'right');
    expect(buffer.row).toBe(1);
    expect(buffer.col).toBe(0);
  });

  test('clamps at both ends instead of running off the buffer', () => {
    expect(move({ lines: ['ab'], row: 0, col: 0 }, 'left')).toEqual({
      lines: ['ab'], row: 0, col: 0,
    });
    expect(move({ lines: ['ab'], row: 0, col: 2 }, 'right')).toEqual({
      lines: ['ab'], row: 0, col: 2,
    });
    expect(move({ lines: ['ab'], row: 0, col: 1 }, 'up').row).toBe(0);
    expect(move({ lines: ['ab'], row: 0, col: 1 }, 'down').row).toBe(0);
  });

  test('moving onto a shorter line puts the caret at its end', () => {
    expect(move({ lines: ['abcd', 'ab'], row: 0, col: 4 }, 'down')).toEqual({
      lines: ['abcd', 'ab'], row: 1, col: 2,
    });
  });

  test('home and end go to the ends of the line the caret is on', () => {
    expect(move({ lines: ['abcd'], row: 0, col: 2 }, 'home').col).toBe(0);
    expect(move({ lines: ['abcd'], row: 0, col: 2 }, 'end').col).toBe(4);
  });
});
