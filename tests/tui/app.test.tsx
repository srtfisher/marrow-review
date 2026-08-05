import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import {
  App, chatContextForRow, clampCursor, hunkUrl, mergeTriage,
} from '../../src/tui/App.js';
import { Help } from '../../src/tui/components/Help.js';
import { HELP_GROUPS, KEY_HELP } from '../../src/tui/keymap.js';
import { layoutHelp } from '../../src/tui/help.js';
import { buildUnits } from '../../src/tui/units.js';
import { anchorAtRow, buildRows } from '../../src/tui/rows.js';
import { accept, initTriage, toStagedComments } from '../../src/core/findings/triage.js';
import type { VerifiedFinding } from '../../src/core/findings/verify.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import type { PullRequestDetail, PullRequestSummary } from '../../src/core/github/types.js';

function summary(number: number, title: string, over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number, title, author: 'octocat', state: 'open', isDraft: false,
    headSha: 'abc', baseRef: 'main', headRef: 'feat/x',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

const detail: PullRequestDetail = {
  ...summary(42, 'Fix rendering'),
  body: 'Body text.', diff: '', viewerIsAuthor: false,
  additions: 10, deletions: 2, changedFiles: 3,
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
      lines: [
        { kind: 'context', text: 'const a = 0;', oldLine: 1, newLine: 1, noNewlineAtEof: false },
        { kind: 'add', text: 'const x = 1;', oldLine: null, newLine: 2, noNewlineAtEof: false },
      ],
    },
    keep: true, reason: 'introduces a new constant', source: 'model',
  }],
};

const meat: MeatResult = {
  summary: 'Adds a constant.', files: [meatFile],
  keptLines: 1, totalLines: 2, keptFiles: 1, totalFiles: 2,
  unclassified: 0,
};

const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });
const rows = buildRows(units, [], false);

const base = {
  repoLabel: 'octocat/marrow',
  prs: [summary(42, 'Fix rendering'), summary(43, 'Add caching')],
  pr: null,
  meat: null,
  checks: [],
  threads: [],
  model: 'opus',
  worktreeOk: true,
  filter: 'open' as const,
  onOpenPr: () => {},
  onSubmit: () => {},
};

