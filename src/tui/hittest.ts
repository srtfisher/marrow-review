import { computeWindow } from './viewport.js';

/**
 * Where a click landed.
 *
 * The layout is computed in one place — `App` — and drawn in another, so the
 * arithmetic that turns a terminal cell back into a row of content lives here
 * as plain functions over the numbers `App` already has. A hit test that
 * disagreed with the renderer by one row would put the cursor on the line above
 * the one the reviewer clicked, and `C` would comment there.
 */

export interface DetailGeometry {
  /** Rows the header block occupies before the diff starts. */
  headerRows: number;
  /** Rows the file-index grid occupies inside that header. */
  indexRows: number;
  indexColumns: number;
  indexCellWidth: number;
  /** Rows of diff on screen. */
  viewportRows: number;
  scrollTop: number;
  /** Rows in the whole diff. */
  totalRows: number;
  /** Cells the pane's content is inset from the left of the terminal. */
  paneLeft: number;
  /** Cells in the index, so a click past the last one is not a hit. */
  indexCells: number;
}

export type DetailHit =
  | { kind: 'diff-row'; index: number }
  | { kind: 'file-cell'; index: number };

/**
 * The file index sits directly above the blank row that separates the header
 * from the diff, which is the last of the four rows `detailHeaderRows` always
 * counts — so its top follows from the two numbers without having to know
 * whether a failing-checks or summary row is present.
 */
export function fileIndexTop(geometry: Pick<DetailGeometry, 'headerRows' | 'indexRows'>): number {
  return geometry.headerRows - geometry.indexRows - 1;
}

export function hitDetail(
  geometry: DetailGeometry,
  column: number,
  row: number,
): DetailHit | null {
  const {
    headerRows, indexRows, indexColumns, indexCellWidth,
    viewportRows, scrollTop, totalRows, paneLeft, indexCells,
  } = geometry;

  const x = column - paneLeft;
  if (x < 0) return null;

  // The diff. The window's own start, not the raw scrollTop: the renderer
  // clamps it, and reading it back the same way is what keeps them agreeing.
  if (row >= headerRows && row < headerRows + viewportRows) {
    const { start } = computeWindow(totalRows, viewportRows, 0, scrollTop);
    const index = start + (row - headerRows);
    return index < totalRows ? { kind: 'diff-row', index } : null;
  }

  // The file index, which is a map, so clicking a file on it goes there.
  const top = fileIndexTop(geometry);
  if (indexRows > 0 && row >= top && row < top + indexRows) {
    if (indexCellWidth <= 0) return null;
    const gridColumn = Math.floor(x / indexCellWidth);
    if (gridColumn >= indexColumns) return null;
    const index = (row - top) * indexColumns + gridColumn;
    return index < indexCells ? { kind: 'file-cell', index } : null;
  }

  return null;
}
