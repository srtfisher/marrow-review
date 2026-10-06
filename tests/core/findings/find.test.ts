import { test, expect, describe } from 'bun:test';
import { readOnlyAccess } from '../../../src/core/source/index.js';
import { DENIED_TOOLS, FINDINGS_SCHEMA, READ_ONLY_TOOLS, runFindings } from '../../../src/core/findings/find.js';
import { MemoryFindingsCache } from '../../../src/core/findings/cache.js';
import { EMPTY_USAGE, type AgentRequest, type AgentRun, type AgentTransport } from '../../../src/core/agent/types.js';
import type { ReviewLens } from '../../../src/core/findings/lenses.js';
import { context, rawFinding } from './context-fixture.js';

const run = (structured: unknown): AgentRun => ({ text: '', structured, sessionId: 's', usage: { ...EMPTY_USAGE, numTurns: 1 }, usageWarning: null });

/** Answers each reviewer by the angle named in its prompt. */
class LensTransport implements AgentTransport {
  readonly requests: AgentRequest[] = [];
  constructor(private readonly answers: Partial<Record<string, unknown[] | Error>> = {}) {}
  async run(req: AgentRequest): Promise<AgentRun> {
    this.requests.push(req);
    const lens = /## Your angle: ([a-z ]+)/.exec(req.prompt)?.[1] ?? '';
    const answer = this.answers[lens];
    if (answer instanceof Error) throw answer;
    return run({ findings: answer ?? [] });
  }
  lensesAsked(): string[] {
    return this.requests.map((r) => /## Your angle: ([a-z ]+)/.exec(r.prompt)?.[1] ?? '').sort();
  }
}

describe('tool policy', () => {
  test('the agent may read but never write or execute', () => {
    expect(DENIED_TOOLS).toContain('Write');
    expect(DENIED_TOOLS).toContain('Edit');
    expect(DENIED_TOOLS).toContain('Bash');
    expect(READ_ONLY_TOOLS).toEqual(['Read', 'Grep', 'Glob']);
    for (const tool of READ_ONLY_TOOLS) expect(DENIED_TOOLS).not.toContain(tool);
  });
});

describe('runFindings', () => {
  test('runs one reviewer per applicable lens and attributes what each raised', async () => {
    const transport = new LensTransport({ bugs: [rawFinding], history: [{ ...rawFinding, line: 40, title: 'Undoes #7', type: 'Correctness' }] });
    const result = await runFindings(transport, 'sonnet', context(), readOnlyAccess('/tmp/wt'));
    expect(transport.lensesAsked()).toEqual(['bugs', 'code comments', 'conventions', 'history', 'prior comments']);
    expect(result.findings.map((f) => [f.title, f.lenses])).toEqual([['Busy-wait', ['bugs']], ['Undoes #7', ['history']]]);
    expect(result.ran).toHaveLength(5);
  });

  test('the same point from two reviewers is one finding', async () => {
    const transport = new LensTransport({ bugs: [rawFinding], codeComments: [], 'code comments': [{ ...rawFinding, line: 12, title: 'Ignores the yield comment' }] });
    const { findings } = await runFindings(transport, 'sonnet', context(), readOnlyAccess('/tmp/wt'));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.lenses.sort()).toEqual(['bugs', 'codeComments']);
  });

  test('every reviewer answers in one turn from what it was handed: no tools of any kind', async () => {
    const transport = new LensTransport();
    await runFindings(transport, 'sonnet', context(), { cwd: '/tmp/x', allowedTools: ['mcp__marrow__read_file'], tools: [{ name: 'read_file', description: '', params: {}, handler: async () => '' }] });
    expect(transport.requests).toHaveLength(5);
    for (const req of transport.requests) {
      expect(req.allowedTools).toEqual([]);
      expect(req.tools).toEqual([]);
      expect(req.disallowedTools).toEqual(expect.arrayContaining([...READ_ONLY_TOOLS, ...DENIED_TOOLS]));
      expect(req.schema).toBe(FINDINGS_SCHEMA);
      expect(req.model).toBe('sonnet');
    }
  });

  test("reviewers reason at the review's effort, not the SDK's default", async () => {
    const transport = new LensTransport();
    await runFindings(transport, 'sonnet', context({ effort: 'low' }), readOnlyAccess('/tmp/wt'));
    for (const req of transport.requests) expect(req.effort).toBe('low');
  });

  test('a failed reviewer costs only its own findings', async () => {
    const failures: ReviewLens[] = [];
    const transport = new LensTransport({ bugs: [rawFinding], history: new Error('rate limited') });
    const result = await runFindings(transport, 'sonnet', context(), readOnlyAccess('/tmp/wt'), { onError: (lens) => failures.push(lens) });
    expect(result.findings.map((f) => f.title)).toEqual(['Busy-wait']);
    expect(result.failed).toEqual(['history']);
    expect(failures).toEqual(['history']);
  });

  test('a question the model marked blocking comes back non-blocking', async () => {
    const transport = new LensTransport({ bugs: [{ ...rawFinding, kind: 'question', failureScenario: null }] });
    const { findings } = await runFindings(transport, 'sonnet', context(), readOnlyAccess('/tmp/wt'));
    expect(findings[0]!.severity).toBe('non-blocking');
  });

  test('names the reviewers still running once most are done', async () => {
    const seen: Array<string | null> = [];
    const slow: AgentTransport = {
      async run(req) {
        if (req.prompt.includes('## Your angle: history')) await new Promise((r) => setTimeout(r, 15));
        return run({ findings: [] });
      },
    };
    await runFindings(slow, 'sonnet', context(), readOnlyAccess('/tmp/wt'), { onProgress: (p) => seen.push(p.activity) });
    expect(seen).toContain('waiting on history');
    expect(seen.at(-1)).toBeNull();
  });

  test('reports reviewers finishing', async () => {
    const seen: string[] = [];
    await runFindings(new LensTransport(), 'sonnet', context(), readOnlyAccess('/tmp/wt'), { onProgress: (p) => seen.push(`${p.done}/${p.total}`) });
    expect(seen[0]).toBe('0/5');
    expect(seen.at(-1)).toBe('5/5');
  });
});

