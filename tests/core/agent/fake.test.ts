import { test, expect } from 'bun:test';
import { FakeTransport } from '../../../src/core/agent/fake.js';

test('returns queued runs in order and records requests', async () => {
  const transport = new FakeTransport();
  transport.queue({ structured: { verdicts: [] }, text: 'first' });
  transport.queue({ text: 'second' });

  const a = await transport.run({ prompt: 'p1', model: 'sonnet' });
  const b = await transport.run({ prompt: 'p2', model: 'opus' });

  expect(a.text).toBe('first');
  expect(a.structured).toEqual({ verdicts: [] });
  expect(b.text).toBe('second');
  expect(transport.requests.map((r) => r.prompt)).toEqual(['p1', 'p2']);
  expect(transport.requests[1]!.model).toBe('opus');
});

test('throws when the queue is exhausted so tests fail loudly', async () => {
  const transport = new FakeTransport();
  await expect(transport.run({ prompt: 'p', model: 'opus' })).rejects.toThrow(
    /FakeTransport queue is empty/,
  );
});
