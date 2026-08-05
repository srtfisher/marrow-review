import { test, expect } from 'bun:test';
import { chunkHunks, classifyHunks, CLASSIFY_SCHEMA } from '../../../src/core/meat/classify.js';
import { FakeTransport } from '../../../src/core/agent/fake.js';
import type { Hunk } from '../../../src/core/diff/types.js';

function hunk(text: string): Hunk {
  return {
    header: '@@ -1,1 +1,1 @@',
    section: '',
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: [{ kind: 'add', text, oldLine: null, newLine: 1, noNewlineAtEof: false }],
  };
}

const items = [
  { id: 'h1', filePath: 'a.ts', hunk: hunk('const a = 1;') },
  { id: 'h2', filePath: 'b.ts', hunk: hunk('const b = 2;') },
];

test('schema requires a summary and per-hunk verdicts', () => {
  expect(CLASSIFY_SCHEMA['type']).toBe('object');
  const required = CLASSIFY_SCHEMA['required'] as string[];
  expect(required).toContain('summary');
  expect(required).toContain('verdicts');
});

test('chunks never split a hunk and respect the char budget', () => {
  const big = [
    { id: 'a', filePath: 'a.ts', hunk: hunk('x'.repeat(400)) },
    { id: 'b', filePath: 'b.ts', hunk: hunk('y'.repeat(400)) },
    { id: 'c', filePath: 'c.ts', hunk: hunk('z'.repeat(400)) },
  ];
  const chunks = chunkHunks(big, 900);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.flat().map((i) => i.id)).toEqual(['a', 'b', 'c']);
  for (const chunk of chunks) expect(chunk.length).toBeGreaterThan(0);
});

test('an oversized single hunk still gets its own chunk', () => {
  const chunks = chunkHunks([{ id: 'a', filePath: 'a.ts', hunk: hunk('x'.repeat(5000)) }], 100);
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!).toHaveLength(1);
});

test('merges verdicts across chunks and keeps the first summary', async () => {
  const transport = new FakeTransport();
  transport.queue({
    structured: {
      summary: 'Adds two constants.',
      verdicts: [{ id: 'h1', keep: true, reason: 'new public constant' }],
    },
  });
  transport.queue({
    structured: {
      summary: 'second summary',
      verdicts: [{ id: 'h2', keep: false, reason: 'trivial' }],
    },
  });

  const result = await classifyHunks(transport, 'sonnet', 'Title', 'Body', items, 60);

  expect(result.summary).toBe('Adds two constants.');
  expect(result.verdicts.get('h1')).toEqual({ keep: true, reason: 'new public constant' });
  expect(result.verdicts.get('h2')).toEqual({ keep: false, reason: 'trivial' });
  expect(transport.requests).toHaveLength(2);
  expect(transport.requests[0]!.model).toBe('sonnet');
  expect(transport.requests[0]!.schema).toBe(CLASSIFY_SCHEMA);
});

test('a hunk the model omits defaults to kept', async () => {
  const transport = new FakeTransport();
  transport.queue({ structured: { summary: 's', verdicts: [] } });

  const result = await classifyHunks(transport, 'sonnet', 'T', 'B', items, 100_000);

  expect(result.verdicts.get('h1')).toEqual({
    keep: true,
    reason: 'not classified; kept by default',
  });
});
