import { test, expect, describe } from 'bun:test';
import {
  buildVerifyPrompt, runVerify, scoreVerdict, VERIFY_CONCURRENCY, VERIFY_SCHEMA,
} from '../../../src/core/findings/verify.js';
import { FakeTransport } from '../../../src/core/agent/fake.js';
import type { AgentRequest, AgentRun, AgentTransport } from '../../../src/core/agent/types.js';
import type { Finding } from '../../../src/core/findings/types.js';

const finding: Finding = {
  id: 'f1', path: 'src/api.ts', line: 11, side: 'RIGHT', startLine: null,
  severity: 'important', title: 'Busy-wait', body: 'sleep(0) does not yield.',
  confidence: 'high', suggestion: null,
};

describe('scoreVerdict', () => {
  test('no refutation confirms', () => {
    expect(scoreVerdict([
      { lens: 'reachability', refuted: false, reasoning: 'r' },
      { lens: 'reproduction', refuted: false, reasoning: 'r' },
    ])).toBe('confirmed');
  });

  test('both refuting refutes', () => {
    expect(scoreVerdict([
      { lens: 'reachability', refuted: true, reasoning: 'r' },
      { lens: 'reproduction', refuted: true, reasoning: 'r' },
    ])).toBe('refuted');
  });

  test('a split is plausible, not decided', () => {
    expect(scoreVerdict([
      { lens: 'reachability', refuted: true, reasoning: 'r' },
      { lens: 'reproduction', refuted: false, reasoning: 'r' },
    ])).toBe('plausible');
  });

  test('no refutations at all is plausible, never confirmed', () => {
    // Verification failing must not silently promote a finding.
    expect(scoreVerdict([])).toBe('plausible');
  });
});

describe('buildVerifyPrompt', () => {
  test('asks the verifier to refute, and names the lens', () => {
    const reach = buildVerifyPrompt(finding, 'reachability');
    expect(reach.toLowerCase()).toContain('refute');
    expect(reach.toLowerCase()).toContain('reachable');
    expect(reach).toContain('Busy-wait');

    const repro = buildVerifyPrompt(finding, 'reproduction');
    expect(repro.toLowerCase()).toContain('reproduce');
    expect(repro).not.toBe(reach);
  });
});

describe('runVerify', () => {
  test('runs both lenses per finding and attaches the verdict', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { refuted: false, reasoning: 'path is reachable' } });
    transport.queue({ structured: { refuted: false, reasoning: 'reproduces' } });

    const [verified] = await runVerify(transport, 'opus', [finding], '/tmp/wt');
    expect(transport.requests).toHaveLength(2);
    expect(verified!.verdict).toBe('confirmed');
    expect(verified!.refutations.map((r) => r.lens)).toEqual(['reachability', 'reproduction']);
  });

  test('marks a finding refuted when both lenses refute', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { refuted: true, reasoning: 'dead code' } });
    transport.queue({ structured: { refuted: true, reasoning: 'cannot occur' } });

    const [verified] = await runVerify(transport, 'opus', [finding], '/tmp/wt');
    expect(verified!.verdict).toBe('refuted');
  });

  test('keeps the finding when verification fails entirely', async () => {
    const transport = { async run() { throw new Error('SDK died'); } };
    const [verified] = await runVerify(transport as never, 'opus', [finding], '/tmp/wt');
    expect(verified!.verdict).toBe('plausible');
    expect(verified!.refutations).toEqual([]);
  });

  test('never runs more model calls at once than the pool allows', async () => {
    // Each lens on each finding is one Claude Code subprocess; twenty findings
    // used to mean forty of them at the same instant.
    let inFlight = 0;
    let peak = 0;
    const transport: AgentTransport = {
      async run(_req: AgentRequest): Promise<AgentRun> {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return {
          text: '', structured: { refuted: false, reasoning: 'r' },
          sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, numTurns: 1 },
          usageWarning: null,
        };
      },
    };

    const findings = Array.from({ length: 20 }, (_, i) => ({ ...finding, id: `f${i}` }));
    const verified = await runVerify(transport, 'opus', findings, '/tmp/wt');

    expect(peak).toBeLessThanOrEqual(VERIFY_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    expect(verified).toHaveLength(20);
    for (const f of verified) expect(f.verdict).toBe('confirmed');
  });

  test('keeps refutations in lens order however the pool interleaves', async () => {
    // Slow reachability, fast reproduction: completion order is not task order.
    const transport: AgentTransport = {
      async run(req: AgentRequest): Promise<AgentRun> {
        const slow = req.prompt.toLowerCase().includes('reachable');
        await new Promise((resolve) => setTimeout(resolve, slow ? 12 : 1));
        return {
          text: '', structured: { refuted: false, reasoning: slow ? 'reach' : 'repro' },
          sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, numTurns: 1 },
          usageWarning: null,
        };
      },
    };

    const findings = [{ ...finding, id: 'a' }, { ...finding, id: 'b' }];
    const verified = await runVerify(transport, 'opus', findings, '/tmp/wt');

    expect(verified.map((f) => f.id)).toEqual(['a', 'b']);
    for (const f of verified) {
      expect(f.refutations.map((r) => r.lens)).toEqual(['reachability', 'reproduction']);
    }
  });

  test('a per-lens failure still leaves the other lens counted', async () => {
    let call = 0;
    const transport: AgentTransport = {
      async run(): Promise<AgentRun> {
        call += 1;
        if (call === 1) throw new Error('lens died');
        return {
          text: '', structured: { refuted: true, reasoning: 'cannot occur' },
          sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, numTurns: 1 },
          usageWarning: null,
        };
      },
    };

    const errors: unknown[] = [];
    const [verified] = await runVerify(transport, 'opus', [finding], '/tmp/wt', (e) => errors.push(e));
    expect(verified!.refutations).toHaveLength(1);
    expect(verified!.verdict).toBe('refuted');
    expect(errors).toHaveLength(1);
  });

  test('verifiers get the read-only tool policy and the schema', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { refuted: false, reasoning: 'x' } });
    transport.queue({ structured: { refuted: false, reasoning: 'y' } });
    await runVerify(transport, 'opus', [finding], '/tmp/wt');

    for (const req of transport.requests) {
      expect(req.schema).toBe(VERIFY_SCHEMA);
      expect(req.disallowedTools).toContain('Bash');
      expect(req.cwd).toBe('/tmp/wt');
    }
  });
});
