import type { FindingType } from '../review/rubric.js';
import type { Side } from '../review/types.js';

export type Severity = 'blocking' | 'non-blocking';
export type Confidence = 'high' | 'medium' | 'low';
export type FindingKind = 'issue' | 'question';

export interface Finding {
  /** Stable local id derived from the anchor and title. Not sent to GitHub. */
  id: string;
  path: string;
  line: number;
  side: Side;
  startLine: number | null;
  severity: Severity;
  type: FindingType;
  kind: FindingKind;
  title: string;
  body: string;
  /** Concrete inputs or state, then what goes wrong. Null for cleanups and questions. */
  failureScenario: string | null;
  confidence: Confidence;
  /** Replacement code for a GitHub suggestion block, when the model offered one. */
  suggestion: string | null;
}

export type RawFinding = Omit<Finding, 'id'>;
