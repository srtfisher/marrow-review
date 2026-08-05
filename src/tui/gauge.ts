import { theme } from './theme.js';

/**
 * Kept-versus-dropped as one glyph run: the whole thesis of the tool, ten cells wide.
 *
 * Clamped at both ends on purpose. Rounding 1-of-1000 down to zero cells would
 * read as "nothing was kept", and rounding 999-of-1000 up to full would read as
 * "nothing was dropped" — both are lies, and this gauge is the main thing a
 * reviewer glances at to judge how much work is ahead.
 */
export function meatGauge(kept: number, total: number): string {
  const cells = theme.layout.gaugeCells;
  if (total <= 0) return theme.glyph.gaugeEmpty.repeat(cells);

  let filled = Math.round((kept / total) * cells);
  if (kept > 0 && filled === 0) filled = 1;
  if (kept < total && filled === cells) filled = cells - 1;
  filled = Math.min(Math.max(filled, 0), cells);

  return theme.glyph.gaugeFull.repeat(filled) + theme.glyph.gaugeEmpty.repeat(cells - filled);
}
