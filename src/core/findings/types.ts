import type { Side } from '../review/types.js';

export type Severity = 'critical' | 'important' | 'minor';
export type Confidence = 'high' | 'medium' | 'low';

export interface Finding {
  /** Stable local id derived from the anchor and title. Not sent to GitHub. */
  id: string;
  path: string;
  line: number;
  side: Side;
  startLine: number | null;
  severity: Severity;
  title: string;
  body: string;
  confidence: Confidence;
  /** Replacement code for a GitHub suggestion block, when the model offered one. */
  suggestion: string | null;
}

export type RawFinding = Omit<Finding, 'id'>;
