import { test, expect, describe } from 'bun:test';
import { totalUsage, UsageMeter } from '../../../src/core/agent/meter.js';
import { FakeTransport } from '../../../src/core/agent/fake.js';
import { AgentRunError, EMPTY_USAGE, type AgentRun, type AgentTransport } from '../../../src/core/agent/types.js';

const usage = (input: number, output: number, cost = 0) => ({ ...EMPTY_USAGE, inputTokens: input, outputTokens: output, costUsd: cost, durationMs: 100, numTurns: 1 });

describe('UsageMeter', () => {
  test('adds every run to its own pass and reports each change', async () => {
    const reports: unknown[] = [];
    const meter = new UsageMeter((r) => reports.push(r));
    const inner = new FakeTransport();
    inner.queue({ usage: usage(10, 5, 0.01) });
    inner.queue({ usage: usage(20, 7, 0.02) });
    inner.queue({ usage: usage(1, 1) });
    const find = meter.transport('find', inner);
    await find.run({ model: 'opus', prompt: 'a' });
    await find.run({ model: 'opus', prompt: 'b' });
    await meter.transport('chat', inner).run({ model: 'opus', prompt: 'c' });

    const report = meter.snapshot();
    expect(report.find).toMatchObject({ runs: 2, failed: 0, inputTokens: 30, outputTokens: 12, durationMs: 200 });
    expect(report.find!.costUsd).toBeCloseTo(0.03);
    expect(report.chat!.runs).toBe(1);
    expect(report.verify).toBeUndefined();
    // A start and a finish for each run.
    expect(reports).toHaveLength(6);
  });

  test('a run is counted as running the moment it starts, before it has spent anything', async () => {
    const meter = new UsageMeter();
    let finish: () => void = () => {};
    const slow = { run: () => new Promise<AgentRun>((resolve) => { finish = () => resolve({ text: '', structured: null, sessionId: 's', usage: usage(10, 5), usageWarning: null }); }) };
    const pending = meter.transport('verify', slow).run({ model: 'sonnet', prompt: 'x' });
    expect(meter.snapshot().verify).toMatchObject({ runs: 0, running: 1, inputTokens: 0 });
    finish();
    await pending;
    expect(meter.snapshot().verify).toMatchObject({ runs: 1, running: 0, inputTokens: 10 });
  });

  test('a failed run stops counting as running', async () => {
    const meter = new UsageMeter();
    const dead = { async run(): Promise<never> { throw new Error('spawn ENOENT'); } };
    await expect(meter.transport('verify', dead).run({ model: 'sonnet', prompt: 'x' })).rejects.toThrow();
    expect(meter.snapshot().verify!.running).toBe(0);
  });

  test('a failed run still counts what it spent, and the failure still reaches the caller', async () => {
    const meter = new UsageMeter();
    const failing = { async run(): Promise<never> { throw new AgentRunError('schema retries exhausted', usage(500, 40)); } };
    await expect(meter.transport('abridge', failing).run({ model: 'sonnet', prompt: 'x' })).rejects.toThrow('schema retries');
    expect(meter.snapshot().abridge).toMatchObject({ runs: 1, failed: 1, inputTokens: 500, outputTokens: 40 });
  });

  test('a failure that never reached the model counts as a run with no spend', async () => {
    const meter = new UsageMeter();
    const dead = { async run(): Promise<never> { throw new Error('spawn ENOENT'); } };
    await expect(meter.transport('group', dead).run({ model: 'sonnet', prompt: 'x' })).rejects.toThrow();
    expect(meter.snapshot().group).toMatchObject({ runs: 1, failed: 1, inputTokens: 0 });
  });

  test('counts the turns and file reads of each finished run', async () => {
    const meter = new UsageMeter();
    const reading: AgentTransport = {
      async run(req) {
        req.onProgress?.({ turns: 1, reads: 1, activity: 'reading a.ts' });
        req.onProgress?.({ turns: 2, reads: 2, activity: 'reading b.ts' });
        return { text: '', structured: null, sessionId: 's', usage: { ...usage(1, 1), numTurns: 4 }, usageWarning: null };
      },
    };
    const seen: string[] = [];
    await meter.transport('find', reading).run({ model: 'opus', prompt: 'x', onProgress: (p) => seen.push(p.activity) });
    expect(meter.snapshot().find).toMatchObject({ turns: 4, reads: 2 });
    expect(seen).toEqual(['reading a.ts', 'reading b.ts']);
  });

  test('totals sum across passes', () => {
    const p = { runs: 1, running: 1, failed: 0, inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, costUsd: 0.5, durationMs: 9, turns: 3, reads: 2 };
    expect(totalUsage({ find: p, verify: p })).toMatchObject({ runs: 2, running: 2, inputTokens: 20, cacheReadTokens: 6, costUsd: 1, turns: 6, reads: 4 });
    expect(totalUsage({}).runs).toBe(0);
  });
});
