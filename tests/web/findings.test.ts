import { test, expect } from 'bun:test';
import { isLow, isShown, scoreTone } from '../../src/web/lib/findings.js';
import { isShown as coreIsShown } from '../../src/core/findings/score.js';

test('an unscored finding is always shown', () => {
  expect(isShown({ score: null }, 80)).toBe(true);
  expect(isLow({ score: null }, 80)).toBe(false);
});

test('the line is inclusive', () => {
  expect(isShown({ score: 80 }, 80)).toBe(true);
  expect(isShown({ score: 79 }, 80)).toBe(false);
});

test('agrees with the core on every score', () => {
  for (let score = 0; score <= 100; score += 1) {
    expect(isShown({ score }, 80)).toBe(coreIsShown({ score } as never, 80));
  }
});

test('a score reads green only when it is near certain, and grey below the line', () => {
  expect(scoreTone(95, 80)).toBe('success');
  expect(scoreTone(82, 80)).toBe('attention');
  expect(scoreTone(40, 80)).toBe('muted');
});
