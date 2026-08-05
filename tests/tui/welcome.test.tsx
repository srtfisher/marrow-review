import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { Welcome, WORDMARK, starterHints, waitingLabel } from '../../src/tui/components/Welcome.js';

const REPO = 'octocat/webapp';

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

describe('waitingLabel', () => {
  test('counts in the current filter’s own terms', () => {
    expect(waitingLabel(9, 'open')).toBe('9 open');
    expect(waitingLabel(3, 'review-requested')).toBe('3 awaiting your review');
    expect(waitingLabel(9, 'all')).toBe('9 pull requests');
    expect(waitingLabel(1, 'all')).toBe('1 pull request');
  });

  // `0 open` beside a hint about pressing enter to review offers work that is
  // not there; the empty state has to say so in words.
  test('says nothing is waiting rather than printing a zero', () => {
    expect(waitingLabel(0, 'open')).toBe('no open pull requests');
    expect(waitingLabel(0, 'review-requested')).toBe('nothing awaiting your review');
    expect(waitingLabel(0, 'all')).toBe('no pull requests');
  });
});

describe('Welcome', () => {
  test('names the tool, the repository, and how much is waiting', () => {
    const out = renderToString(
      <Welcome repoLabel={REPO} count={9} filter="open" height={24} width={60} />,
    );
    // The wordmark is drawn at this size, so the name is in blocks rather than
    // letters — the row that closes the `w` is the one that only marrow has.
    expect(out).toContain('█   █ █  █ █ ▀▄ █ ▀▄ ▀▄▄▀ █▀ ▀█');
    expect(out).toContain(REPO);
    expect(out).toContain('9 open');
  });

  test('falls back to the typed wordmark where the drawn one will not fit', () => {
    // Both dimensions have to be checked: the art is 31 columns and three rows,
    // and a pane short of either would otherwise have Ink overdraw the border.
    const narrow = renderToString(
      <Welcome repoLabel={REPO} count={9} filter="open" height={24} width={28} />,
      { columns: 28 },
    );
    expect(narrow).toContain('marrow');
    expect(narrow).not.toContain('█▄ ▄█');

    const short = renderToString(
      <Welcome repoLabel={REPO} count={9} filter="open" height={9} width={60} />,
    );
    expect(short).toContain('marrow');
    expect(short).not.toContain('█▄ ▄█');
  });

  test('shows the handful of keys that start the work, not the keymap', () => {
    const out = renderToString(
      <Welcome repoLabel={REPO} count={9} filter="open" height={24} width={60} />,
    );
    for (const fragment of ['move', 'search', 'review', 'all keys', 'filter', 'quit']) {
      expect(out).toContain(fragment);
    }
    // `?` owns the rest, so the detail-mode bindings stay off this screen.
    expect(out).not.toContain('half page');
    expect(out).not.toContain('suggestion');
  });

  test('with nothing in the list, drops the keys that act on a pull request', () => {
    const out = renderToString(
      <Welcome repoLabel={REPO} count={0} filter="open" height={24} width={60} />,
    );
    expect(out).toContain('no open pull requests');
    expect(out).toContain('refresh');
    expect(out).not.toContain('review');
    expect(out).not.toContain('search');
    expect(starterHints(0).flat().map((h) => h.keys)).toEqual(['1 2 3', '?', 'R', 'q']);
  });

  test('is centred in the pane, not pinned to the top', () => {
    const lines = renderToString(
      <Welcome repoLabel={REPO} count={9} filter="open" height={24} width={60} />,
    ).split('\n');
    const first = lines.findIndex((l) => l.trim().length > 0);
    const last = lines.length - 1 - [...lines].reverse().findIndex((l) => l.trim().length > 0);

    expect(first).toBeGreaterThan(0);
    expect(lines.length - 1 - last).toBeGreaterThan(0);
    // Roughly balanced: neither margin more than a row off the other.
    expect(Math.abs(first - (lines.length - 1 - last))).toBeLessThanOrEqual(1);
  });

  // Ink draws an overflowing column on top of itself rather than clipping it,
  // which turned a short terminal into garbled, overlapping rows.
  test('sheds the tagline, then the hints, rather than overdrawing', () => {
    const short = renderToString(
      <Welcome repoLabel={REPO} count={9} filter="open" height={8} width={60} />,
    );
    expect(short).toContain('marrow');
    expect(short).toContain('9 open');
    expect(short).toContain('review');
    expect(short).not.toContain('carries meaning');

    const tiny = renderToString(
      <Welcome repoLabel={REPO} count={9} filter="open" height={2} width={60} />,
    );
    expect(tiny).toContain('marrow');
    expect(tiny).toContain('9 open');
    // Every row still whole: no cell holds two characters' worth of content.
    for (const line of tiny.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
      expect(line).not.toMatch(/[│╰╭].*[╭╰]/);
    }
  });

  // The right pane is roughly 45 columns on an 80-column terminal, and a
  // wrapped tagline pushed the bottom border out of the row budget.
  test('drops the tagline rather than wrapping it in a narrow pane', () => {
    const out = renderToString(
      <Welcome repoLabel={REPO} count={9} filter="open" height={24} width={40} />,
    );
    expect(out).not.toContain('carries meaning');
    expect(out).toContain('marrow');
    expect(out).toContain('9 open');
    for (const line of out.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
      expect(line.replace(/\s+$/, '').length).toBeLessThanOrEqual(40);
    }
  });

  test('the panel is bordered but the pane is not boxed in', () => {
    const out = renderToString(
      <Welcome repoLabel={REPO} count={9} filter="open" height={24} width={60} />,
    );
    expect(out).toContain('╭'); // ╭ — the sanctioned rounded panel
    expect(out).not.toContain('┌'); // ┌ — square boxes stay rejected
  });

  test('uses no emoji and no hex colours', () => {
    const out = renderToString(
      <Welcome repoLabel={REPO} count={9} filter="open" height={24} width={60} />,
    );
    expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
    // Truecolor escapes would mean a hardcoded palette fighting the user's theme.
    expect(out).not.toMatch(/\x1b\[[34]8;2;/);
  });

  test('renders without a React key warning', () => {
    const warnings: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    try {
      renderToString(<Welcome repoLabel={REPO} count={9} filter="open" height={24} width={60} />);
    } finally {
      console.error = realError;
    }
    expect(warnings).toEqual([]);
  });
});
