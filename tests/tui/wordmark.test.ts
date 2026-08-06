import { test, expect, describe } from 'bun:test';
import { WORDMARK } from '../../src/tui/wordmark.js';

/**
 * Unpack the wordmark's half-blocks into the pixel rows they stand for: `▀` is
 * the top half of the cell, `▄` the bottom, `█` both. Three text rows describe
 * a bitmap six pixels tall, and the letters are only right if that bitmap is.
 */
function pixels(rows: readonly string[]): string[] {
  const width = Math.max(...rows.map((r) => [...r].length));
  const top = { '█': '#', '▀': '#', '▄': '.', ' ': '.' } as const;
  const bottom = { '█': '#', '▀': '.', '▄': '#', ' ': '.' } as const;
  return rows.flatMap((row) => {
    const cells = [...row.padEnd(width, ' ')] as (keyof typeof top)[];
    return [cells.map((c) => top[c]).join(''), cells.map((c) => bottom[c]).join('')];
  });
}

describe('WORDMARK', () => {
  // The R was drawn with no leg, which is a P, and the banner read MAPPOW for
  // real. Asserting the bitmap is the only check that can see that.
  test('spells marrow', () => {
    expect(pixels(WORDMARK)).toEqual([
      '#...#..##..###..###...##..#...#',
      '##.##.#..#.#..#.#..#.#..#.#...#',
      '#.#.#.#..#.#..#.#..#.#..#.#...#',
      '#...#.####.###..###..#..#.#.#.#',
      '#...#.#..#.#.#..#.#..#..#.##.##',
      '#...#.#..#.#..#.#..#..##..#...#',
    ]);
  });

  test('the two R glyphs carry a leg below the bowl', () => {
    const px = pixels(WORDMARK);
    // Columns 11-14 and 16-19 are the R's; the bowl closes on pixel row 3, so
    // rows 4 and 5 must still have ink to the right of the stem.
    for (const start of [11, 16]) {
      const leg = px.slice(4).map((row) => row.slice(start + 1, start + 4));
      expect(leg.some((row) => row.includes('#'))).toBe(true);
    }
  });

  test('is three rows and a uniform width, so the panel can budget for it', () => {
    expect(WORDMARK).toHaveLength(3);
    expect(new Set(WORDMARK.map((r) => [...r].length)).size).toBe(1);
  });
});
