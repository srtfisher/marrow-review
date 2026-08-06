import { test, expect, describe } from 'bun:test';
import { chromeFilterLabel, chromeLine } from '../../src/tui/chrome.js';

describe('chromeLine', () => {
  test('a wide terminal carries both segments', () => {
    const line = chromeLine({ repoLabel: 'octocat/webapp', filter: 'open', warm: 546, width: 80 });
    expect(line.left).toBe('marrow · octocat/webapp · open');
    expect(line.right).toBe('reviewing #546');
  });

  test('no warm review means no right segment', () => {
    const line = chromeLine({ repoLabel: 'octocat/webapp', filter: 'all', warm: null, width: 80 });
    expect(line.right).toBe('');
  });

  test('the right segment is the first thing dropped when the width runs out', () => {
    const line = chromeLine({ repoLabel: 'octocat/webapp', filter: 'open', warm: 546, width: 32 });
    expect(line.right).toBe('');
    expect(line.left).toBe('marrow · octocat/webapp · open');
  });

  test('the repo label truncates before the app name is touched', () => {
    const line = chromeLine({
      repoLabel: 'some-enormous-org/a-repository-with-a-very-long-name',
      filter: 'open', warm: null, width: 30,
    });
    expect(line.left.startsWith('marrow · ')).toBe(true);
    expect(line.left).toContain('…');
    expect(line.left.length).toBeLessThanOrEqual(30);
  });

  test('the filter is named in its own terms', () => {
    expect(chromeFilterLabel('review-requested')).toBe('needs my review');
    expect(
      chromeLine({ repoLabel: 'o/r', filter: 'review-requested', warm: null, width: 80 }).left,
    ).toBe('marrow · o/r · needs my review');
  });
});
