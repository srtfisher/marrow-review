import { test, expect, describe } from 'bun:test';
import { fileIndexTop, hitDetail, type DetailGeometry } from '../../src/tui/hittest.js';

/**
 * A pane with a six-row header — title, meta, gauge, two rows of file index, and
 * the blank row — over a twenty-row window onto a two-hundred-row diff.
 */
const geometry: DetailGeometry = {
  headerRows: 6,
  indexRows: 2,
  indexColumns: 4,
  indexCellWidth: 30,
  indexCells: 7,
  viewportRows: 20,
  scrollTop: 0,
  totalRows: 200,
  paneLeft: 1,
};

describe('fileIndexTop', () => {
  // Derived rather than passed in, so it cannot drift from the header's height.
  test('puts the grid directly above the blank row that ends the header', () => {
    expect(fileIndexTop(geometry)).toBe(3);
  });
});

describe('hitDetail', () => {
  test('turns the first row of the window into the first row of the diff', () => {
    expect(hitDetail(geometry, 10, 6)).toEqual({ kind: 'diff-row', index: 0 });
  });

  test('counts down the window, and offsets by what is scrolled past', () => {
    expect(hitDetail(geometry, 10, 11)).toEqual({ kind: 'diff-row', index: 5 });
    expect(hitDetail({ ...geometry, scrollTop: 40 }, 10, 11))
      .toEqual({ kind: 'diff-row', index: 45 });
  });

  // The renderer clamps the offset it draws from; reading it back any other way
  // is a cursor one row off the line the reviewer clicked.
  test('clamps the same way the renderer does when scrollTop runs past the end', () => {
    const hit = hitDetail({ ...geometry, scrollTop: 9999 }, 10, 6);
    expect(hit).toEqual({ kind: 'diff-row', index: 180 });
  });

  test('a click below the last row of a short diff is not a row', () => {
    expect(hitDetail({ ...geometry, totalRows: 3 }, 10, 6))
      .toEqual({ kind: 'diff-row', index: 0 });
    expect(hitDetail({ ...geometry, totalRows: 3 }, 10, 10)).toBeNull();
  });

  test('the header above the index is not a hit, nor is the blank row', () => {
    for (const row of [0, 1, 2, 5]) expect(hitDetail(geometry, 10, row)).toBeNull();
  });

  test('the rows past the bottom of the window are not hits', () => {
    expect(hitDetail(geometry, 10, 25)).toEqual({ kind: 'diff-row', index: 19 });
    expect(hitDetail(geometry, 10, 26)).toBeNull();
  });

  test('resolves a cell on the file index, which is a map you can click', () => {
    // Row 3 is the grid's first row; four columns of thirty, offset by the pane.
    expect(hitDetail(geometry, 1, 3)).toEqual({ kind: 'file-cell', index: 0 });
    expect(hitDetail(geometry, 31, 3)).toEqual({ kind: 'file-cell', index: 1 });
    expect(hitDetail(geometry, 91, 3)).toEqual({ kind: 'file-cell', index: 3 });
    // Second row of the grid picks up where the first left off.
    expect(hitDetail(geometry, 1, 4)).toEqual({ kind: 'file-cell', index: 4 });
  });

  test('a click past the last cell of a ragged final row is not a cell', () => {
    expect(hitDetail(geometry, 91, 4)).toBeNull();
  });

  test('a click past the last column is not a cell, however wide the terminal', () => {
    expect(hitDetail(geometry, 121, 3)).toBeNull();
  });

  test('a click left of the pane belongs to the sidebar, not here', () => {
    expect(hitDetail({ ...geometry, paneLeft: 34 }, 12, 6)).toBeNull();
    expect(hitDetail({ ...geometry, paneLeft: 34 }, 34, 6))
      .toEqual({ kind: 'diff-row', index: 0 });
  });

  test('a pull request with no file index has no cells to hit', () => {
    const flat = { ...geometry, indexRows: 0, indexCells: 0, headerRows: 4 };
    expect(hitDetail(flat, 10, 3)).toBeNull();
    expect(hitDetail(flat, 10, 4)).toEqual({ kind: 'diff-row', index: 0 });
  });
});