describe('Help', () => {
  test('documents every keymap entry', () => {
    const out = renderToString(<Help width={160} height={40} />, { columns: 160 });
    for (const entry of KEY_HELP) {
      expect(out).toContain(entry.keys);
    }
  });

  test('cannot drift from the keymap because it is generated from it', () => {
    const out = renderToString(<Help width={160} height={40} />, { columns: 160 });
    expect(out).toContain('approve, request changes, or comment');
  });

  test('names every group it files bindings under', () => {
    const out = renderToString(<Help width={160} height={40} />, { columns: 160 });
    for (const { title } of HELP_GROUPS) {
      expect(out).toContain(title);
    }
  });

  // Ink draws an overflowing column on top of itself rather than clipping it, so
  // twenty-six rows of bindings in a twenty-four row terminal came out garbled.
  test('fits an eighty-by-twenty-four terminal without overdrawing', () => {
    const lines = renderToString(<Help width={80} height={24} />, { columns: 80 })
      .replaceAll(/\x1b\[[0-9;]*m/g, '')
      .split('\n');

    expect(lines.length).toBeLessThanOrEqual(24);
    for (const line of lines) {
      expect(line.replace(/\s+$/, '').length).toBeLessThanOrEqual(80);
      // No cell holding two rows' worth of content.
      expect(line).not.toMatch(/[│╰╭]/);
    }

    const out = lines.join('\n');
    // What does not fit scrolls, and says so — an eighty-column terminal has
    // room for one column, and one column of every binding is thirty-seven rows.
    expect(out).toMatch(/1–\d+ of \d+ · j k to scroll/);
    expect(out).toContain('esc to close');
    // The first section is the one on screen, whole rather than half-drawn.
    expect(out).toContain('move down / up');
  });

  test('scrolls to the bindings that did not fit rather than dropping them', () => {
    const at = (scrollTop: number) => renderToString(
      <Help width={80} height={24} scrollTop={scrollTop} />, { columns: 80 },
    );
    // `!` is in the last group, well past the fold on a short terminal.
    expect(at(0)).not.toContain('approve, request changes, or comment');
    expect(at(20)).toContain('approve, request changes, or comment');
  });

  test('will not scroll past the last binding', () => {
    const out = renderToString(
      <Help width={80} height={24} scrollTop={9999} />, { columns: 80 },
    ).replaceAll(/\x1b\[[0-9;]*m/g, '');
    // The window stops with the last row at the bottom, never on empty space.
    expect(out).toContain('close this overlay');
    expect(out).toMatch(/(\d+)–37 of 37/);
  });

  // Two roomy columns beat three cramped ones when two already fit.
  test('uses the fewest columns the height needs, not the most the width allows', () => {
    expect(layoutHelp(240, 40).columns).toBe(1);
    expect(layoutHelp(240, 24).columns).toBe(2);
    expect(layoutHelp(80, 24).columns).toBe(1);
  });

  test('renders at all when the terminal reports no size', () => {
    // `Math.floor(NaN)` columns made an empty array of columns and the first
    // push crashed the app on a keystroke as harmless as `?`.
    const out = renderToString(
      <Help width={undefined as unknown as number} height={undefined as unknown as number} />,
    );
    expect(out).toContain('Keys');
  });
});

describe('clampCursor', () => {
  test('holds the cursor inside a shrinking list', () => {
    expect(clampCursor(9, 3)).toBe(2);
    expect(clampCursor(1, 3)).toBe(1);
  });

  test('collapses to zero when nothing is left to point at', () => {
    expect(clampCursor(4, 0)).toBe(0);
    expect(clampCursor(-2, 5)).toBe(0);
  });
});

describe('anchorAtRow', () => {
  const rowIndex = (kind: string) => rows.findIndex((r) => r.kind === kind);

  test('anchors a diff line to that exact line, not to its hunk', () => {
    // The whole reason the cursor is a row. `C` on the context line must
    // comment on line 1, even though the hunk's last changed line is line 2.
    const contextRow = rows.findIndex(
      (r) => r.kind === 'diff-line' && r.line.kind === 'context',
    );
    expect(anchorAtRow(rows, contextRow)).toEqual({
      path: 'src/app.ts', line: 1, side: 'RIGHT',
    });

    const addRow = rows.findIndex((r) => r.kind === 'diff-line' && r.line.kind === 'add');
    expect(anchorAtRow(rows, addRow)).toEqual({
      path: 'src/app.ts', line: 2, side: 'RIGHT',
    });
  });

  test('anchors a hunk header to that hunk last changed line', () => {
    expect(anchorAtRow(rows, rowIndex('hunk-header'))).toEqual({
      path: 'src/app.ts', line: 2, side: 'RIGHT',
    });
  });

  test('anchors a file header to the first hunk of that file', () => {
    expect(anchorAtRow(rows, rowIndex('file-header'))).toEqual({
      path: 'src/app.ts', line: 2, side: 'RIGHT',
    });
  });

  test('puts a deleted line on the LEFT, which is the side GitHub accepts', () => {
    const removal: MeatFile = {
      ...meatFile,
      hunks: [{
        ...meatFile.hunks[0]!,
        hunk: {
          ...meatFile.hunks[0]!.hunk,
          lines: [{ kind: 'del', text: 'gone', oldLine: 7, newLine: null, noNewlineAtEof: false }],
        },
      }],
    };
    const only = buildRows(
      buildUnits(
        { ...meat, files: [removal] },
        { expandedFiles: new Set(), foldedFiles: new Set() },
      ),
      [],
      false,
    );
    const deleted = only.findIndex((r) => r.kind === 'diff-line');
    expect(anchorAtRow(only, deleted)).toEqual({
      path: 'src/app.ts', line: 7, side: 'LEFT',
    });
  });

  test('has no anchor past the end of the pane', () => {
    expect(anchorAtRow(rows, 9999)).toBeNull();
  });
});

describe('mergeTriage', () => {
  const found: VerifiedFinding = {
    id: 'f1', path: 'src/app.ts', line: 2, side: 'RIGHT', startLine: null,
    severity: 'important', title: 'Busy-wait', body: 'model wording',
    confidence: 'high', suggestion: null, verdict: 'plausible', refutations: [],
  };

  test('keeps triage done while the verifier was still running', () => {
    const held = accept(initTriage([found]), 'f1');
    const merged = mergeTriage(held, [{ ...found, verdict: 'confirmed' }]);

    expect(merged[0]?.state).toBe('accepted');
    expect(merged[0]?.verdict).toBe('confirmed');
    // Still staged: a verdict arriving must not silently unstage a comment the
    // reviewer already decided to send.
    expect(toStagedComments(merged)).toHaveLength(1);
  });

  test('takes the verified copy of a finding nobody has touched', () => {
    const merged = mergeTriage(initTriage([found]), [{ ...found, verdict: 'refuted' }]);
    expect(merged[0]?.state).toBe('pending');
    expect(merged[0]?.verdict).toBe('refuted');
  });

  test('a finding that only the verify pass knows about arrives untriaged', () => {
    const merged = mergeTriage([], [{ ...found, verdict: 'confirmed' }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.state).toBe('pending');
  });
});

describe('chatContextForRow', () => {
  test('gives the model the hunk under the cursor, with its diff marks', () => {
    const context = chatContextForRow(rows, rows.findIndex((r) => r.kind === 'diff-line'));
    expect(context).toContain('src/app.ts');
    expect(context).toContain('@@ -1,1 +1,2 @@');
    expect(context).toContain('+const x = 1;');
    expect(context).toContain(' const a = 0;');
  });

  test('a file header borrows that file first hunk rather than refusing', () => {
    expect(chatContextForRow(rows, rows.findIndex((r) => r.kind === 'file-header')))
      .toContain('+const x = 1;');
  });

  test('has nothing to say past the end of the pane', () => {
    expect(chatContextForRow(rows, 9999)).toBeNull();
  });
});

describe('hunkUrl', () => {
  test('builds the github file anchor GitHub itself uses', () => {
    const url = hunkUrl('octocat/marrow', 42, { path: 'src/app.ts', line: 2, side: 'RIGHT' });
    expect(url).toStartWith('https://github.com/octocat/marrow/pull/42/files#diff-');
    expect(url).toEndWith('R2');
  });

  test('marks a LEFT anchor with L', () => {
    const url = hunkUrl('octocat/marrow', 42, { path: 'src/app.ts', line: 7, side: 'LEFT' });
    expect(url).toEndWith('L7');
  });
});

describe('App', () => {
  // The right pane used to be one dim line pinned to the top. It is the
  // largest region on screen at the moment a new reviewer knows least.
  test('renders the list pane and the welcome panel when no pull request is open', () => {
    const out = renderToString(<App {...base} />);
    expect(out).toContain('#42');
    expect(out).toContain('Fix rendering');
    expect(out).toContain('marrow');
    expect(out).toContain('2 open');
    expect(out).toContain('review');
    expect(out).toContain('all keys');
  });

  // A status note is something the app has to say right now; the welcome
  // panel is orientation. Two at once would say the same thing twice.
  test('a status note takes the pane back from the welcome panel', () => {
    const out = renderToString(<App {...base} status="Fetching pull requests…" />);
    expect(out).toContain('Fetching pull requests…');
    expect(out).not.toContain('abridged to what carries meaning');
  });

  test('renders the empty state rather than a blank pane', () => {
    const out = renderToString(<App {...base} prs={[]} />);
    expect(out.toLowerCase()).toContain('no pull requests');
  });

  test('renders the detail pane and the status bar once a pull request is open', () => {
    const out = renderToString(<App {...base} pr={detail} meat={meat} />);
    expect(out).toContain('Fix rendering');
    expect(out).toContain('Adds a constant.');
    expect(out).toContain('kept 1/2');
    expect(out).toContain('opus');
  });

  test('states degraded mode instead of hiding it', () => {
    const out = renderToString(<App {...base} pr={detail} meat={meat} worktreeOk={false} />);
    expect(out.toLowerCase()).toContain('diff-only');
  });

  test('shows a status note while a pull request loads', () => {
    const out = renderToString(<App {...base} status="Loading #42…" />);
    expect(out).toContain('Loading #42');
  });
});
