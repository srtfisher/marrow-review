import { test, expect, describe } from 'bun:test';
import { computeWindow, nextScrollTop, scrollBy, scrollToRow } from '../../src/tui/viewport.js';

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

describe('scrollToRow', () => {
  test('puts the row on the first line of the pane', () => {
    expect(scrollToRow(100, 20, 40)).toBe(40);
  });

  test('stops at the end of the content rather than scrolling into blank', () => {
    // Row 95 cannot reach the top of a 20-row pane over 100 rows; 80 is as far
    // as the diff goes, and the row is still on screen.
    expect(scrollToRow(100, 20, 95)).toBe(80);
  });

  test('does not scroll at all when the content fits', () => {
    expect(scrollToRow(5, 20, 4)).toBe(0);
  });

  test('never returns a negative offset', () => {
    expect(scrollToRow(100, 20, -5)).toBe(0);
  });

  test('survives a pane with no height', () => {
    expect(scrollToRow(100, 0, 40)).toBe(40);
    expect(scrollToRow(100, -5, 40)).toBe(40);
  });
});

describe('scrollBy', () => {
  test('moves the window by the delta', () => {
    expect(scrollBy(100, 20, 0, 10, 3).scrollTop).toBe(13);
    expect(scrollBy(100, 20, 0, 10, -3).scrollTop).toBe(7);
  });

  test('stops at both ends rather than running off them', () => {
    expect(scrollBy(100, 20, 0, 2, -9).scrollTop).toBe(0);
    expect(scrollBy(100, 20, 0, 78, 9).scrollTop).toBe(80);
  });

  test('leaves a cursor that is still on screen exactly where it was', () => {
    // Window moves to rows 13-32; the cursor at 20 is inside it and must not
    // move, or scrolling would silently retarget what `C` comments on.
    expect(scrollBy(100, 20, 20, 10, 3).cursor).toBe(20);
  });

  test('drags the cursor along rather than leaving it off screen', () => {
    // Scrolled down past it: the cursor lands on the new top row.
    expect(scrollBy(100, 20, 5, 0, 30)).toEqual({ scrollTop: 30, cursor: 30 });
    // Scrolled up past it: the cursor lands on the new bottom row.
    expect(scrollBy(100, 20, 90, 80, -40)).toEqual({ scrollTop: 40, cursor: 59 });
  });

  test('never puts the cursor past the last row of a diff shorter than the pane', () => {
    expect(scrollBy(5, 20, 4, 0, 3)).toEqual({ scrollTop: 0, cursor: 4 });
  });

  test('does not invent a cursor for an empty pane', () => {
    expect(scrollBy(0, 20, 0, 0, 3)).toEqual({ scrollTop: 0, cursor: 0 });
    expect(scrollBy(100, 0, 7, 0, 3)).toEqual({ scrollTop: 0, cursor: 7 });
  });
});
