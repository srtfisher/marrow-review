import { test, expect, describe } from 'bun:test';
import {
  fileIndexGeometry, fileIndexRows, indexLabels, layoutFileIndex, truncatePath,
  type FileIndexEntry,
} from '../../src/tui/fileindex.js';

function entry(path: string, over: Partial<FileIndexEntry> = {}): FileIndexEntry {
  return { path, dropped: false, reviewed: false, current: false, ...over };
}

describe('indexLabels', () => {
  test('uses the file name, which is what anyone calls a file', () => {
    expect(indexLabels([
      'packages/billing/src/Http/Controllers/Organization/AccountSettingsController.php',
      'routes/web.php',
    ])).toEqual(['AccountSettingsController.php', 'web.php']);
  });

  test('gives a repeated name its parent directory back, and only that one', () => {
    expect(indexLabels([
      'resources/js/pages/audience/index.tsx',
      'resources/js/pages/settings/index.tsx',
      'routes/web.php',
    ])).toEqual(['audience/index.tsx', 'settings/index.tsx', 'web.php']);
  });

  test('a name with no directory is left alone', () => {
    expect(indexLabels(['README.md'])).toEqual(['README.md']);
  });
});

describe('truncatePath', () => {
  test('keeps the tail, because the end of a path is what identifies it', () => {
    expect(truncatePath('packages/billing/src/Thing.php', 12)).toBe('…c/Thing.php');
  });

  test('leaves anything that already fits', () => {
    expect(truncatePath('web.php', 12)).toBe('web.php');
  });

  test('degrades rather than throwing at absurd widths', () => {
    expect(truncatePath('web.php', 1)).toBe('…');
    expect(truncatePath('web.php', 0)).toBe('');
  });
});

describe('layoutFileIndex', () => {
  const paths = Array.from({ length: 17 }, (_, i) => `src/module${i}/file${i}.ts`);

  test('lists every file when they fit, which is almost always', () => {
    const index = layoutFileIndex(paths.map((p) => entry(p)), 120);
    expect(index.hidden).toBe(0);
    expect(index.grid.flat()).toHaveLength(17);
    // `file16.ts` is nine characters, so six of them fit across 120 columns and
    // 17 files is three rows — a header, not a second pane.
    expect(index.grid).toHaveLength(3);
    // And the block is only as wide as the names need: 84 columns of the 120,
    // not four cells padded out to 30 apiece.
    expect(index.columns * index.cellWidth).toBe(84);
  });

  test('never silently truncates: the overflow cell says how many it dropped', () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(`src/f${i}.ts`));
    const index = layoutFileIndex(many, 120, 3);
    expect(index.hidden).toBeGreaterThan(0);
    expect(index.grid.flat().at(-1)!.text).toContain(`+${index.hidden} more`);
    expect(index.grid.flat()).toHaveLength(index.columns * 3);
  });

  // Short names make narrow columns, and the overflow label is the one whose
  // meaning is at the front — tail-truncating it produced `… more`, a cell that
  // says something was left out but not how much.
  test('keeps the overflow count readable however short the names are', () => {
    for (const width of [30, 60, 120, 230]) {
      const many = Array.from({ length: 90 }, (_, i) => entry(`src/f${i}.ts`));
      const index = layoutFileIndex(many, width, 3);
      const last = index.grid.flat().at(-1)!;
      expect(index.hidden).toBeGreaterThan(0);
      expect(last.text.trim()).toStartWith(`+${index.hidden}`);
    }
  });

  test('marks the current file and checks off the reviewed ones', () => {
    const index = layoutFileIndex([
      entry('a.ts', { current: true }),
      entry('b.ts', { reviewed: true }),
      entry('c.ts'),
    ], 120);
    const cells = index.grid.flat();
    expect(cells[0]!.cursor).toBe('▸');
    expect(cells[0]!.check).toBe(' ');
    expect(cells[1]!.cursor).toBe(' ');
    expect(cells[1]!.check).toBe('✓');
    expect(cells[2]!.text.trim()).toBe('c.ts');
  });

  test('every cell in a row is the same width, so the columns line up', () => {
    const index = layoutFileIndex(paths.map((p) => entry(p)), 120);
    for (const row of index.grid) {
      for (const cell of row) expect(cell.text).toHaveLength(index.cellWidth);
    }
  });

  test('handles a pull request with no files at all', () => {
    expect(layoutFileIndex([], 120).grid).toEqual([]);
    expect(fileIndexRows([], 120)).toBe(0);
  });
});

describe('fileIndexGeometry', () => {
  const LONG = 'AccountSettingsController.php'; // 29 characters

  test('collapses to one column rather than shredding names on a narrow pane', () => {
    expect(fileIndexGeometry([LONG], 40).columns).toBe(1);
  });

  // The bug this replaced: four cells each a quarter of the terminal, so
  // `app.css` sat in a 57-column cell and the grid read as four unrelated lists.
  test('sizes the cell to the longest name, not to a share of the width', () => {
    const short = fileIndexGeometry(['app.css', 'ssr.tsx'], 230);
    expect(short.labelWidth).toBe(7);
    expect(short.cellWidth).toBe(12);
    // Six columns of 12 is 72 of the 230 available, and that is correct: the
    // index is a block, and the width it does not need it does not take.
    expect(short.columns).toBe(6);
  });

  test('spends spare width on more columns, up to the six a row can be scanned in', () => {
    expect(fileIndexGeometry([LONG], 120).columns).toBe(4);
    expect(fileIndexGeometry([LONG], 230).columns).toBe(6);
    expect(fileIndexGeometry([LONG], 2000).columns).toBe(6);
  });

  test('never takes more columns than leave a readable name', () => {
    for (const width of [20, 40, 60, 90, 120, 200, 400]) {
      const geo = fileIndexGeometry([LONG], width);
      expect(geo.columns * geo.cellWidth).toBeLessThanOrEqual(width);
      expect(geo.labelWidth).toBeGreaterThan(0);
      if (geo.columns > 1) expect(geo.labelWidth).toBeGreaterThanOrEqual(24);
    }
  });

  test('a pane too narrow for even one readable name still renders something', () => {
    const geo = fileIndexGeometry([LONG], 8);
    expect(geo.columns).toBe(1);
    expect(geo.labelWidth).toBeGreaterThan(0);
  });
});

describe('fileIndexRows agrees with what layoutFileIndex draws', () => {
  test('across file counts and widths, because the pane budgets on it', () => {
    // Long names and short ones both: the column count depends on how long the
    // labels are now, so a mismatch would only show up on one of the two.
    const shapes = {
      short: (i: number) => `src/f${i}.ts`,
      long: (i: number) => `packages/billing/src/Http/Controllers/LongSettingsController${i}.php`,
    };
    for (const name of Object.values(shapes)) {
      for (const width of [40, 60, 90, 120, 200, 230, 400]) {
        for (const count of [0, 1, 3, 7, 17, 33, 60]) {
          const paths = Array.from({ length: count }, (_, i) => name(i));
          expect(fileIndexRows(paths, width))
            .toBe(layoutFileIndex(paths.map((p) => entry(p)), width).grid.length);
        }
      }
    }
  });
});
