import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { Detail } from '../../src/tui/components/Detail.js';
import { buildUnits } from '../../src/tui/units.js';
import { buildRows } from '../../src/tui/rows.js';
import type { ReviewThread } from '../../src/core/github/types.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import type { PullRequestDetail } from '../../src/core/github/types.js';

const pr: PullRequestDetail = {
  number: 42, title: 'Fix rendering', author: 'hazadus', state: 'open', isDraft: false,
  headSha: 'abc', baseRef: 'main', headRef: 'fix/render',
  updatedAt: '2026-08-01T00:00:00Z', additions: 106, deletions: 0, changedFiles: 3,
  body: 'Body text.', diff: '', viewerIsAuthor: false,
};

const meatFile: MeatFile = {
  file: {
    path: 'src/app.ts', oldPath: null, status: 'modified', similarity: null,
    hunks: [], additions: 1, deletions: 0,
  },
  dropped: null,
  hunks: [{
    hunk: {
      header: '@@ -1,1 +1,2 @@', section: '', oldStart: 1, oldLines: 1, newStart: 1, newLines: 2,
      lines: [{ kind: 'add', text: 'const x = 1;', oldLine: null, newLine: 1, noNewlineAtEof: false }],
    },
    keep: true, reason: 'introduces a new constant', source: 'model',
  }],
};

const meat: MeatResult = {
  summary: 'Adds a constant.', files: [meatFile],
  keptLines: 1, totalLines: 2, keptFiles: 1, totalFiles: 2,
};

const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });

function render(
  overrides: Partial<Parameters<typeof Detail>[0]> = {},
  threads: ReviewThread[] = [],
  showThreads = false,
) {
  return renderToString(
    <Detail
      pr={pr} meat={meat} rows={buildRows(units, threads, showThreads)}
      cursor={0} scrollTop={0} height={30} width={100} checks={[]}
      fullDiff={false} reviewed={new Set()} model="opus" worktreeOk
      {...overrides}
    />,
  );
}

describe('Detail', () => {
  test('shows the title, number, author, and branches', () => {
    const out = render();
    expect(out).toContain('Fix rendering');
    expect(out).toContain('#42');
    expect(out).toContain('hazadus');
    expect(out).toContain('main');
    expect(out).toContain('fix/render');
  });

  test('shows the meat summary and the kept counter', () => {
    const out = render();
    expect(out).toContain('Adds a constant.');
    expect(out).toContain('kept 1/2');
  });

  test('surfaces a failing check', () => {
    const out = render({
      checks: [{
        name: 'unit-tests', status: 'completed', conclusion: 'failure',
        detailsUrl: null, output: null,
      }],
    });
    expect(out).toContain('unit-tests');
  });

  test('hides threads until asked, then shows them', () => {
    const threads: ReviewThread[] = [{
      path: 'src/app.ts', line: 1, isResolved: false, isOutdated: false,
      comments: [{ author: 'tqbf', body: 'Is this safe?', createdAt: 'now' }],
    }];
    expect(render({}, threads, false)).not.toContain('Is this safe?');
    expect(render({}, threads, true)).toContain('Is this safe?');
  });

  test('names the view, because `d` on a diff nothing was cut from looks broken', () => {
    // 1038 of 1040 lines kept is a real pull request. Toggling `d` there
    // changes almost no pixels, so the label is the only proof it did anything.
    expect(render({ fullDiff: false })).toContain('meat');
    expect(render({ fullDiff: true })).toContain('full diff');
  });

  test('carries the model and flags a missing worktree', () => {
    expect(render()).toContain('opus');
    expect(render()).not.toContain('diff-only');
    expect(render({ worktreeOk: false })).toContain('diff-only');
  });

  test('lists every file, checked off or not', () => {
    const out = render();
    expect(out).toContain('src/app.ts');
    expect(out).not.toContain('✓');
    expect(render({ reviewed: new Set(['src/app.ts']) })).toContain('✓');
  });
});
