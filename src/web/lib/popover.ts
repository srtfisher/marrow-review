const GUTTER = 16;

/**
 * Which edge of its button a popover hangs from. Left when it fits, otherwise
 * right — the header wraps, so the same button can sit anywhere on the row,
 * and a fixed side pushed the panel off the page and the page sideways.
 */
export function popoverAlign(buttonLeft: number, buttonRight: number, width: number, viewport: number): 'left' | 'right' {
  if (buttonLeft + width <= viewport - GUTTER) return 'left';
  if (buttonRight - width >= GUTTER) return 'right';
  return buttonLeft > viewport - buttonRight ? 'right' : 'left';
}
