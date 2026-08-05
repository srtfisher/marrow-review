import { test, expect, describe } from 'bun:test';
import { meatGauge } from '../../src/tui/gauge.js';
import { theme } from '../../src/tui/theme.js';

describe('theme', () => {
  test('contains no hex colors — ANSI slots only, so it inherits the terminal theme', () => {
    for (const value of Object.values(theme.color)) {
      expect(value).not.toMatch(/^#/);
    }
  });

  test('exposes the four text tiers the design system requires', () => {
    expect(theme.tier.primary).toEqual({ bold: true });
    expect(theme.tier.secondary).toEqual({});
    expect(theme.tier.tertiary.dimColor).toBe(true);
    expect(theme.tier.muted.dimColor).toBe(true);
  });

  test('reserves a token for model-authored content', () => {
    // Nothing else may use this color: it is how the reviewer tells the model's
    // words from their colleagues'.
    expect(theme.color.agent).toBeDefined();
    expect(theme.color.agent).not.toBe(theme.color.add);
    expect(theme.color.agent).not.toBe(theme.color.del);
    expect(theme.color.agent).not.toBe(theme.color.structure);
  });

  test('uses no emoji in its glyphs', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}]/u;
    for (const value of Object.values(theme.glyph)) {
      expect(value).not.toMatch(emoji);
    }
  });
});

describe('meatGauge', () => {
  test('fills proportionally to kept lines', () => {
    // 59/106 = 5.57 cells, which rounds to 6 — not 5.
    expect(meatGauge(59, 106)).toBe('▇▇▇▇▇▇▁▁▁▁');
    expect(meatGauge(50, 100)).toBe('▇▇▇▇▇▁▁▁▁▁');
    expect(meatGauge(0, 100)).toBe('▁▁▁▁▁▁▁▁▁▁');
    expect(meatGauge(100, 100)).toBe('▇▇▇▇▇▇▇▇▇▇');
  });

  test('shows at least one filled cell when anything was kept', () => {
    // Rounding 1/1000 to zero would read as "nothing kept", which is a lie.
    expect(meatGauge(1, 1000)).toBe('▇▁▁▁▁▁▁▁▁▁');
  });

  test('shows at least one empty cell when anything was dropped', () => {
    expect(meatGauge(999, 1000)).toBe('▇▇▇▇▇▇▇▇▇▁');
  });

  test('is empty rather than full when there is nothing to measure', () => {
    expect(meatGauge(0, 0)).toBe('▁▁▁▁▁▁▁▁▁▁');
  });

  test('always renders exactly the configured number of cells', () => {
    for (let kept = 0; kept <= 50; kept += 1) {
      expect(meatGauge(kept, 50)).toHaveLength(theme.layout.gaugeCells);
    }
  });
});
