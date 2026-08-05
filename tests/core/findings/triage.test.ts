import { test, expect, describe } from 'bun:test';
import {
  accept, drop, edit, initTriage, toggleSuggestion, toStagedComments, visibleFindings,
} from '../../../src/core/findings/triage.js';
import type { VerifiedFinding } from '../../../src/core/findings/verify.js';

function vf(id: string, over: Partial<VerifiedFinding> = {}): VerifiedFinding {
  return {
    id, path: 'a.ts', line: 10, side: 'RIGHT', startLine: null,
    severity: 'important', title: `t-${id}`, body: `b-${id}`,
    confidence: 'high', suggestion: null, verdict: 'confirmed', refutations: [], ...over,
  };
}

describe('initTriage', () => {
  test('everything starts pending and unedited', () => {
    const list = initTriage([vf('a'), vf('b')]);
    expect(list.every((f) => f.state === 'pending')).toBe(true);
    expect(list.every((f) => f.editedBody === null && !f.asSuggestion)).toBe(true);
  });
});

describe('transitions', () => {
  test('accept and drop affect only the named finding', () => {
    let list = initTriage([vf('a'), vf('b')]);
    list = accept(list, 'a');
    expect(list.find((f) => f.id === 'a')!.state).toBe('accepted');
    expect(list.find((f) => f.id === 'b')!.state).toBe('pending');

    list = drop(list, 'b');
    expect(list.find((f) => f.id === 'b')!.state).toBe('dropped');
    expect(list.find((f) => f.id === 'a')!.state).toBe('accepted');
  });

  test('editing sets the body and accepts, since editing implies keeping', () => {
    const list = edit(initTriage([vf('a')]), 'a', 'my words');
    expect(list[0]!.editedBody).toBe('my words');
    expect(list[0]!.state).toBe('accepted');
  });

  test('an unknown id is a no-op rather than an error', () => {
    const before = initTriage([vf('a')]);
    expect(accept(before, 'nope')).toEqual(before);
  });

  test('toggling a suggestion flips it', () => {
    let list = initTriage([vf('a', { suggestion: 'const x = 1;' })]);
    list = toggleSuggestion(list, 'a');
    expect(list[0]!.asSuggestion).toBe(true);
    list = toggleSuggestion(list, 'a');
    expect(list[0]!.asSuggestion).toBe(false);
  });
});

describe('toStagedComments', () => {
  test('stages only accepted findings', () => {
    let list = initTriage([vf('a'), vf('b'), vf('c')]);
    list = accept(list, 'a');
    list = drop(list, 'b');
    const staged = toStagedComments(list);
    expect(staged).toHaveLength(1);
    expect(staged[0]!.id).toBe('a');
  });

  test('prefers the edited body over the model text', () => {
    const list = edit(initTriage([vf('a')]), 'a', 'my words');
    expect(toStagedComments(list)[0]!.body).toBe('my words');
  });

  test('carries the suggestion only when toggled on', () => {
    let list = initTriage([vf('a', { suggestion: 'const x = 1;' })]);
    list = accept(list, 'a');
    expect(toStagedComments(list)[0]!.suggestion).toBeNull();

    list = toggleSuggestion(list, 'a');
    expect(toStagedComments(list)[0]!.suggestion).toBe('const x = 1;');
  });

  test('preserves the anchor exactly', () => {
    const list = accept(initTriage([vf('a', { line: 42, side: 'LEFT', startLine: 40 })]), 'a');
    const staged = toStagedComments(list)[0]!;
    expect(staged.line).toBe(42);
    expect(staged.side).toBe('LEFT');
    expect(staged.startLine).toBe(40);
  });
});

describe('visibleFindings', () => {
  test('hides refuted findings by default but never deletes them', () => {
    const list = initTriage([vf('a'), vf('b', { verdict: 'refuted' })]);
    expect(visibleFindings(list, false).map((f) => f.id)).toEqual(['a']);
    expect(visibleFindings(list, true).map((f) => f.id)).toEqual(['a', 'b']);
  });

  test('plausible findings stay visible — only refuted collapse', () => {
    const list = initTriage([vf('a', { verdict: 'plausible' })]);
    expect(visibleFindings(list, false)).toHaveLength(1);
  });
});
