import { test, expect, describe } from 'bun:test';
import { filterPrs, matchesQuery } from '../../src/tui/search.js';
import type { PullRequestSummary } from '../../src/core/github/types.js';

function pr(number: number, title: string, author: string): PullRequestSummary {
  return {
    number, title, author, state: 'open', isDraft: false,
    headSha: 'abc', baseRef: 'main', headRef: 'x',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

const prs = [
  pr(142, 'Fix thematic-break rendering', 'hazadus'),
  pr(143, 'Add mermaid diagrams', 'darvell'),
  pr(144, 'Bump dependencies', 'dependabot[bot]'),
];

describe('matchesQuery', () => {
  test('an empty query matches everything', () => {
    expect(matchesQuery(prs[0]!, '')).toBe(true);
    expect(matchesQuery(prs[0]!, '   ')).toBe(true);
  });

  test('matches the title case-insensitively', () => {
    expect(matchesQuery(prs[0]!, 'THEMATIC')).toBe(true);
    expect(matchesQuery(prs[0]!, 'mermaid')).toBe(false);
  });

  test('matches the author', () => {
    expect(matchesQuery(prs[1]!, 'darvell')).toBe(true);
  });

  test('matches the number with or without a leading hash', () => {
    expect(matchesQuery(prs[0]!, '142')).toBe(true);
    expect(matchesQuery(prs[0]!, '#142')).toBe(true);
    expect(matchesQuery(prs[0]!, '143')).toBe(false);
  });
});

describe('filterPrs', () => {
  test('returns every PR for an empty query', () => {
    expect(filterPrs(prs, '')).toHaveLength(3);
  });

  test('narrows to matches and preserves input order', () => {
    const found = filterPrs(prs, 'a');
    expect(found.map((p) => p.number)).toEqual(
      prs.filter((p) => matchesQuery(p, 'a')).map((p) => p.number),
    );
  });

  test('returns nothing when a query matches nothing', () => {
    expect(filterPrs(prs, 'zzzz')).toEqual([]);
  });
});
