/**
 * The wordmark, drawn.
 *
 * Half-block glyphs rather than `#` or `*` ASCII: they are the same characters
 * the meat gauge is built from, they are single-cell in every terminal that can
 * run this, and they inherit the foreground colour instead of imposing one.
 * Three rows is the whole budget — a six-row banner on a screen whose job is to
 * get you into a diff is a splash screen, and splash screens are a tax.
 *
 * Each row packs two pixel rows (`▀` top, `▄` bottom, `█` both), so the three
 * rows are a 6×31 bitmap and the letters have to be legible *as pixels* — an
 * earlier pass drew the R with no leg, which is a P, and the wordmark read
 * MAPPOW. The grid each glyph encodes, five columns for M and W and four for
 * the rest:
 *
 *     #...#  .##.  ###.  .##.  #...#
 *     ##.##  #..#  #..#  #..#  #...#
 *     #.#.#  #..#  #..#  #..#  #...#
 *     #...#  ####  ###.  #..#  #.#.#
 *     #...#  #..#  #.#.  #..#  ##.##
 *     #...#  #..#  #..#  .##.  #...#
 *       M      A     R     O      W
 */
export const WORDMARK: readonly string[] = [
  '█▄ ▄█ ▄▀▀▄ █▀▀▄ █▀▀▄ ▄▀▀▄ █   █',
  '█ ▀ █ █▄▄█ █▄▄▀ █▄▄▀ █  █ █ ▄ █',
  '█   █ █  █ █ ▀▄ █ ▀▄ ▀▄▄▀ █▀ ▀█',
];

export const WORDMARK_COLS: number = Math.max(...WORDMARK.map((row) => row.length));

/** The product in one line, when there is room for it. */
export const TAGLINE = 'a large diff, abridged to what carries meaning';
