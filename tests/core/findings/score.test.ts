import { test, expect, describe } from 'bun:test';
import { EMPTY_USAGE, type AgentRequest, type AgentRun, type AgentTransport } from '../../../src/core/agent/types.js';
import { MemoryFindingsCache } from '../../../src/core/findings/cache.js';
import {
  anchorExcerpt, buildScorePrompt, isShown, runScore, SCORE_CONCURRENCY, SCORE_MAX_TURNS, SCORE_SCHEMA,
} from '../../../src/core/findings/score.js';
import type { Finding } from '../../../src/core/findings/types.js';
import { parseUnifiedDiff } from '../../../src/core/diff/parse.js';
import { readOnlyAccess } from '../../../src/core/source/index.js';

const finding: Finding = {
  id: 'f1', path: 'src/api.ts', line: 11, side: 'RIGHT', startLine: null, severity: 'blocking', type: 'Correctness',
  kind: 'issue', failureScenario: 'A 5xx makes retry() spin.', title: 'Busy-wait', body: 'sleep(0) does not yield.',
  confidence: 'high', suggestion: null, lenses: ['bugs'],
};

const run = (structured: unknown): AgentRun => ({ text: '', structured, sessionId: 's', usage: { ...EMPTY_USAGE, numTurns: 1 }, usageWarning: null });

class Scorer implements AgentTransport {
  readonly requests: AgentRequest[] = [];
  constructor(private readonly answer: (req: AgentRequest) => unknown = () => ({ score: 85, reason: 'Checked the caller.' })) {}
  async run(req: AgentRequest): Promise<AgentRun> {
    this.requests.push(req);
    const a = this.answer(req);
    if (a instanceof Error) throw a;
    return run(a);
  }
}

describe('buildScorePrompt', () => {
  test("gives the scorer /code-review's scale and its list of false positives", () => {
    const prompt = buildScorePrompt(finding, { excerpt: null });
    expect(prompt).toContain('0: Not confident at all.');
    expect(prompt).toContain('100: Absolutely certain.');
    expect(prompt).toContain('pre-existing issues');
    expect(prompt).toContain('Busy-wait');
    expect(prompt).toContain(finding.failureScenario!);
  });

  test('carries the code the finding is about', () => {
    expect(buildScorePrompt(finding, { excerpt: '+await sleep(0);' })).toContain('+await sleep(0);');
  });

  test('a convention finding is checked against the conventions it cites; others are not sent them', () => {
    const conventions = '### CLAUDE.md\nNever busy-wait.';
    expect(buildScorePrompt({ ...finding, lenses: ['conventions'] }, { excerpt: null, conventions })).toContain('Never busy-wait.');
    expect(buildScorePrompt(finding, { excerpt: null, conventions })).not.toContain('Never busy-wait.');
  });
});

describe('anchorExcerpt', () => {
  const files = parseUnifiedDiff(`diff --git a/src/api.ts b/src/api.ts
index 1..2 100644
--- a/src/api.ts
+++ b/src/api.ts
@@ -10,2 +10,3 @@ retry()
 const x = 1;
+await sleep(0);
 return x;
@@ -40,1 +41,1 @@
-old();
+fresh();
`);

  test('finds the hunk the anchor sits in', () => {
    expect(anchorExcerpt(files, finding)).toContain('+await sleep(0);');
    expect(anchorExcerpt(files, finding)).not.toContain('fresh()');
  });

  test('reads a LEFT anchor against the old line numbers', () => {
    expect(anchorExcerpt(files, { ...finding, line: 40, side: 'LEFT' })).toContain('-old();');
  });

  test('is null outside the diff', () => {
    expect(anchorExcerpt(files, { ...finding, line: 400 })).toBeNull();
  });
});

