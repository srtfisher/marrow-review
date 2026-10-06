import { describe, expect, test } from 'bun:test';
import { pullKey, REVIEWED_GRACE_MS, withoutReviewed } from '../../src/web/lib/reviewed.js';

const pulls = [
  { number: 1, owner: 'o', repo: 'r' },
  { number: 2, owner: 'o', repo: 'r' },
  { number: 1, owner: 'o', repo: 'other' },
];
const where = (p: { owner: string; repo: string }) => p;

describe('withoutReviewed', () => {
  test('hides a pull request reviewed moments ago', () => {
    const reviewed = new Map([[pullKey('o', 'r', 1), 1000]]);
    expect(withoutReviewed(pulls, where, reviewed, 2000).map((p) => `${p.repo}#${p.number}`)).toEqual(['r#2', 'other#1']);
  });

  test('shows it again once the grace period has passed, so a re-requested review is not lost', () => {
    const reviewed = new Map([[pullKey('o', 'r', 1), 1000]]);
    expect(withoutReviewed(pulls, where, reviewed, 1000 + REVIEWED_GRACE_MS)).toHaveLength(3);
  });

  test('matches on the repository, not the number alone', () => {
    const reviewed = new Map([[pullKey('o', 'elsewhere', 1), 1000]]);
    expect(withoutReviewed(pulls, where, reviewed, 2000)).toHaveLength(3);
  });
});
