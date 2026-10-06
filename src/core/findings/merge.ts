import type { Finding } from './types.js';

/** Lines apart that two findings may sit and still be the same point. */
export const MERGE_DISTANCE = 3;

const CONFIDENCE = { low: 0, medium: 1, high: 2 } as const;

function samePoint(a: Finding, b: Finding): boolean {
  return a.path === b.path && a.side === b.side && a.type === b.type && Math.abs(a.line - b.line) <= MERGE_DISTANCE;
}

function combine(a: Finding, b: Finding): Finding {
  const lead = a.severity === 'blocking' || b.severity !== 'blocking' ? a : b;
  const other = lead === a ? b : a;
  return {
    ...lead,
    severity: a.severity === 'blocking' || b.severity === 'blocking' ? 'blocking' : 'non-blocking',
    kind: a.kind === 'issue' || b.kind === 'issue' ? 'issue' : 'question',
    body: other.body.length > lead.body.length ? other.body : lead.body,
    failureScenario: lead.failureScenario ?? other.failureScenario,
    suggestion: lead.suggestion ?? other.suggestion,
    confidence: CONFIDENCE[a.confidence] >= CONFIDENCE[b.confidence] ? a.confidence : b.confidence,
    lenses: [...new Set([...lead.lenses, ...other.lenses])],
  };
}

/**
 * Reviewers overlap: the bug scan and the history reviewer often land on the same
 * line. One point is one card, crediting every reviewer that raised it, so the
 * reviewer does not triage it twice and the scorer does not pay for it twice.
 */
export function mergeFindings(findings: readonly Finding[]): Finding[] {
  const merged: Finding[] = [];
  for (const f of findings) {
    const i = merged.findIndex((m) => samePoint(m, f));
    if (i === -1) merged.push(f);
    else merged[i] = combine(merged[i]!, f);
  }
  return merged;
}
