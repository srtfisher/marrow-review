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
        required: ['path', 'line', 'side', 'severity', 'title', 'body', 'confidence'],
        properties: {
          path: { type: 'string' },
          line: { type: 'integer', description: 'Line number in the side indicated below.' },
          side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
          startLine: { type: ['integer', 'null'] },
          severity: { type: 'string', enum: ['critical', 'important', 'minor'] },
          title: { type: 'string', description: 'One short clause.' },
          body: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          suggestion: { type: ['string', 'null'] },
        },
      },
    },
  },
};
