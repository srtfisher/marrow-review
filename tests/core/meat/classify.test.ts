import { test, expect } from 'bun:test';
import {
  chunkHunks, classifyHunks, renderHunk, CLASSIFY_SCHEMA, MAX_HUNK_LINES,
} from '../../../src/core/meat/classify.js';
import { FakeTransport } from '../../../src/core/agent/fake.js';
import type { AgentRequest, AgentRun, AgentTransport } from '../../../src/core/agent/types.js';
import type { Hunk } from '../../../src/core/diff/types.js';

/** Fails the first `failures` runs, then delegates to a FakeTransport queue. */
class FlakyTransport implements AgentTransport {
  readonly requests: AgentRequest[] = [];
  private calls = 0;

  constructor(
    private readonly failures: number,
    private readonly inner = new FakeTransport(),
  ) {}

  queue(run: Partial<AgentRun>): void {
    this.inner.queue(run);
  }

  async run(req: AgentRequest): Promise<AgentRun> {
    this.requests.push(req);
    if (this.calls++ < this.failures) {
      throw new Error('SDK subprocess exited');
    }
    return this.inner.run(req);
  }
}

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

test('a hunk the model omits defaults to kept, marked synthetic', async () => {
  const transport = new FakeTransport();
  transport.queue({ structured: { summary: 's', verdicts: [] } });

  const result = await classifyHunks(transport, 'sonnet', 'T', 'B', items, 100_000);

  expect(result.verdicts.get('h1')).toEqual({
    keep: true,
    reason: 'not classified; kept by default',
    synthetic: true,
  });
});

test('a failing transport keeps its hunks instead of rejecting', async () => {
  const transport = new FlakyTransport(1);

  const result = await classifyHunks(transport, 'sonnet', 'T', 'B', items, 100_000);

  for (const id of ['h1', 'h2']) {
    expect(result.verdicts.get(id)).toEqual({
      keep: true,
      reason: 'classification failed',
      synthetic: true,
    });
  }
});

test('verdicts from a chunk that succeeded survive a sibling chunk failing', async () => {
  // maxChars 60 puts each hunk in its own chunk; the first run throws.
  const transport = new FlakyTransport(1);
  transport.queue({
    structured: { summary: 'Adds a constant.', verdicts: [{ id: 'h2', keep: false, reason: 'trivial' }] },
  });

  const result = await classifyHunks(transport, 'sonnet', 'T', 'B', items, 60);

  expect(transport.requests).toHaveLength(2);
  expect(result.summary).toBe('Adds a constant.');
  expect(result.verdicts.get('h2')).toEqual({ keep: false, reason: 'trivial' });
  expect(result.verdicts.get('h1')).toEqual({
    keep: true,
    reason: 'classification failed',
    synthetic: true,
  });
});

function manyLineHunk(lines: number): Hunk {
  return {
    header: `@@ -1,${lines} +1,${lines} @@`,
    section: '', oldStart: 1, oldLines: lines, newStart: 1, newLines: lines,
    lines: Array.from({ length: lines }, (_, i) => ({
      kind: 'add' as const, text: `paragraph ${i}`, oldLine: null, newLine: i + 1,
      noNewlineAtEof: false,
    })),
  };
}

test('a chunk is capped by hunk count, not only by characters', () => {
  // The failure this prevents: one run asked for sixty verdicts returned a
  // handful and no error, so every hunk it skipped was kept by fallback and a
  // seventeen-file pull request came out abridged to 1038 of 1040 lines.
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `h${i}`, filePath: 'a.ts', hunk: hunk('short'),
  }));
  const chunks = chunkHunks(many, 1_000_000, 15);

  expect(chunks.length).toBe(3);
  for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(15);
  expect(chunks.flat().map((i) => i.id)).toEqual(many.map((i) => i.id));
});

test('a very long hunk is elided for the classifier, not sent whole', () => {
  const rendered = renderHunk({ id: 'h1', filePath: 'docs/design.md', hunk: manyLineHunk(900) });

  // The verdict is "does a reviewer need to read this", which nine hundred
  // lines of prose does not answer any better than eighty do.
  expect(rendered).toContain('paragraph 0');
  expect(rendered).toContain('paragraph 899');
  expect(rendered).toContain('more lines of this hunk elided');
  expect(rendered.split('\n').length).toBeLessThan(MAX_HUNK_LINES + 6);
});

test('a short hunk is sent whole, with nothing elided', () => {
  const rendered = renderHunk({ id: 'h1', filePath: 'a.ts', hunk: manyLineHunk(10) });
  expect(rendered).not.toContain('elided');
  for (let i = 0; i < 10; i += 1) expect(rendered).toContain(`paragraph ${i}`);
});

test('the prompt names every id it expects back', async () => {
  const transport = new FakeTransport();
  transport.queue({ structured: { summary: 's', verdicts: [] } });
  await classifyHunks(transport, 'opus', 'Title', '', items);

  const prompt = transport.requests[0]!.prompt;
  expect(prompt).toContain('There are 2 hunks');
  expect(prompt).toContain('h1, h2');
  expect(prompt).toContain('Return exactly 2 verdicts');
});