describe('runScore', () => {
  test('scores each issue with the read-only policy, the schema, and a turn cap', async () => {
    const transport = new Scorer();
    const { scored } = await runScore(transport, 'haiku', [finding], readOnlyAccess('/tmp/wt'));
    expect(scored[0]).toMatchObject({ score: 85, scoreReason: 'Checked the caller.' });
    const req = transport.requests[0]!;
    expect(req.schema).toBe(SCORE_SCHEMA);
    expect(req.maxTurns).toBe(SCORE_MAX_TURNS);
    expect(req.model).toBe('haiku');
    expect(req.disallowedTools).toContain('Bash');
    expect(req.effort).toBe('low');
  });

  test('in API mode the scorer is denied the local file tools, which would read an empty directory', async () => {
    const transport = new Scorer();
    await runScore(transport, 'haiku', [finding], { cwd: '/tmp/x', allowedTools: ['mcp__marrow__read_file'], tools: [], deniedTools: ['Read', 'Grep', 'Glob'] });
    expect(transport.requests[0]!.disallowedTools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash']));
  });

  test('a question is never scored', async () => {
    const transport = new Scorer();
    const { scored } = await runScore(transport, 'haiku', [{ ...finding, kind: 'question' }], readOnlyAccess('/tmp/wt'));
    expect(transport.requests).toHaveLength(0);
    expect(scored[0]!.score).toBeNull();
  });

  test('a failed scorer leaves the finding unscored, which is shown', async () => {
    const errors: unknown[] = [];
    const { scored } = await runScore(new Scorer(() => new Error('down')), 'haiku', [finding], readOnlyAccess('/tmp/wt'), { onError: (e) => errors.push(e) });
    expect(scored[0]!.score).toBeNull();
    expect(isShown(scored[0]!, 80)).toBe(true);
    expect(errors).toHaveLength(1);
  });

  test('an out-of-range score is clamped', async () => {
    const { scored } = await runScore(new Scorer(() => ({ score: 140, reason: '' })), 'haiku', [finding], readOnlyAccess('/tmp/wt'));
    expect(scored[0]!.score).toBe(100);
  });

  test('never runs more scorers at once than the pool allows, and keeps order', async () => {
    let inFlight = 0;
    let peak = 0;
    const transport: AgentTransport = {
      async run(req) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 3));
        inFlight -= 1;
        return run({ score: req.prompt.includes('t3') ? 10 : 90, reason: '' });
      },
    };
    const findings = Array.from({ length: 20 }, (_, i) => ({ ...finding, id: `f${i}`, title: `t${i}` }));
    const { scored } = await runScore(transport, 'haiku', findings, readOnlyAccess('/tmp/wt'));
    expect(peak).toBeLessThanOrEqual(SCORE_CONCURRENCY);
    expect(scored.map((f) => f.id)).toEqual(findings.map((f) => f.id));
    expect(scored[3]!.score).toBe(10);
  });

  test('reports progress as each finding settles', async () => {
    const seen: string[] = [];
    await runScore(new Scorer(), 'haiku', [finding, { ...finding, id: 'f2', title: 'Other' }], readOnlyAccess('/tmp/wt'), { onProgress: (d, t) => seen.push(`${d}/${t}`) });
    expect(seen).toEqual(['1/2', '2/2']);
  });
});

describe('the score cache', () => {
  test('a finding already scored is not scored again', async () => {
    const cache = new MemoryFindingsCache();
    await runScore(new Scorer(), 'haiku', [finding], readOnlyAccess('/tmp/wt'), { cache });
    const transport = new Scorer();
    const again = await runScore(transport, 'haiku', [finding], readOnlyAccess('/tmp/wt'), { cache });
    expect(transport.requests).toHaveLength(0);
    expect(again.cached).toBe(1);
    expect(again.scored[0]!.score).toBe(85);
  });

  test('a different scorer model misses, and fresh re-runs', async () => {
    const cache = new MemoryFindingsCache();
    await runScore(new Scorer(), 'haiku', [finding], readOnlyAccess('/tmp/wt'), { cache });
    expect((await runScore(new Scorer(), 'sonnet', [finding], readOnlyAccess('/tmp/wt'), { cache })).cached).toBe(0);
    expect((await runScore(new Scorer(), 'haiku', [finding], readOnlyAccess('/tmp/wt'), { cache, fresh: true })).cached).toBe(0);
  });

  test('a failure is never cached', async () => {
    const cache = new MemoryFindingsCache();
    await runScore(new Scorer(() => new Error('down')), 'haiku', [finding], readOnlyAccess('/tmp/wt'), { cache });
    expect((await runScore(new Scorer(), 'haiku', [finding], readOnlyAccess('/tmp/wt'), { cache })).cached).toBe(0);
  });
});
