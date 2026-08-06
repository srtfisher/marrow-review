import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { PrPicker } from '../../src/tui/components/PrPicker.js';
import { loadSteps } from '../../src/tui/progress.js';
import type { PullRequestSummary } from '../../src/core/github/types.js';

function summary(number: number, title: string, author = 'octocat'): PullRequestSummary {
  return {
    number, title, author, state: 'open', isDraft: false,
    headSha: 'abc', baseRef: 'main', headRef: 'feat/x',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}
const prs = [summary(41, 'Alpha rendering'), summary(42, 'Beta caching', 'hubot')];

function frame(over: Partial<Parameters<typeof PrPicker>[0]> = {}) {
  return renderToString(
    <PrPicker
      prs={prs} total={2} query="" cursor={0} scrollTop={0}
      height={30} width={80} warmPrNumber={null}
      {...over}
    />,
  );
}

describe('PrPicker', () => {
  test('a tall terminal leads with the banner and the filter line', () => {
    const out = frame();
    expect(out).toContain('█▄ ▄█');
    expect(out).toContain('filter ›');
  });

  test('full titles are readable — the selected entry wears the marker and its number', () => {
    const out = frame();
    expect(out).toContain('❯ #41 Alpha rendering');
    expect(out).toContain('#42 Beta caching');
  });

  test('a narrowing query shows N of M', () => {
    const out = frame({ prs: [prs[0]!], query: 'alpha' });
    expect(out).toContain('1 of 2');
  });

  test('the warm entry says so', () => {
    const out = frame({ warmPrNumber: 42 });
    expect(out).toContain('● reviewing');
  });

  test('an empty repository and an empty match read differently', () => {
    expect(frame({ prs: [], total: 0 })).toContain('No pull requests.');
    expect(frame({ prs: [], total: 2, query: 'zzz' }))
      .toContain('No match for "zzz".');
  });

  test('opening a pull request replaces the entries with the loading steps', () => {
    const out = frame({
      progress: { prNumber: 41, steps: loadSteps() }, now: 0,
    } as never);
    expect(out).toContain('Loading #41');
    expect(out).not.toContain('❯ #41');
  });
});
