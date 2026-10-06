import { test, expect } from 'bun:test';
import { applicableLenses, buildLensPrompt, REVIEW_LENSES } from '../../../src/core/findings/lenses.js';
import { context } from './context-fixture.js';

test('every lens runs when each has something to look at', () => {
  expect(applicableLenses(context())).toEqual([...REVIEW_LENSES]);
});

test('a lens with nothing to look at does not run', () => {
  const bare = context({ conventions: '', standards: '', history: [], files: [] });
  expect(applicableLenses(bare)).toEqual(['bugs']);
});

test('team standards alone are enough for the conventions reviewer', () => {
  expect(applicableLenses(context({ conventions: '', standards: 'Escape late.' }))).toContain('conventions');
});

test('every prompt carries the kept hunks and none of the dropped ones', () => {
  for (const lens of REVIEW_LENSES) {
    const prompt = buildLensPrompt(lens, context());
    expect(prompt).toContain('await sleep(0);');
    expect(prompt).not.toContain("import x from 'y';");
    expect(prompt).toContain('Add retries');
  }
});

test('each reviewer is handed only what its angle needs', () => {
  expect(buildLensPrompt('conventions', context())).toContain('Never busy-wait.');
  expect(buildLensPrompt('bugs', context())).not.toContain('Never busy-wait.');
  expect(buildLensPrompt('history', context())).toContain('abc1234');
  expect(buildLensPrompt('priorComments', context())).toContain('Back off exponentially here.');
  expect(buildLensPrompt('bugs', context())).not.toContain('Back off exponentially');
  expect(buildLensPrompt('codeComments', context())).toContain('Must yield to the event loop.');
});

test('only the reviewers that read the code itself are sent the changed files in full', () => {
  expect(buildLensPrompt('bugs', context())).toContain('The changed files in full');
  expect(buildLensPrompt('codeComments', context())).toContain('The changed files in full');
  for (const lens of ['conventions', 'history', 'priorComments'] as const) {
    expect(buildLensPrompt(lens, context())).not.toContain('The changed files in full');
  }
});

test('existing review comments are passed on so they are not repeated', () => {
  const threads = [{ path: 'src/api.ts', line: 11, side: 'RIGHT' as const, isResolved: false, isOutdated: false, comments: [{ author: 'ada', avatarUrl: null, body: 'Already said.', bodyHtml: null, createdAt: '', url: null }] }];
  expect(buildLensPrompt('bugs', context({ threads }))).toContain('Already said.');
});
