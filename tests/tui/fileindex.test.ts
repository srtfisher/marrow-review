import { test, expect, describe } from 'bun:test';
import {
  fileIndexColumns, fileIndexRows, indexLabels, layoutFileIndex, truncatePath,
  type FileIndexEntry,
} from '../../src/tui/fileindex.js';

function entry(path: string, over: Partial<FileIndexEntry> = {}): FileIndexEntry {
  return { path, dropped: false, reviewed: false, current: false, ...over };
}

describe('indexLabels', () => {
  test('uses the file name, which is what anyone calls a file', () => {
    expect(indexLabels([
      'packages/allegro-cpm/src/Http/Controllers/Organization/RevCRMSettingsController.php',
      'routes/web.php',
    ])).toEqual(['RevCRMSettingsController.php', 'web.php']);
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
    expect(truncatePath('packages/allegro/src/Thing.php', 12)).toBe('…c/Thing.php');
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
    // 17 files in four columns is five rows — a header, not a second pane.
    expect(index.grid).toHaveLength(5);
  });

  test('never silently truncates: the overflow cell says how many it dropped', () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(`src/f${i}.ts`));
    const index = layoutFileIndex(many, 120, 3);
    expect(index.hidden).toBeGreaterThan(0);
    expect(index.grid.flat().at(-1)!.text).toContain(`+${index.hidden} more`);
    expect(index.grid.flat()).toHaveLength(12);
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

  test('collapses to one column rather than shredding names on a narrow pane', () => {
    expect(fileIndexColumns(40)).toBe(1);
    expect(fileIndexColumns(120)).toBe(4);
    // Capped: a very wide terminal does not get eight columns of nothing.
    expect(fileIndexColumns(400)).toBe(4);
  });

  test('handles a pull request with no files at all', () => {
    expect(layoutFileIndex([], 120).grid).toEqual([]);
    expect(fileIndexRows(0, 120)).toBe(0);
  });
});

describe('fileIndexRows agrees with what layoutFileIndex draws', () => {
  test('across file counts and widths, because the pane budgets on it', () => {
    for (const width of [40, 60, 90, 120, 200]) {
      for (const count of [0, 1, 3, 7, 17, 33, 60]) {
        const entries = Array.from({ length: count }, (_, i) => entry(`src/f${i}.ts`));
        expect(fileIndexRows(count, width)).toBe(layoutFileIndex(entries, width).grid.length);
      }
    }
  });
});
