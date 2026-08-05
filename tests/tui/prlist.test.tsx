import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { PrList, filterLabel, visibleEntryCount } from '../../src/tui/components/PrList.js';
import type { PullRequestSummary } from '../../src/core/github/types.js';

function pr(number: number, title: string, over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number, title, author: 'octocat', state: 'open', isDraft: false,
    headSha: 'abc', baseRef: 'main', headRef: 'feat/x',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

describe('filterLabel', () => {
  test('names each filter', () => {
    expect(filterLabel('open')).toBe('Open');
    expect(filterLabel('review-requested')).toBe('Needs my review');
    expect(filterLabel('all')).toBe('All');
  });
});

describe('visibleEntryCount', () => {
  // Three rows an entry, and four rows of chrome while searching: the filter
  // line, the query line, the blank row under them, and the position indicator.
  // App scrolls the pane with this number, so it has to match what renders.
  test('budgets three rows an entry and the pane chrome', () => {
    expect(visibleEntryCount(12, false)).toBe(3);
    expect(visibleEntryCount(12, true)).toBe(2);
    expect(visibleEntryCount(3, false)).toBe(0);
    expect(visibleEntryCount(0, false)).toBe(0);
    expect(visibleEntryCount(-5, false)).toBe(0);
  });
});

describe('PrList', () => {
  const prs = [pr(42, 'Fix rendering'), pr(43, 'Add caching')];

  test('renders numbers, titles, and authors', () => {
    const out = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={10} filter="open" width={40}
        query="" searching={false} />,
    );
    expect(out).toContain('#42');
    expect(out).toContain('Fix rendering');
    expect(out).toContain('octocat');
  });

  // The bug this replaced: `pulls.list` sends no file count, so every row read
  // `octocat · 0 files`. Nothing in the list may claim a size.
  test('shows when a pull request was last touched, never a file count', () => {
    const out = renderToString(
      <PrList prs={[pr(42, 'Fix rendering', { updatedAt: new Date().toISOString() })]}
        cursor={0} scrollTop={0} height={10} filter="open" width={40}
        query="" searching={false} />,
    );
    expect(out).toContain('just now');
    expect(out).not.toContain('files');
    expect(out).not.toContain('0 file');
  });

  test('shows the active filter and the count', () => {
    const out = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={10} filter="all" width={40}
        query="" searching={false} />,
    );
    expect(out).toContain('All');
    expect(out).toContain('2');
  });

  test('marks a draft pull request', () => {
    const out = renderToString(
      <PrList prs={[pr(44, 'WIP', { isDraft: true })]} cursor={0} scrollTop={0} height={10} filter="open" width={40}
        query="" searching={false} />,
    );
    expect(out.toLowerCase()).toContain('draft');
  });

  test('renders an explicit empty state rather than a blank pane', () => {
    const out = renderToString(
      <PrList prs={[]} cursor={0} scrollTop={0} height={10} filter="open" width={40}
        query="" searching={false} />,
    );
    expect(out.toLowerCase()).toContain('no pull requests');
  });

  test('shows the query and the narrowed count while searching', () => {
    const out = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={10} filter="open" width={40}
        query="caching" searching />,
    );
    expect(out).toContain('caching');
    expect(out).toContain('Add caching');
    expect(out).not.toContain('Fix rendering');
  });

  test('marks the selected entry with a marker, never with reverse video', () => {
    const out = renderToString(
      <PrList prs={prs} cursor={1} scrollTop={0} height={20} filter="open" width={40}
        query="" searching={false} />,
    );
    expect(out).toContain('❯ ');
    // ANSI 7 is reverse video. A full-width inverse bar is the heaviest thing
    // that can be on a terminal screen, and it fought everything around it.
    expect(out).not.toContain('[7m');
  });

  test('unselected rows are indented the same, so text does not shift sideways', () => {
    const rows = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={20} filter="open" width={40}
        query="" searching={false} />,
    )
      // eslint-disable-next-line no-control-regex
      .replace(/\[[0-9;]*m/g, '')
      .split('\n');
    const selected = rows.find((r) => r.includes('#42'))!;
    const unselected = rows.find((r) => r.includes('#43'))!;
    expect(selected.indexOf('#42')).toBe(unselected.indexOf('#43'));
  });

  test('separates entries with a blank row', () => {
    const rows = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={20} filter="open" width={40}
        query="" searching={false} />,
    )
      // eslint-disable-next-line no-control-regex
      .replace(/\[[0-9;]*m/g, '')
      .split('\n');
    const first = rows.findIndex((r) => r.includes('#42'));
    const second = rows.findIndex((r) => r.includes('#43'));
    // title, metadata, blank, then the next title.
    expect(second - first).toBe(3);
    expect(rows[first + 2]!.trim()).toBe('');
  });

  test('leaves a blank row under the header before the first entry', () => {
    const rows = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={20} filter="open" width={40}
        query="" searching={false} />,
    )
      // eslint-disable-next-line no-control-regex
      .replace(/\[[0-9;]*m/g, '')
      .split('\n');
    const header = rows.findIndex((r) => r.includes('Open'));
    expect(rows[header + 1]!.trim()).toBe('');
    expect(rows[header + 2]).toContain('#42');
  });

  test('pads the pane, so nothing sits flush against the terminal edge', () => {
    const rows = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={20} filter="open" width={40}
        query="" searching={false} />,
    )
      // eslint-disable-next-line no-control-regex
      .replace(/\[[0-9;]*m/g, '')
      .split('\n')
      .filter((r) => r.trim().length > 0);
    expect(rows.every((r) => r.startsWith(' '))).toBe(true);
  });

  test('shows where you are once the list is longer than the pane', () => {
    const many = Array.from({ length: 9 }, (_, i) => pr(40 + i, `Change ${i}`));
    const out = renderToString(
      <PrList prs={many} cursor={0} scrollTop={0} height={12} filter="open" width={40}
        query="" searching={false} />,
    );
    expect(out).toContain('of 9');
    expect(out).toMatch(/1–\d of 9/);
  });

  test('no position indicator when the whole list is on screen', () => {
    const out = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={40} filter="open" width={40}
        query="" searching={false} />,
    );
    expect(out).not.toContain('of 2');
  });

  test('says so when a search matches nothing, rather than looking broken', () => {
    const out = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={10} filter="open" width={40}
        query="zzzz" searching />,
    );
    expect(out.toLowerCase()).toContain('no match');
  });
});
