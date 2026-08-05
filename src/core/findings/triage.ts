import type { StagedComment } from '../review/types.js';
import type { VerifiedFinding } from './verify.js';

export type TriageState = 'pending' | 'accepted' | 'dropped';

export interface TriagedFinding extends VerifiedFinding {
  state: TriageState;
  /** The reviewer's own wording, when they rewrote the model's. */
  editedBody: string | null;
  asSuggestion: boolean;
}

export function initTriage(findings: VerifiedFinding[]): TriagedFinding[] {
  return findings.map((f) => ({ ...f, state: 'pending', editedBody: null, asSuggestion: false }));
}

function update(
  list: TriagedFinding[],
  id: string,
  change: (f: TriagedFinding) => TriagedFinding,
): TriagedFinding[] {
  return list.map((f) => (f.id === id ? change(f) : f));
}

export function accept(list: TriagedFinding[], id: string): TriagedFinding[] {
  return update(list, id, (f) => ({ ...f, state: 'accepted' }));
}

export function drop(list: TriagedFinding[], id: string): TriagedFinding[] {
  return update(list, id, (f) => ({ ...f, state: 'dropped' }));
}

/** Editing implies keeping — nobody rewrites a comment they intend to discard. */
export function edit(list: TriagedFinding[], id: string, body: string): TriagedFinding[] {
  return update(list, id, (f) => ({ ...f, editedBody: body, state: 'accepted' }));
}

export function toggleSuggestion(list: TriagedFinding[], id: string): TriagedFinding[] {
  return update(list, id, (f) => ({ ...f, asSuggestion: !f.asSuggestion }));
}

export function toStagedComments(list: TriagedFinding[]): StagedComment[] {
  return list
    .filter((f) => f.state === 'accepted')
    .map((f) => ({
      id: f.id,
      path: f.path,
      line: f.line,
      side: f.side,
      startLine: f.startLine,
      body: f.editedBody ?? f.body,
      suggestion: f.asSuggestion ? f.suggestion : null,
    }));
}

/**
 * Refuted findings collapse out of the default view but are never deleted — if
 * the verifier was wrong, the reviewer has to be able to see that it was.
 */
export function visibleFindings(
  list: TriagedFinding[],
  showRefuted: boolean,
): TriagedFinding[] {
  return showRefuted ? list : list.filter((f) => f.verdict !== 'refuted');
}
