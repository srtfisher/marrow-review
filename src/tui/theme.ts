/**
 * Colors carry meaning; they are never decoration.
 *
 * ANSI slot names (not hex) so the UI inherits the user's terminal theme.
 * A hardcoded `#3fb950` fights the background, contrast, and green/red pair
 * they already chose — and looks wrong in half of terminals.
 *
 * See .interface-design/system.md for the full rationale.
 */
export const color = {
  /** A diff addition. Nothing else is ever green. */
  add: 'green',
  /** A diff deletion. Nothing else is ever red. */
  del: 'red',
  /** Position and navigation: file marker, active pane, search query. */
  structure: 'cyan',
  /** Unsubmitted work. The one token allowed to nag. */
  pending: 'yellow',
  /** Model-authored content. Reserved so you can always tell what the model said. */
  agent: 'magenta',
  /** Failing checks and destructive confirms. */
  danger: 'red',
  /** Chrome: rules, folded markers, help hints. */
  chrome: 'gray',
} as const;

/**
 * Four text tiers. A terminal has exactly one type size, so hierarchy comes
 * from weight and color alone — the extreme case of the general rule that
 * weight and color out-perform size.
 *
 * Spread these onto an Ink <Text>: `<Text {...tier.primary}>`.
 */
export const tier = {
  /** The one thing per view that matters. Exactly one per screen. */
  primary: { bold: true },
  /** What you actually read: diff content, comment bodies. */
  secondary: {},
  /** Hunk headers, metadata, gutters. */
  tertiary: { dimColor: true },
  /** Structural chrome. */
  muted: { dimColor: true, color: color.chrome },
} as const;

/** Layout constants, named so they are decisions rather than magic numbers. */
export const layout = {
  /** Two right-aligned line-number columns; this medium's tabular numbers. */
  gutterWidth: 6,
  /** Cells in the meat gauge. */
  gaugeCells: 10,
} as const;

/** Glyphs. No emoji — cell width is unreliable across terminals and reads as toy. */
export const glyph = {
  /** Butcher's mark on the cut; also the eye's anchor when scrolling. */
  cut: '▍',
  cursor: '▸',
  /** A row inside a `V` selection. Thinner than `cut`, which marks a file. */
  selected: '▏',
  gaugeFull: '▇',
  gaugeEmpty: '▁',
  fold: '┄',
  /** Horizontal rules exist at exactly two hard boundaries; this is one. */
  hrule: '─',
  staged: '●',
  /** A loading step that finished, and one that did not. */
  done: '✓',
  failed: '✗',
  /** The list pane's selection marker, matching the reference project. */
  select: '❯',
} as const;

export const theme = { color, tier, layout, glyph } as const;
