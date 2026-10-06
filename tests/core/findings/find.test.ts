import { test, expect, describe } from 'bun:test';
import { readOnlyAccess } from '../../../src/core/source/index.js';
import {
  buildFindingsPrompt, findingId, runFindings,
  DENIED_TOOLS, FINDINGS_SCHEMA, READ_ONLY_TOOLS,
} from '../../../src/core/findings/find.js';
import { FakeTransport } from '../../../src/core/agent/fake.js';
import type { MeatResult } from '../../../src/core/meat/index.js';

function meat(): MeatResult {
  return {
    summary: 'Adds retry logic.',
    files: [{
      file: { path: 'src/api.ts', oldPath: null, status: 'modified', similarity: null,
              hunks: [], additions: 2, deletions: 1 },
      dropped: null,
      hunks: [
        { hunk: { header: '@@ -10,2 +10,3 @@', section: 'retry()', oldStart: 10, oldLines: 2,
                  newStart: 10, newLines: 3,
                  lines: [{ kind: 'add', text: 'await sleep(0);', oldLine: null, newLine: 11, noNewlineAtEof: false }] },
          keep: true, reason: 'changes control flow', source: 'model' },
        { hunk: { header: '@@ -40,1 +41,1 @@', section: '', oldStart: 40, oldLines: 1,
                  newStart: 41, newLines: 1,
                  lines: [{ kind: 'add', text: "import x from 'y';", oldLine: null, newLine: 41, noNewlineAtEof: false }] },
          keep: false, reason: 'imports-only', source: 'rule' },
      ],
    }],
    keptLines: 1, totalLines: 2, keptFiles: 1, totalFiles: 1,
    keptAdditions: 1, keptDeletions: 0, totalAdditions: 2, totalDeletions: 0,
    unclassified: 0,
    classifierError: null,
  };
}

const input = {
  prTitle: 'Add retries', prBody: 'Retries on 5xx.', meat: meat(), threads: [], failingChecks: [],
  effort: 'medium' as const, standards: '', conventions: '',
};

describe('tool policy', () => {
  test('the agent may read but never write or execute', () => {
    expect(DENIED_TOOLS).toContain('Write');
    expect(DENIED_TOOLS).toContain('Edit');
    expect(DENIED_TOOLS).toContain('Bash');
    expect(READ_ONLY_TOOLS).toEqual(['Read', 'Grep', 'Glob']);
    for (const tool of READ_ONLY_TOOLS) expect(DENIED_TOOLS).not.toContain(tool);
  });
});

describe('buildFindingsPrompt', () => {
  test('includes kept hunks and excludes dropped ones', () => {
    const prompt = buildFindingsPrompt(input);
    expect(prompt).toContain('await sleep(0);');
    expect(prompt).not.toContain("import x from 'y';");
  });

  test('includes the PR title, body, and meat summary', () => {
    const prompt = buildFindingsPrompt(input);
    expect(prompt).toContain('Add retries');
    expect(prompt).toContain('Retries on 5xx.');
    expect(prompt).toContain('Adds retry logic.');
  });

  test('includes existing threads so the agent does not repeat a colleague', () => {
    const prompt = buildFindingsPrompt({
      ...input,
      threads: [{ path: 'src/api.ts', line: 11, isResolved: false, isOutdated: false,
                  comments: [{ author: 'hubot', body: 'This busy-waits.', createdAt: 'now' }] }],
    });
    expect(prompt).toContain('This busy-waits.');
    expect(prompt).toContain('hubot');
  });

  test('includes failing check output', () => {
    const prompt = buildFindingsPrompt({
      ...input,
      failingChecks: [{ name: 'unit', status: 'completed', conclusion: 'failure',
                        detailsUrl: null, output: '3 tests failed in api.test.ts' }],
    });
    expect(prompt).toContain('3 tests failed in api.test.ts');
  });
});

