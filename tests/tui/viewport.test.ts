import { test, expect, describe } from 'bun:test';
import { computeWindow, nextScrollTop } from '../../src/tui/viewport.js';

describe('computeWindow', () => {
  test('shows everything when content fits', () => {
    expect(computeWindow(5, 10, 0, 0)).toEqual({ start: 0, end: 5 });
  });

  test('shows exactly height rows when content overflows', () => {
    const w = computeWindow(100, 10, 0, 0);
    expect(w.end - w.start).toBe(10);
  });

  test('never scrolls past the end', () => {
    const w = computeWindow(100, 10, 99, 500);
    expect(w.end).toBe(100);
    expect(w.start).toBe(90);
  });

  test('clamps a negative scrollTop', () => {
    expect(computeWindow(100, 10, 0, -5)).toEqual({ start: 0, end: 10 });
  });

  test('handles zero height without inverting', () => {
    const w = computeWindow(100, 0, 0, 0);
    expect(w.end).toBeGreaterThanOrEqual(w.start);
  });

  test('handles empty content', () => {
    expect(computeWindow(0, 10, 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('nextScrollTop', () => {
  test('does not scroll while the cursor is comfortably inside', () => {
    expect(nextScrollTop(100, 20, 10, 0, 3)).toBe(0);
  });

  test('scrolls down just enough when the cursor nears the bottom', () => {
    // height 20, margin 3 => cursor must stay <= scrollTop + 16
    expect(nextScrollTop(100, 20, 17, 0, 3)).toBe(1);
  });

  test('scrolls up just enough when the cursor nears the top', () => {
    expect(nextScrollTop(100, 20, 50, 49, 3)).toBe(47);
  });

  test('never returns a negative scrollTop', () => {
    expect(nextScrollTop(100, 20, 0, 0, 3)).toBe(0);
  });

  test('never scrolls past the last full page', () => {
    expect(nextScrollTop(100, 20, 99, 0, 3)).toBe(80);
  });

  test('returns 0 when content fits entirely', () => {
    expect(nextScrollTop(5, 20, 4, 0, 3)).toBe(0);
  });

  test('a jump to the top pulls scrollTop back to 0', () => {
    expect(nextScrollTop(100, 20, 0, 80, 3)).toBe(0);
  });
});
