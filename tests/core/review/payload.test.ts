import { test, expect } from 'bun:test';
import { parseUnifiedDiff } from '../../../src/core/diff/parse.js';
import {
  buildReviewPayload,
  renderCommentBody,
} from '../../../src/core/review/payload.js';
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
`;

const files = parseUnifiedDiff(DIFF);

function comment(over: Partial<StagedComment> = {}): StagedComment {
  return {
    id: 'c1',
    path: 'src/app.ts',
    line: 12,
    side: 'RIGHT',
    startLine: null,
    body: 'Handle this.',
    suggestion: null,
    ...over,
  };
}

test('renders a plain comment body unchanged', () => {
  expect(renderCommentBody(comment())).toBe('Handle this.');
});

test('appends a suggestion fence when a suggestion is present', () => {
  const rendered = renderCommentBody(
    comment({ suggestion: 'const s = start(c) ?? fallback();' }),
  );
  expect(rendered).toBe(
    'Handle this.\n\n```suggestion\nconst s = start(c) ?? fallback();\n```',
  );
});

test('builds a single-line comment payload', () => {
  const draft: ReviewDraft = { verdict: 'COMMENT', body: 'Body.', comments: [comment()] };
  const payload = buildReviewPayload(draft, files);

  expect(payload.event).toBe('COMMENT');
  expect(payload.body).toBe('Body.');
  expect(payload.comments).toEqual([
    { path: 'src/app.ts', line: 12, side: 'RIGHT', body: 'Handle this.' },
  ]);
});

test('includes start_line and start_side for a range comment', () => {
  const draft: ReviewDraft = {
    verdict: 'REQUEST_CHANGES',
    body: 'Please fix.',
    comments: [comment({ line: 13, startLine: 12 })],
  };
  const payload = buildReviewPayload(draft, files);

  expect(payload.event).toBe('REQUEST_CHANGES');
  expect(payload.comments[0]).toEqual({
    path: 'src/app.ts',
    line: 13,
    side: 'RIGHT',
    start_line: 12,
    start_side: 'RIGHT',
    body: 'Handle this.',
  });
});

test('normalizes a one-line range into a single-line comment', () => {
  const draft: ReviewDraft = {
    verdict: 'COMMENT',
    body: 'Body.',
    comments: [comment({ line: 12, startLine: 12 })],
  };
  const payload = buildReviewPayload(draft, files);

  // GitHub requires start_line < line, so a degenerate range must not be sent.
  expect(payload.comments[0]).toEqual({
    path: 'src/app.ts',
    line: 12,
    side: 'RIGHT',
    body: 'Handle this.',
  });
});

test('throws rather than submitting an invalid anchor', () => {
  const draft: ReviewDraft = {
    verdict: 'COMMENT',
    body: 'Body.',
    comments: [comment({ line: 999 })],
  };
  expect(() => buildReviewPayload(draft, files)).toThrow(/not present in the diff/);
});

// Measured against the live API: `{"event":"COMMENT","body":"","comments":[one
// non-empty comment]}` gets past the body check and fails only on the comment,
// while the same request with an empty comment body answers "Body required when
// requesting changes". GitHub wants content somewhere, not a body specifically.
test('an empty body is fine when the review carries a comment', () => {
  for (const verdict of ['REQUEST_CHANGES', 'COMMENT'] as const) {
    const draft: ReviewDraft = { verdict, body: '   \n', comments: [comment()] };
    expect(buildReviewPayload(draft, files).comments).toHaveLength(1);
  }
});

test('throws when a non-approval has neither a body nor a comment', () => {
  for (const verdict of ['REQUEST_CHANGES', 'COMMENT'] as const) {
    const draft: ReviewDraft = { verdict, body: '   \n', comments: [] };
    expect(() => buildReviewPayload(draft, files)).toThrow(/nothing to say/);
  }
});

test('throws on a comment with an empty body', () => {
  const draft: ReviewDraft = {
    verdict: 'COMMENT',
    body: 'Body.',
    comments: [comment({ body: '  ' })],
  };
  expect(() => buildReviewPayload(draft, files)).toThrow(/src\/app\.ts:12 is empty/);
});

test('a comment carrying only a suggestion is not empty', () => {
  const draft: ReviewDraft = {
    verdict: 'COMMENT',
    body: 'Body.',
    comments: [comment({ body: '', suggestion: 'const s = start(c);' })],
  };
  expect(buildReviewPayload(draft, files).comments[0]!.body).toContain('```suggestion');
});

test('throws when no verdict has been chosen', () => {
  const draft: ReviewDraft = { verdict: null, body: 'x', comments: [] };
  expect(() => buildReviewPayload(draft, files)).toThrow(/verdict/);
});

test('an approval with no body and no comments is still valid', () => {
  const draft: ReviewDraft = { verdict: 'APPROVE', body: '', comments: [] };
  const payload = buildReviewPayload(draft, files);
  expect(payload).toEqual({ event: 'APPROVE', body: '', comments: [] });
});