describe('the findings cache', () => {
  test('the same review is paid for once, reviewer by reviewer', async () => {
    const cache = new MemoryFindingsCache();
    const first = new LensTransport({ bugs: [rawFinding] });
    await runFindings(first, 'sonnet', context(), readOnlyAccess('/tmp/wt'), { cache });
    const second = new LensTransport();
    const again = await runFindings(second, 'sonnet', context(), readOnlyAccess('/tmp/wt'), { cache });
    expect(second.requests).toHaveLength(0);
    expect(again.cached).toBe(5);
    expect(again.findings.map((f) => f.title)).toEqual(['Busy-wait']);
  });

  test('a different abridgement summary still hits, since it is prose and not input', async () => {
    const cache = new MemoryFindingsCache();
    await runFindings(new LensTransport(), 'sonnet', context(), readOnlyAccess('/tmp/wt'), { cache });
    const ctx = context();
    const again = await runFindings(new LensTransport(), 'sonnet', { ...ctx, meat: { ...ctx.meat, summary: '' } }, readOnlyAccess('/tmp/wt'), { cache });
    expect(again.cached).toBe(5);
  });

  test('changing one reviewer\'s input re-runs only that reviewer', async () => {
    const cache = new MemoryFindingsCache();
    await runFindings(new LensTransport(), 'sonnet', context(), readOnlyAccess('/tmp/wt'), { cache });
    const transport = new LensTransport();
    await runFindings(transport, 'sonnet', context({ conventions: '### CLAUDE.md\nSomething new.' }), readOnlyAccess('/tmp/wt'), { cache });
    expect(transport.lensesAsked()).toEqual(['conventions']);
  });

  test('a different model or effort misses', async () => {
    const cache = new MemoryFindingsCache();
    await runFindings(new LensTransport(), 'sonnet', context(), readOnlyAccess('/tmp/wt'), { cache });
    expect((await runFindings(new LensTransport(), 'opus', context(), readOnlyAccess('/tmp/wt'), { cache })).cached).toBe(0);
    expect((await runFindings(new LensTransport(), 'sonnet', context({ effort: 'high' }), readOnlyAccess('/tmp/wt'), { cache })).cached).toBe(0);
  });

  test('fresh skips the lookup', async () => {
    const cache = new MemoryFindingsCache();
    await runFindings(new LensTransport(), 'sonnet', context(), readOnlyAccess('/tmp/wt'), { cache });
    const transport = new LensTransport();
    await runFindings(transport, 'sonnet', context(), readOnlyAccess('/tmp/wt'), { cache, fresh: true });
    expect(transport.requests).toHaveLength(5);
  });

  test('a failed reviewer is never cached', async () => {
    const cache = new MemoryFindingsCache();
    await runFindings(new LensTransport({ history: new Error('down') }), 'sonnet', context(), readOnlyAccess('/tmp/wt'), { cache });
    const transport = new LensTransport();
    await runFindings(transport, 'sonnet', context(), readOnlyAccess('/tmp/wt'), { cache });
    expect(transport.lensesAsked()).toEqual(['history']);
  });
});
