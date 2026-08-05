import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import {
  App, anchorForUnit, chatContextForUnit, clampCursor, hunkUrl, mergeTriage,
} from '../../src/tui/App.js';
import { Help } from '../../src/tui/components/Help.js';
import { KEY_HELP } from '../../src/tui/keymap.js';
import { buildUnits } from '../../src/tui/units.js';
import { accept, initTriage, toStagedComments } from '../../src/core/findings/triage.js';
import type { VerifiedFinding } from '../../src/core/findings/verify.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import type { PullRequestDetail, PullRequestSummary } from '../../src/core/github/types.js';

function summary(number: number, title: string, over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number, title, author: 'srtfisher', state: 'open', isDraft: false,
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
};

const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });

const base = {
  repoLabel: 'srtfisher/marrow',
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
    const out = renderToString(<Help />);
    for (const entry of KEY_HELP) {
      expect(out).toContain(entry.keys);
    }
  });

  test('cannot drift from the keymap because it is generated from it', () => {
    const out = renderToString(<Help />);
    expect(out).toContain('open the submit screen');
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

describe('anchorForUnit', () => {
  test('anchors a hunk to its last changed line on the RIGHT side', () => {
    const hunkUnit = units.find((u) => u.kind === 'hunk');
    expect(anchorForUnit(hunkUnit)).toEqual({ path: 'src/app.ts', line: 2, side: 'RIGHT' });
  });

  test('anchors a file header to the first hunk of that file', () => {
    const header = units.find((u) => u.kind === 'file-header');
    expect(anchorForUnit(header)).toEqual({ path: 'src/app.ts', line: 2, side: 'RIGHT' });
  });

  test('prefers a deleted line on the LEFT when a hunk only removes', () => {
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
    const only = buildUnits(
      { ...meat, files: [removal] },
      { expandedFiles: new Set(), foldedFiles: new Set() },
    );
    expect(anchorForUnit(only.find((u) => u.kind === 'hunk'))).toEqual({
      path: 'src/app.ts', line: 7, side: 'LEFT',
    });
  });

  test('has no anchor without a unit', () => {
    expect(anchorForUnit(undefined)).toBeNull();
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

describe('chatContextForUnit', () => {
  test('gives the model the hunk under the cursor, with its diff marks', () => {
    const context = chatContextForUnit(units.find((u) => u.kind === 'hunk'));
    expect(context).toContain('src/app.ts');
    expect(context).toContain('@@ -1,1 +1,2 @@');
    expect(context).toContain('+const x = 1;');
    expect(context).toContain(' const a = 0;');
  });

  test('a file header borrows that file first hunk rather than refusing', () => {
    expect(chatContextForUnit(units.find((u) => u.kind === 'file-header')))
      .toContain('+const x = 1;');
  });

  test('has nothing to say without a unit', () => {
    expect(chatContextForUnit(undefined)).toBeNull();
  });
});

describe('hunkUrl', () => {
  test('builds the github file anchor GitHub itself uses', () => {
    const url = hunkUrl('srtfisher/marrow', 42, { path: 'src/app.ts', line: 2, side: 'RIGHT' });
    expect(url).toStartWith('https://github.com/srtfisher/marrow/pull/42/files#diff-');
    expect(url).toEndWith('R2');
  });

  test('marks a LEFT anchor with L', () => {
    const url = hunkUrl('srtfisher/marrow', 42, { path: 'src/app.ts', line: 7, side: 'LEFT' });
    expect(url).toEndWith('L7');
  });
});

describe('App', () => {
  test('renders the list pane and a prompt when no pull request is open', () => {
    const out = renderToString(<App {...base} />);
    expect(out).toContain('#42');
    expect(out).toContain('Fix rendering');
    expect(out).toContain('Select a pull request');
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
