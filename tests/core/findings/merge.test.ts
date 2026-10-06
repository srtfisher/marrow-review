import { test, expect } from 'bun:test';
import { mergeFindings } from '../../../src/core/findings/merge.js';
import type { Finding } from '../../../src/core/findings/types.js';

const f = (over: Partial<Finding>): Finding => ({
  id: 'x', path: 'a.ts', line: 10, side: 'RIGHT', startLine: null, severity: 'non-blocking', type: 'Correctness',
  kind: 'issue', title: 'T', body: 'short', failureScenario: null, confidence: 'low', suggestion: null, lenses: ['bugs'], ...over,
});

test('the same point from two reviewers becomes one finding crediting both', () => {
  const merged = mergeFindings([
    f({ id: 'a', lenses: ['bugs'], body: 'short' }),
    f({ id: 'b', line: 12, severity: 'blocking', lenses: ['history'], body: 'a longer explanation', confidence: 'high', failureScenario: 'x' }),
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ id: 'b', severity: 'blocking', body: 'a longer explanation', confidence: 'high', failureScenario: 'x' });
  expect(merged[0]!.lenses).toEqual(['history', 'bugs']);
});

test('findings further apart, of another type, or in another file stay separate', () => {
  expect(mergeFindings([f({ id: 'a' }), f({ id: 'b', line: 14 })])).toHaveLength(2);
  expect(mergeFindings([f({ id: 'a' }), f({ id: 'b', type: 'Performance' })])).toHaveLength(2);
  expect(mergeFindings([f({ id: 'a' }), f({ id: 'b', path: 'b.ts' })])).toHaveLength(2);
  expect(mergeFindings([f({ id: 'a' }), f({ id: 'b', side: 'LEFT' })])).toHaveLength(2);
});

test('an issue and a question on the same point merge as the issue', () => {
  expect(mergeFindings([f({ kind: 'question' }), f({ kind: 'issue' })])[0]!.kind).toBe('issue');
});
