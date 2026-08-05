import type { ReactNode } from 'react';
import { Box } from 'ink';
import { computeWindow } from '../viewport.js';

export interface ViewportProps {
  /** One item per row of the pane. Never more than one line each. */
  items: ReactNode[];
  height: number;
  cursor: number;
  scrollTop: number;
}

/**
 * Renders only the visible slice. Keeps large diffs from re-rendering wholesale.
 *
 * Items are single rows, which is why this is a plain slice. It used to accept
 * variable-height items and window on whole ones, and that could not hold: a
 * thousand-line hunk is one item, so the pane could show it alone or not at all.
 */
export function Viewport({ items, height, cursor, scrollTop }: ViewportProps) {
  const { start, end } = computeWindow(items.length, height, cursor, scrollTop);
  return (
    <Box flexDirection="column" flexShrink={0} overflow="hidden">
      {items.slice(start, end).map((item, i) => (
        <Box key={start + i} flexShrink={0}>{item}</Box>
      ))}
    </Box>
  );
}
