import { test, expect } from 'bun:test';
import { popoverAlign } from '../../src/web/lib/popover.js';

test('hangs from the left edge when the panel fits', () => {
  expect(popoverAlign(100, 200, 500, 1400)).toBe('left');
});

test('hangs from the right edge when the left would run off the page', () => {
  expect(popoverAlign(1000, 1100, 544, 1300)).toBe('right');
});

test('on a viewport too narrow for either, takes the side with more room', () => {
  expect(popoverAlign(300, 360, 600, 640)).toBe('right');
  expect(popoverAlign(40, 100, 600, 640)).toBe('left');
});
