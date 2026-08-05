import type { ReactNode } from 'react';
import { Box } from 'ink';
import { computeRowWindow, computeWindow } from '../viewport.js';

export interface ViewportProps {
  items: ReactNode[];
  /** Budget in terminal ROWS, not in items. */
  height: number;
  cursor: number;
  scrollTop: number;
  /**
   * Rows each item occupies. Omit when every item is the same height and
   * `height` can be read as a count — the pull-request list works that way.
   * Supply it and both the slice and `scrollTop` are measured in rows.
   */
  itemHeights?: readonly number[];
}

/** Renders only the visible slice. Keeps large diffs from re-rendering wholesale. */
export function Viewport({ items, height, cursor, scrollTop, itemHeights }: ViewportProps) {
  if (!itemHeights) {
    const { start, end } = computeWindow(items.length, height, cursor, scrollTop);
    return (
      <Box flexDirection="column">
        {items.slice(start, end).map((item, i) => (
          <Box key={start + i}>{item}</Box>
        ))}
      </Box>
    );
  }

  const { start, end } = computeRowWindow(itemHeights, height, scrollTop);
  // A single item taller than the whole budget is still emitted, so the pane is
  // never blank; the fixed height and hidden overflow are what stop it from
  // shoving the horizontal rule and the status bar off the bottom of the screen.
  return (
    <Box flexDirection="column" height={Math.max(0, height)} flexShrink={0} overflow="hidden">
      {items.slice(start, end).map((item, i) => (
        <Box key={start + i} flexShrink={0}>{item}</Box>
      ))}
    </Box>
  );
}
