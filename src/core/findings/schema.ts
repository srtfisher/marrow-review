import { FINDING_TYPES } from '../review/rubric.js';

export const FINDINGS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'path', 'line', 'side', 'severity', 'type', 'kind', 'title', 'body',
          'failureScenario', 'confidence',
        ],
        properties: {
          path: { type: 'string' },
          line: { type: 'integer', description: 'Line number in the side indicated below.' },
          side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
          startLine: { type: ['integer', 'null'], description: 'First line of a multi-line range, else null.' },
          severity: { type: 'string', enum: ['blocking', 'non-blocking'], description: 'Questions are always non-blocking.' },
          type: { type: 'string', enum: [...FINDING_TYPES] },
          kind: { type: 'string', enum: ['issue', 'question'] },
          title: { type: 'string', description: 'One short clause, at most 80 characters.' },
          body: { type: 'string', description: 'Mechanism and consequence, in markdown. For a question, the question.' },
          failureScenario: {
            type: ['string', 'null'],
            description: 'Required for Correctness and Security issues: concrete inputs or state, then the wrong result. Null for cleanups and questions.',
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          suggestion: { type: ['string', 'null'], description: 'Exact replacement text for the anchored line range, or null.' },
        },
      },
    },
  },
};
