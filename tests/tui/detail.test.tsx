import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { Detail } from '../../src/tui/components/Detail.js';
import { StatusBar } from '../../src/tui/components/StatusBar.js';
import { buildUnits } from '../../src/tui/units.js';
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

describe('Detail', () => {
  test('shows the title, number, author, and branches', () => {
    const out = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={30}
        checks={[]} threads={[]} showThreads={false} />,
    );
    expect(out).toContain('Fix rendering');
    expect(out).toContain('#42');
    expect(out).toContain('hazadus');
    expect(out).toContain('main');
    expect(out).toContain('fix/render');
  });

  test('shows the meat summary and the kept counter', () => {
    const out = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={30}
        checks={[]} threads={[]} showThreads={false} />,
    );
    expect(out).toContain('Adds a constant.');
    expect(out).toContain('kept 1/2');
  });

  test('surfaces a failing check', () => {
    const out = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={30}
        checks={[{ name: 'unit-tests', status: 'completed', conclusion: 'failure', detailsUrl: null, output: null }]}
        threads={[]} showThreads={false} />,
    );
    expect(out).toContain('unit-tests');
  });

  test('hides threads until asked, then shows them', () => {
    const threads = [{
      path: 'src/app.ts', line: 1, isResolved: false, isOutdated: false,
      comments: [{ author: 'tqbf', body: 'Is this safe?', createdAt: 'now' }],
    }];
    const hidden = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={30}
        checks={[]} threads={threads} showThreads={false} />,
    );
    expect(hidden).not.toContain('Is this safe?');

    const shown = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={30}
        checks={[]} threads={threads} showThreads />,
    );
    expect(shown).toContain('Is this safe?');
  });
});

describe('StatusBar', () => {
  test('shows repo, PR, counter, staged count, and model', () => {
    const out = renderToString(
      <StatusBar repoLabel="srtfisher/marrow" prNumber={42} meat={meat}
        stagedCount={3} model="opus" worktreeOk />,
    );
    expect(out).toContain('srtfisher/marrow');
    expect(out).toContain('#42');
    expect(out).toContain('kept 1/2');
    expect(out).toContain('3');
    expect(out).toContain('opus');
  });

  test('flags a missing worktree so degraded mode is visible', () => {
    const out = renderToString(
      <StatusBar repoLabel="r" prNumber={1} meat={meat} stagedCount={0} model="opus" worktreeOk={false} />,
    );
    expect(out.toLowerCase()).toContain('diff-only');
  });
});
