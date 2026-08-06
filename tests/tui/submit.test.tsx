import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { SubmitScreen } from '../../src/tui/components/SubmitScreen.js';
import { parseUnifiedDiff } from '../../src/core/diff/parse.js';
import type { ReviewDraft, StagedComment } from '../../src/core/review/types.js';

const files = parseUnifiedDiff(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 keep
+added
`);

function comment(over: Partial<StagedComment> = {}): StagedComment {
  return {
    id: 'c1', path: 'a.ts', line: 2, side: 'RIGHT', startLine: null,
    body: 'note', suggestion: null, ...over,
  };
}

const draft = (comments: StagedComment[]): ReviewDraft =>
  ({ verdict: 'COMMENT', body: 'Overall fine.', comments });

describe('SubmitScreen', () => {
  test('lists the three verdicts and the staged comment count', () => {
    const out = renderToString(
      <SubmitScreen draft={draft([comment()])} files={files} viewerIsAuthor={false}
        selected="COMMENT" />,
    );
    expect(out.toLowerCase()).toContain('approve');
    expect(out.toLowerCase()).toContain('request changes');
    expect(out.toLowerCase()).toContain('comment');
    expect(out).toContain('1');
  });

  test('disables approve with a reason when the viewer is the author', () => {
    const out = renderToString(
      <SubmitScreen draft={draft([])} files={files} viewerIsAuthor
        selected="COMMENT" />,
    );
    expect(out.toLowerCase()).toContain('cannot approve your own');
  });

  // GitHub rejects a change request from the author for the same reason it
  // rejects an approval, so leaving it selectable only fails at the API.
  test('disables request changes too when the viewer is the author', () => {
    const out = renderToString(
      <SubmitScreen draft={draft([])} files={files} viewerIsAuthor
        selected="COMMENT" />,
    );
    expect(out.toLowerCase()).toContain('cannot request changes on your own');
  });

  test('warns that unanchorable comments move into the body', () => {
    const out = renderToString(
      <SubmitScreen draft={draft([comment({ id: 'bad', line: 999 })])} files={files}
        viewerIsAuthor={false} selected="COMMENT" />,
    );
    expect(out.toLowerCase()).toContain('review body');
  });

  test('shows the review body text', () => {
    const out = renderToString(
      <SubmitScreen draft={draft([])} files={files} viewerIsAuthor={false}
        selected="APPROVE" />,
    );
    expect(out).toContain('Overall fine.');
  });
});
