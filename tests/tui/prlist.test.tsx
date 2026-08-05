import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { PrList, filterLabel } from '../../src/tui/components/PrList.js';
import type { PullRequestSummary } from '../../src/core/github/types.js';

function pr(number: number, title: string, over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number, title, author: 'srtfisher', state: 'open', isDraft: false,
    headSha: 'abc', baseRef: 'main', headRef: 'feat/x',
    updatedAt: '2026-08-01T00:00:00Z', additions: 10, deletions: 2, changedFiles: 3,
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

describe('PrList', () => {
  const prs = [pr(42, 'Fix rendering'), pr(43, 'Add caching')];

  test('renders numbers, titles, and authors', () => {
    const out = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={10} filter="open" width={40}
        query="" searching={false} />,
    );
    expect(out).toContain('#42');
    expect(out).toContain('Fix rendering');
    expect(out).toContain('srtfisher');
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

  test('says so when a search matches nothing, rather than looking broken', () => {
    const out = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={10} filter="open" width={40}
        query="zzzz" searching />,
    );
    expect(out.toLowerCase()).toContain('no match');
  });
});
