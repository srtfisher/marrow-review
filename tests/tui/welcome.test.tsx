import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { Welcome, starterHints, waitingLabel } from '../../src/tui/components/Welcome.js';

const REPO = 'srtfisher/chicago-com';

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
    expect(out).toContain('marrow');
    expect(out).toContain(REPO);
    expect(out).toContain('9 open');
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
