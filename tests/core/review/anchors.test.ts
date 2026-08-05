import { test, expect } from 'bun:test';
import { parseUnifiedDiff } from '../../../src/core/diff/parse.js';
import {
  demoteUnanchorable,
  findAnchorProblems,
} from '../../../src/core/review/anchors.js';
import type { ReviewDraft, StagedComment } from '../../../src/core/review/types.js';

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,4 @@ function boot()
 const c = load();
-start(c);
+const s = start(c);
+s.on('error', fail);
 return c;
@@ -50,2 +47,1 @@ function shutdown()
 keep();
-drop();
`;

const files = parseUnifiedDiff(DIFF);

function comment(over: Partial<StagedComment> = {}): StagedComment {
  return {
    id: 'c1',
    path: 'src/app.ts',
    line: 12,
    side: 'RIGHT',
    startLine: null,
    body: 'Consider handling this.',
    suggestion: null,
    ...over,
  };
}

function draft(comments: StagedComment[]): ReviewDraft {
  return { verdict: 'COMMENT', body: '', comments };
}

test('accepts a comment on an added line', () => {
  expect(findAnchorProblems(draft([comment({ line: 12 })]), files)).toEqual([]);
});

test('accepts a comment on a context line', () => {
  expect(findAnchorProblems(draft([comment({ line: 13 })]), files)).toEqual([]);
});

test('accepts a LEFT comment on a deleted line', () => {
  const problems = findAnchorProblems(draft([comment({ line: 51, side: 'LEFT' })]), files);
  expect(problems).toEqual([]);
});

test('rejects a line outside every hunk', () => {
  const problems = findAnchorProblems(draft([comment({ line: 500 })]), files);
  expect(problems).toHaveLength(1);
  expect(problems[0]!.reason).toMatch(/not present in the diff/);
});

test('rejects an unknown file path', () => {
  const problems = findAnchorProblems(draft([comment({ path: 'src/other.ts' })]), files);
  expect(problems).toHaveLength(1);
  expect(problems[0]!.reason).toMatch(/not part of this pull request/);
});

test('rejects a RIGHT comment aimed at a deleted line', () => {
  const problems = findAnchorProblems(draft([comment({ line: 51, side: 'RIGHT' })]), files);
  expect(problems).toHaveLength(1);
});

test('rejects a range whose start is after its end', () => {
  const problems = findAnchorProblems(
    draft([comment({ line: 12, startLine: 13 })]),
    files,
  );
  expect(problems).toHaveLength(1);
  expect(problems[0]!.reason).toMatch(/startLine/);
});

test('demotes unanchorable comments into the review body', () => {
  const good = comment({ id: 'ok', line: 12 });
  const bad = comment({ id: 'bad', line: 500, body: 'Wider concern about boot().' });

  const { draft: cleaned, demoted } = demoteUnanchorable(
    { verdict: 'COMMENT', body: 'Overall looks reasonable.', comments: [good, bad] },
    files,
  );

  expect(cleaned.comments.map((c) => c.id)).toEqual(['ok']);
  expect(demoted.map((c) => c.id)).toEqual(['bad']);
  expect(cleaned.body).toContain('Overall looks reasonable.');
  expect(cleaned.body).toContain('Wider concern about boot().');
  expect(cleaned.body).toContain('src/app.ts');
});

test('demoting nothing leaves the body untouched', () => {
  const original = { verdict: 'COMMENT' as const, body: 'Body.', comments: [comment()] };
  const { draft: cleaned, demoted } = demoteUnanchorable(original, files);
  expect(demoted).toEqual([]);
  expect(cleaned.body).toBe('Body.');
});
