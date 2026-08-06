import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { Detail } from '../../src/tui/components/Detail.js';
import { buildUnits } from '../../src/tui/units.js';
import { buildRows, withComposer } from '../../src/tui/rows.js';
import type { ReviewThread } from '../../src/core/github/types.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import type { StagedComment } from '../../src/core/review/types.js';
import type { PullRequestDetail } from '../../src/core/github/types.js';

const pr: PullRequestDetail = {
  number: 42, title: 'Fix rendering', author: 'hubot', state: 'open', isDraft: false,
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
  keptAdditions: 1, keptDeletions: 0, totalAdditions: 2, totalDeletions: 0,
  unclassified: 0,
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
    expect(out).toContain('hubot');
    expect(out).toContain('main');
    expect(out).toContain('fix/render');
  });

  test('shows the meat summary and the kept counter', () => {
    const out = render();
    expect(out).toContain('Adds a constant.');
    expect(out).toContain('kept 1/2');
  });

  test('states the size of the view you are in, and changes it when d toggles', () => {
    const sized: MeatResult = {
      ...meat,
      keptLines: 4, keptAdditions: 3, keptDeletions: 1,
      totalLines: 14, totalAdditions: 9, totalDeletions: 5,
    };

    // The point of showing these at all: on a diff nothing was cut from, the
    // label was the only thing `d` changed, which reads as a broken key.
    expect(render({ meat: sized })).toContain('+3 −1');
    expect(render({ meat: sized, fullDiff: true })).toContain('+9 −5');
  });

  // Three of these used to render identically — a pass that returned nothing
  // looked exactly like a pass that never ran, which is how a reviewer decides
  // the model is broken on a pull request that simply has no bugs.
  test('tells the four findings states apart', () => {
    expect(render({ findingsStatus: 'running' })).toContain('findings…');
    expect(render({ findingsStatus: 'ok', findingCount: 3 })).toContain('3 findings');
    expect(render({ findingsStatus: 'ok', findingCount: 1 })).toContain('1 finding');
    expect(render({ findingsStatus: 'ok', findingCount: 0 })).toContain('no findings');
    expect(render({ findingsStatus: 'idle' })).not.toContain('finding');
  });

  // The red banner above the pane already says this one, and saying it twice
  // reads as two different problems.
  test('says nothing about findings when the pass failed', () => {
    expect(render({ findingsStatus: 'failed' })).not.toContain('findings');
  });

  test('draws a staged comment under the line it is about', () => {
    const staged: StagedComment = {
      id: 'c1', path: 'src/app.ts', line: 1, side: 'RIGHT', startLine: null,
      body: 'this rotates the JWT on every keystroke', suggestion: null,
    };
    const out = render({ rows: buildRows(units, [], false, { staged: [staged], commentWidth: 60 }) });

    expect(out).toContain('R1');
    expect(out).toContain('this rotates the JWT on every keystroke');
  });

  test('draws the composer as a box wedged into the diff', () => {
    const rows = buildRows(units, [], false);
    const at = rows.findIndex((r) => r.kind === 'diff-line');
    const out = render({
      rows: withComposer(rows, at, {
        title: 'Comment on lines R40 to R41',
        lines: ['```suggestion', 'const x = 1;', '```'],
        row: 1, col: 12, footer: '^d save · ^o editor · esc cancel', width: 60,
      }),
    });

    // GitHub's own wording, so the anchor is never in doubt.
    expect(out).toContain('Comment on lines R40 to R41');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('^d save');
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
      comments: [{ author: 'hubot', body: 'Is this safe?', createdAt: 'now' }],
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

  test('says so when the classifier left hunks unjudged', () => {
    // A gauge reading 1038/1040 looks like a judgment and can be a shortfall.
    // The reviewer has to be able to tell those apart at a glance.
    expect(render()).not.toContain('unclassified');
    expect(render({ meat: { ...meat, unclassified: 12 } })).toContain('12 hunks unclassified');
    expect(render({ meat: { ...meat, unclassified: 1 } })).toContain('1 hunk unclassified');
  });

  test('lists every file, checked off or not', () => {
    const out = render();
    expect(out).toContain('src/app.ts');
    expect(out).not.toContain('✓');
    expect(render({ reviewed: new Set(['src/app.ts']) })).toContain('✓');
  });
});
