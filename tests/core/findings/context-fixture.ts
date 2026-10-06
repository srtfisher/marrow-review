import type { ReviewContext } from '../../../src/core/findings/context.js';
import type { MeatResult } from '../../../src/core/meat/index.js';

export function meat(): MeatResult {
  return {
    summary: 'Adds retry logic.',
    files: [{
      file: { path: 'src/api.ts', oldPath: null, status: 'modified', similarity: null, hunks: [], additions: 2, deletions: 1 },
      dropped: null,
      hunks: [
        { hunk: { header: '@@ -10,2 +10,3 @@', section: 'retry()', oldStart: 10, oldLines: 2, newStart: 10, newLines: 3,
                  lines: [{ kind: 'add', text: 'await sleep(0);', oldLine: null, newLine: 11, noNewlineAtEof: false }] },
          keep: true, reason: 'changes control flow', source: 'model' },
        { hunk: { header: '@@ -40,1 +41,1 @@', section: '', oldStart: 40, oldLines: 1, newStart: 41, newLines: 1,
                  lines: [{ kind: 'add', text: "import x from 'y';", oldLine: null, newLine: 41, noNewlineAtEof: false }] },
          keep: false, reason: 'imports-only', source: 'rule' },
      ],
    }],
    keptLines: 1, totalLines: 2, keptFiles: 1, totalFiles: 1,
    keptAdditions: 1, keptDeletions: 0, totalAdditions: 2, totalDeletions: 0,
    unclassified: 0, classifierError: null, classifierSkipped: false,
  };
}

/** Every lens has something to look at. */
export function context(over: Partial<ReviewContext> = {}): ReviewContext {
  return {
    prTitle: 'Add retries', prBody: 'Retries on 5xx.', meat: meat(), threads: [], failingChecks: [],
    effort: 'medium', standards: '', conventions: '### CLAUDE.md\nNever busy-wait.',
    files: [{ path: 'src/api.ts', text: ' 1  // Must yield to the event loop.\n11  await sleep(0);' }],
    omittedFiles: [],
    history: [{
      path: 'src/api.ts',
      commits: [{ sha: 'abc1234', headline: 'Fix retry storm', author: 'ada', date: '2026-09-01', pr: { number: 7, title: 'Fix retry storm' } }],
      priorComments: [{ pr: 7, author: 'rev', body: 'Back off exponentially here.' }],
    }],
    ...over,
  };
}

export const rawFinding = {
  path: 'src/api.ts', line: 11, side: 'RIGHT', startLine: null, severity: 'blocking', type: 'Correctness', kind: 'issue',
  failureScenario: 'A 5xx makes retry() spin.', title: 'Busy-wait', body: 'sleep(0) does not yield.', confidence: 'high', suggestion: null,
};
