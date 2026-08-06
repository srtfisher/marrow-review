import { test, expect, describe } from 'bun:test';
import {
  buildEntries, hitPicker, layoutPicker, nextFilter, pickerScroll, pickerWindow, wrapTitle,
} from '../../src/tui/picker.js';
import type { PullRequestSummary } from '../../src/core/github/types.js';

function summary(number: number, title: string): PullRequestSummary {
  return {
    number, title, author: 'octocat', state: 'open', isDraft: false,
    headSha: 'abc', baseRef: 'main', headRef: 'feat/x',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

describe('wrapTitle', () => {
  test('a title that fits stays on one line', () => {
    expect(wrapTitle('Short title', 40, 2)).toEqual(['Short title']);
  });

  test('breaks at a word boundary, never mid-word', () => {
    expect(wrapTitle('Resolve settings pages from packages', 20, 2))
      .toEqual(['Resolve settings', 'pages from packages']);
  });

  test('a third row truncates the second with an ellipsis', () => {
    const lines = wrapTitle('one two three four five six seven eight nine ten', 12, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(lines[1]!.length).toBeLessThanOrEqual(12);
  });

  test('a single word longer than the width hard-breaks rather than overflowing', () => {
    const lines = wrapTitle('supercalifragilisticexpialidocious', 10, 2);
    expect(lines[0]!.length).toBeLessThanOrEqual(10);
  });
});

describe('buildEntries', () => {
  test('a one-line title makes a 3-row entry; a two-line title makes 4', () => {
    const short = buildEntries([summary(1, 'Tiny')], 80)[0]!;
    expect(short.height).toBe(3);
    const long = buildEntries(
      [summary(2, 'A very long pull request title that cannot possibly fit on one row here')],
      40,
    )[0]!;
    expect(long.titleLines).toHaveLength(2);
    expect(long.height).toBe(4);
  });

  test('the first title line carries the number, and a draft its marker', () => {
    const entries = buildEntries(
      [{ ...summary(7, 'Something'), isDraft: true }], 80,
    );
    expect(entries[0]!.titleLines[0]).toBe('#7 [draft] Something');
  });
});

describe('layoutPicker', () => {
  // Banner block 5 rows (3 wordmark + tagline + blank), filter block 2
  // (input + blank), indicator 1 — so 8 rows of chrome with the banner up.
  test('a tall wide terminal shows the banner', () => {
    const layout = layoutPicker(30, 80);
    expect(layout.banner).toBe(true);
    expect(layout.headerRows).toBe(7);
    expect(layout.entryRows).toBe(30 - 7 - 1);
  });

  test('the banner drops whole when three minimum entries no longer fit beside it', () => {
    // 3 entries × 3 rows = 9; with banner the chrome is 8, so height 16 fails.
    const layout = layoutPicker(16, 80);
    expect(layout.banner).toBe(false);
    expect(layout.headerRows).toBe(2);
  });

  test('a terminal too narrow for the wordmark drops the banner regardless of height', () => {
    expect(layoutPicker(40, 30).banner).toBe(false);
  });
});

describe('pickerScroll and pickerWindow', () => {
  const heights = [3, 4, 3, 4, 3, 3];

  test('the window fills greedily and stops before overflowing', () => {
    expect(pickerWindow(heights, 10, 0)).toEqual({ start: 0, end: 3 });
  });

  test('at least one entry shows even when taller than the viewport', () => {
    expect(pickerWindow([5], 3, 0)).toEqual({ start: 0, end: 1 });
  });

  test('moving the cursor above the window pulls the window up', () => {
    expect(pickerScroll(heights, 10, 1, 3)).toBe(1);
  });

  test('moving the cursor below the window scrolls just far enough to show it whole', () => {
    // Cursor on entry 3 (4 rows): entries 1..3 sum to 11 > 10, 2..3 sum to 7.
    expect(pickerScroll(heights, 10, 3, 0)).toBe(2);
  });
});

describe('hitPicker', () => {
  const geometry = { headerRows: 7, heights: [3, 4, 3], scrollTop: 0, viewRows: 12 };

  test('a click on a title or meta row resolves to that entry', () => {
    expect(hitPicker(geometry, 7)).toBe(0);  // entry 0 title
    expect(hitPicker(geometry, 8)).toBe(0);  // entry 0 meta
    expect(hitPicker(geometry, 10)).toBe(1); // entry 1 first title row
  });

  test('a click on the blank separator resolves to no entry', () => {
    expect(hitPicker(geometry, 9)).toBe(null);  // entry 0 trailing blank
  });

  test('a click in the header or past the last entry is not a hit', () => {
    expect(hitPicker(geometry, 3)).toBe(null);
    expect(hitPicker(geometry, 18)).toBe(null);
  });

  test('a click respects the scroll offset', () => {
    expect(hitPicker({ ...geometry, scrollTop: 1 }, 7)).toBe(1);
  });
});

describe('nextFilter', () => {
  test('cycles open → review-requested → all → open', () => {
    expect(nextFilter('open')).toBe('review-requested');
    expect(nextFilter('review-requested')).toBe('all');
    expect(nextFilter('all')).toBe('open');
  });
});
