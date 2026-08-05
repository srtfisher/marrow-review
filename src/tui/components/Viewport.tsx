import type { ReactNode } from 'react';
import { Box } from 'ink';
import { computeWindow } from '../viewport.js';

export interface ViewportProps {
  items: ReactNode[];
  height: number;
  cursor: number;
  scrollTop: number;
}

/** Renders only the visible slice. Keeps large diffs from re-rendering wholesale. */
export function Viewport({ items, height, cursor, scrollTop }: ViewportProps) {
  const { start, end } = computeWindow(items.length, height, cursor, scrollTop);
  return (
    <Box flexDirection="column">
      {items.slice(start, end).map((item, i) => (
        <Box key={start + i}>{item}</Box>
      ))}
    </Box>
  );
}
