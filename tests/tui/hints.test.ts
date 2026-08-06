import { test, expect, describe } from 'bun:test';
import { detailHints, fitHints, listHints } from '../../src/tui/hints.js';
import { buildRows } from '../../src/tui/rows.js';
import { buildUnits } from '../../src/tui/units.js';
import { initTriage } from '../../src/core/findings/triage.js';
import type { MeatResult } from '../../src/core/meat/index.js';
import type { VerifiedFinding } from '../../src/core/findings/verify.js';

const meat: MeatResult = {
  summary: '',
  files: [{
    file: {
      path: 'a.ts', oldPath: null, status: 'modified', similarity: null,
      hunks: [], additions: 1, deletions: 0,
    },
    dropped: null,
    hunks: [{
      hunk: {
        header: '@@ -1,1 +1,2 @@', section: '', oldStart: 1, oldLines: 1, newStart: 1, newLines: 2,
        lines: [{ kind: 'add', text: 'x', oldLine: null, newLine: 1, noNewlineAtEof: false }],
      },
      keep: true, reason: 'meaningful', source: 'model',
    }],
  }],
  keptLines: 1, totalLines: 1, keptFiles: 1, totalFiles: 1,
  keptAdditions: 1, keptDeletions: 0, totalAdditions: 1, totalDeletions: 0,
  unclassified: 0,
};

const finding: VerifiedFinding = {
  id: 'f1', path: 'a.ts', line: 1, side: 'RIGHT', startLine: null,
  severity: 'important', title: 'Leak', body: 'Nothing closes it.',
  confidence: 'high', suggestion: null, verdict: 'confirmed', refutations: [],
};

const rows = buildRows(
  buildUnits(meat, {
    expandedFiles: new Set(), foldedFiles: new Set(), findings: initTriage([finding]),
  }),
  [],
  false,
);

const commentRows = buildRows(
  buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() }),
  [],
  false,
  [{
    id: 'c1', path: 'a.ts', line: 1, side: 'RIGHT', startLine: null,
    body: 'is this right?', suggestion: null,
  }],
  60,
);

const width = (hints: readonly { keys: string; label: string }[]) =>
  hints.reduce((n, h, i) => n + (i > 0 ? 3 : 0) + h.keys.length + 1 + h.label.length, 0);

describe('detailHints', () => {
  test('offers commenting on the line, which is what the cursor is on', () => {
    const diffRow = rows.find((r) => r.kind === 'diff-line');
    const hints = detailHints(diffRow, false);
    expect(hints.map((h) => h.label)).toContain('comment on this line');
    expect(hints.map((h) => h.keys)).toContain('c');
    expect(hints.map((h) => h.keys)).toContain('s');
  });

  test('offers editing and deleting when the cursor is on your own comment', () => {
    const commentRow = commentRows.find((r) => r.kind === 'comment');
    const keys = detailHints(commentRow, false).map((h) => h.keys);
    expect(keys).toContain('⏎');
    expect(keys).toContain('x');
    // Not the line verbs: a comment is not a line, and `c` here would author a
    // second comment on the line the first one is already about.
    expect(keys).not.toContain('c');
  });

  test('offers triage instead when the cursor is on a finding', () => {
    const findingRow = rows.find((r) => r.kind === 'finding');
    const keys = detailHints(findingRow, false).map((h) => h.keys);
    expect(keys).toContain('a');
    expect(keys).toContain('x');
    // A finding is not a line, so the line verbs step aside for the decision.
    expect(keys).not.toContain('c');
  });

  test('always offers a way to approve and a way out of not knowing', () => {
    for (const row of [rows[0], rows.find((r) => r.kind === 'finding'), undefined]) {
      const keys = detailHints(row, false).map((h) => h.keys);
      expect(keys).toContain('!');
      expect(keys.at(-1)).toBe('?');
    }
  });

  test('offers the way to a finding once there is one to go to', () => {
    const diffRow = rows.find((r) => r.kind === 'diff-line');
    expect(detailHints(diffRow, false, 3).map((h) => h.keys)).toContain('n');
  });

  test('says nothing about findings when there are none', () => {
    const diffRow = rows.find((r) => r.kind === 'diff-line');
    expect(detailHints(diffRow, false, 0).map((h) => h.keys)).not.toContain('n');
  });

  test('drops `n` when the cursor is already on a finding', () => {
    // The decision in front of you outranks getting to the next one.
    const findingRow = rows.find((r) => r.kind === 'finding');
    expect(detailHints(findingRow, false, 3).map((h) => h.keys)).not.toContain('n');
  });

  test('names the view it would switch to, not the one you are in', () => {
    expect(detailHints(rows[0], false).find((h) => h.keys === 'd')?.label).toBe('full diff');
    expect(detailHints(rows[0], true).find((h) => h.keys === 'd')?.label).toBe('meat only');
  });
});

describe('fitHints', () => {
  const hints = detailHints(rows[0], false);

  test('leaves everything alone when it fits', () => {
    expect(fitHints(hints, 500)).toEqual(hints.map((h) => ({ keys: h.keys, label: h.label })));
  });

  test('never exceeds the width it was given', () => {
    for (let w = 1; w <= 140; w += 1) {
      const fitted = fitHints(hints, w);
      // One hint always survives, and below its own width nothing can fit.
      if (fitted.length > 1) expect(width(fitted)).toBeLessThanOrEqual(w);
    }
  });

  test('keeps `?` however narrow it gets — it is the way out', () => {
    for (let w = 1; w <= 140; w += 1) {
      expect(fitHints(hints, w).at(-1)!.keys).toBe('?');
    }
  });

  test('sheds from the back, so the contextual verbs keep their wording longest', () => {
    // At this width the trailing hints have gone short while `c` has not: `c`
    // is the one that tells a reviewer line-level comments exist.
    const fitted = fitHints(hints, 100);
    expect(fitted.find((h) => h.keys === 'c')?.label).toBe('comment on this line');
    expect(fitted.find((h) => h.keys === ']')?.label).toBe('file');
  });

  // Reversed from what this used to assert. `d` is how a reviewer learns the
  // diff in front of them is abridged at all; `!` is documented in help and on
  // the submit screen, so losing it costs a keystroke, not the knowledge.
  test('keeps `d` longer than the keys that are discoverable elsewhere', () => {
    const fitted = fitHints(hints, 80).map((h) => h.keys);
    expect(fitted).toContain('d');
    expect(fitted).not.toContain('m');
  });

  test('an empty bar stays empty', () => {
    expect(fitHints([], 80)).toEqual([]);
  });
});

describe('listHints', () => {
  test('covers choosing, searching, filtering, and leaving', () => {
    const keys = listHints().map((h) => h.keys);
    expect(keys).toContain('⏎');
    expect(keys).toContain('/');
    expect(keys).toContain('q');
    expect(keys.at(-1)).toBe('?');
  });
});
