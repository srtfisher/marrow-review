/**
 * A multi-line text buffer, as plain data.
 *
 * The comment composer needs a real textarea: a GitHub suggestion is a fenced
 * block with a line of code per line replaced, and none of that fits in the
 * single-line input this app used to compose with. Editing logic lives here,
 * away from Ink, so it can be tested exhaustively without a terminal — the
 * component that uses it is then a renderer plus a key dispatch table.
 *
 * Every function is total and returns a new buffer. Nothing throws: a caret at
 * the very start that backspaces, or an arrow key at either end, is something
 * the reviewer will do constantly and none of it is an error.
 */
export interface Buffer {
  /** Always at least one line, so the caret always has a row to sit on. */
  lines: string[];
  row: number;
  col: number;
}

export type Direction = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

/** The caret lands at the end, which is where pre-filled text gets edited. */
export function fromText(text: string): Buffer {
  const lines = text.split('\n');
  const row = lines.length - 1;
  return { lines, row, col: lines[row]!.length };
}

export function toText(buffer: Buffer): string {
  return buffer.lines.join('\n');
}

/** The caret's line, and the text either side of the caret. */
function split(buffer: Buffer): { before: string; after: string } {
  const line = buffer.lines[buffer.row] ?? '';
  return { before: line.slice(0, buffer.col), after: line.slice(buffer.col) };
}

function replace(buffer: Buffer, at: number, count: number, lines: string[]): string[] {
  const next = [...buffer.lines];
  next.splice(at, count, ...lines);
  return next;
}

/**
 * Text under the caret. Takes a chunk rather than a character because a paste
 * arrives as one input event, and a block of code is the likeliest thing anyone
 * pastes into a suggestion.
 */
export function insert(buffer: Buffer, chunk: string): Buffer {
  const { before, after } = split(buffer);
  const parts = chunk.split('\n');
  const last = parts.length - 1;

  parts[0] = before + parts[0];
  parts[last] = parts[last] + after;

  return {
    lines: replace(buffer, buffer.row, 1, parts),
    row: buffer.row + last,
    col: parts[last]!.length - after.length,
  };
}

export function newline(buffer: Buffer): Buffer {
  const { before, after } = split(buffer);
  return {
    lines: replace(buffer, buffer.row, 1, [before, after]),
    row: buffer.row + 1,
    col: 0,
  };
}

export function backspace(buffer: Buffer): Buffer {
  const { before, after } = split(buffer);

  if (before.length > 0) {
    return {
      lines: replace(buffer, buffer.row, 1, [before.slice(0, -1) + after]),
      row: buffer.row,
      col: buffer.col - 1,
    };
  }

  // Start of the buffer: nothing to delete, and nothing to complain about.
  if (buffer.row === 0) return buffer;

  const above = buffer.lines[buffer.row - 1]!;
  return {
    lines: replace(buffer, buffer.row - 1, 2, [above + after]),
    row: buffer.row - 1,
    // The seam, which is where the reviewer's eye already is.
    col: above.length,
  };
}

export function move(buffer: Buffer, dir: Direction): Buffer {
  const { lines, row, col } = buffer;
  const line = lines[row] ?? '';

  switch (dir) {
    case 'home':
      return { ...buffer, col: 0 };

    case 'end':
      return { ...buffer, col: line.length };

    case 'left':
      if (col > 0) return { ...buffer, col: col - 1 };
      // Wrapping to the line above is what makes left feel like one text rather
      // than a stack of independent lines.
      if (row === 0) return buffer;
      return { ...buffer, row: row - 1, col: lines[row - 1]!.length };

    case 'right':
      if (col < line.length) return { ...buffer, col: col + 1 };
      if (row === lines.length - 1) return buffer;
      return { ...buffer, row: row + 1, col: 0 };

    case 'up':
    case 'down': {
      const next = dir === 'up' ? row - 1 : row + 1;
      if (next < 0 || next >= lines.length) return buffer;
      // Onto a shorter line, the caret sits at its end rather than off it.
      return { ...buffer, row: next, col: clamp(col, lines[next]!.length) };
    }
  }
}
