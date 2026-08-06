import type { Verdict } from './types.js';

export const VERDICTS: readonly Verdict[] = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];

/**
 * GitHub refuses both an approval and a change request on your own pull
 * request, so the author of a PR is left with COMMENT and nothing else.
 */
export function blockedForAuthor(verdict: Verdict, viewerIsAuthor: boolean): boolean {
  return viewerIsAuthor && verdict !== 'COMMENT';
}

export function authorBlockReason(verdict: Verdict): string {
  const action = verdict === 'APPROVE' ? 'approve' : 'request changes on';
  return `cannot ${action} your own pull request — GitHub rejects it`;
}
