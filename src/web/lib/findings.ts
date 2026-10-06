import type { TriagedFinding } from './types.js';

/** At or above the line, or never scored. Mirrors the core's `isShown`; the page may not import core values. */
export function isShown(finding: Pick<TriagedFinding, 'score'>, threshold: number): boolean {
  return finding.score === null || finding.score >= threshold;
}

export function isLow(finding: Pick<TriagedFinding, 'score'>, threshold: number): boolean {
  return !isShown(finding, threshold);
}

export type ScoreTone = 'success' | 'attention' | 'muted';

export function scoreTone(score: number, threshold: number): ScoreTone {
  if (score < threshold) return 'muted';
  return score >= 90 ? 'success' : 'attention';
}
