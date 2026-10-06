import { test, expect } from 'bun:test';
import { formatCost, formatDuration, formatTokens, headlineTokens, usageRows } from '../../src/web/lib/usage.js';

const p = (input: number) => ({ runs: 1, failed: 0, inputTokens: input, outputTokens: 10, cacheReadTokens: 50_000, cacheCreationTokens: 5, costUsd: 0, durationMs: 0 });

test('tokens read as a person would say them', () => {
  expect(formatTokens(950)).toBe('950');
  expect(formatTokens(4_321)).toBe('4.3k');
  expect(formatTokens(48_700)).toBe('49k');
  expect(formatTokens(2_400_000)).toBe('2.4M');
});

test('cost never rounds a real spend down to nothing', () => {
  expect(formatCost(0)).toBe('$0');
  expect(formatCost(0.004)).toBe('<$0.01');
  expect(formatCost(1.234)).toBe('$1.23');
});

test('durations switch to minutes past a minute', () => {
  expect(formatDuration(850)).toBe('850ms');
  expect(formatDuration(12_340)).toBe('12.3s');
  expect(formatDuration(95_000)).toBe('1m 35s');
});

test('the headline leaves cache reads out', () => {
  expect(headlineTokens(p(100))).toBe(115);
});

test('rows follow the pipeline order and skip passes that never ran', () => {
  expect(usageRows({ verify: p(1), abridge: p(2) }).map((r) => r.label)).toEqual(['Abridge', 'Verify']);
});