describe('findingId', () => {
  test('is stable for the same finding', () => {
    const raw = { path: 'a.ts', line: 1, side: 'RIGHT' as const, title: 't', body: 'b',
                  severity: 'non-blocking' as const, type: 'Correctness' as const, kind: 'issue' as const, failureScenario: 'x', confidence: 'low' as const, startLine: null, suggestion: null };
    expect(findingId(raw)).toBe(findingId({ ...raw }));
  });

  test('differs when the anchor or title differs', () => {
    const raw = { path: 'a.ts', line: 1, side: 'RIGHT' as const, title: 't', body: 'b',
                  severity: 'non-blocking' as const, type: 'Correctness' as const, kind: 'issue' as const, failureScenario: 'x', confidence: 'low' as const, startLine: null, suggestion: null };
    expect(findingId(raw)).not.toBe(findingId({ ...raw, line: 2 }));
    expect(findingId(raw)).not.toBe(findingId({ ...raw, title: 'other' }));
  });
});

describe('runFindings', () => {
  test('sends a read-only tool policy and the schema', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { findings: [] } });
    await runFindings(transport, 'opus', input, readOnlyAccess('/tmp/wt'));

    const req = transport.requests[0]!;
    expect(req.model).toBe('opus');
    expect(req.cwd).toBe('/tmp/wt');
    expect(req.schema).toBe(FINDINGS_SCHEMA);
    expect(req.allowedTools).toEqual([...READ_ONLY_TOOLS]);
    expect(req.disallowedTools).toEqual([...DENIED_TOOLS]);
  });

  test('maps raw findings and assigns stable ids', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { findings: [
      { path: 'src/api.ts', line: 11, side: 'RIGHT', startLine: null, severity: 'blocking', type: 'Correctness', kind: 'issue', failureScenario: 'A 5xx makes retry() spin.',
        title: 'Busy-wait', body: 'sleep(0) does not yield.', confidence: 'high', suggestion: null },
    ] } });

    const found = await runFindings(transport, 'opus', input, readOnlyAccess('/tmp/wt'));
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe('Busy-wait');
    expect(found[0]!.id.length).toBeGreaterThan(0);
  });

  test('returns an empty list rather than throwing when the model returns nothing', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: null });
    expect(await runFindings(transport, 'opus', input, readOnlyAccess('/tmp/wt'))).toEqual([]);
  });

  test('a transport failure yields no findings instead of killing the review', async () => {
    const transport = { async run() { throw new Error('SDK died'); } };
    expect(await runFindings(transport as never, 'opus', input, readOnlyAccess('/tmp/wt'))).toEqual([]);
  });
});

describe('the rubric reaches the model', () => {
  test('the system prompt is the rubric, with the effort applied', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { findings: [] } });
    await runFindings(transport, 'opus', { ...input, effort: 'low', conventions: 'Tabs.' }, readOnlyAccess('/tmp/wt'));
    const system = transport.requests[0]!.systemPrompt!;
    expect(system).toContain('blocking: must change before merge');
    expect(system).toContain('Tabs.');
  });

  test('a question the model marked blocking comes back non-blocking', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { findings: [
      { path: 'src/api.ts', line: 11, side: 'RIGHT', startLine: null, severity: 'blocking',
        type: 'Performance', kind: 'question', failureScenario: null, title: 'Tested at scale?',
        body: 'Was this tried on a large table?', confidence: 'low', suggestion: null },
    ] } });
    const [found] = await runFindings(transport, 'opus', input, readOnlyAccess('/tmp/wt'));
    expect(found!.severity).toBe('non-blocking');
  });

  test('in-process tools and their names pass through to the run', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { findings: [] } });
    const tool = { name: 'read_file', description: 'r', params: {}, handler: async () => '' };
    await runFindings(transport, 'opus', input, { cwd: '/tmp/x', allowedTools: ['mcp__marrow__read_file'], tools: [tool] });
    expect(transport.requests[0]!.allowedTools).toEqual(['mcp__marrow__read_file']);
    expect(transport.requests[0]!.tools).toEqual([tool]);
  });
});
