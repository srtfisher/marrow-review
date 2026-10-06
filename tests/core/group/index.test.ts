import { test, expect, describe } from 'bun:test';
import { FakeTransport } from '../../../src/core/agent/fake.js';
import { MemoryGroupCache } from '../../../src/core/group/cache.js';
import {
  buildGroupingPrompt, keptHunks, readHunksTool, runGrouping, READ_CALL_LIMIT, UNGROUPED_KEY,
} from '../../../src/core/group/index.js';
import { meatOf } from './meat.js';

const big = () => meatOf({
  'src/api/retry.ts': [['retry()', true], ["import x from 'y'", false]],
  'src/api/client.ts': [['client.retry = true', true]],
  'src/ui/banner.tsx': [['<Banner/>', true]],
  'tests/retry.test.ts': [['test retry', true]],
  'pnpm-lock.yaml': [['lock', false]],
});

function opts(meat = big(), transport = new FakeTransport(), cache = new MemoryGroupCache()) {
  return { prTitle: 'Retry on 5xx', prBody: 'Body', commits: [], meat, transport, model: 'sonnet', cache, cwd: '/tmp' };
}

describe('runGrouping', () => {
  test('a change of three files or fewer is one group with no model call', async () => {
    const transport = new FakeTransport();
    const result = await runGrouping(opts(meatOf({ 'a.ts': [['a', true]], 'b.ts': [['b', true]] }), transport));
    expect(result.source).toBe('single');
    expect(result.groups).toHaveLength(1);
    expect(transport.requests).toHaveLength(0);
  });

  test('a fourth file is enough to ask the model', async () => {
    const o = opts();
    const ids = keptHunks(o.meat).map((h) => h.id);
    o.transport.queue({ structured: { overallSummary: 'Adds retries.', groups: [{ key: 'retry', label: 'Retry', summary: 'why', category: 'api', hunkIds: ids }] } });
    const result = await runGrouping(o);
    expect(result.source).toBe('model');
    expect(result.overallSummary).toBe('Adds retries.');
    expect(o.transport.requests).toHaveLength(1);
  });

  test('only kept hunks are sent to the model', async () => {
    const o = opts();
    o.transport.queue({ structured: { overallSummary: '', groups: [] } });
    o.transport.queue({ structured: { overallSummary: '', groups: [] } });
    await runGrouping(o);
    expect(o.transport.requests[0]!.prompt).toContain('retry()');
    expect(o.transport.requests[0]!.prompt).not.toContain("import x from 'y'");
  });

  test('an incomplete grouping gets one correction that resumes the session', async () => {
    const o = opts();
    const ids = keptHunks(o.meat).map((h) => h.id);
    o.transport.queue({ sessionId: 's1', structured: { overallSummary: 'x', groups: [{ key: 'a', label: 'A', summary: '', category: 'api', hunkIds: ids.slice(0, 2) }] } });
    o.transport.queue({ structured: { overallSummary: 'x', groups: [{ key: 'a', label: 'A', summary: '', category: 'api', hunkIds: ids }] } });
    const result = await runGrouping(o);
    expect(o.transport.requests[1]!.resume).toBe('s1');
    expect(o.transport.requests[1]!.prompt).toContain('Missing from every group');
    expect(result.groups.some((g) => g.key === UNGROUPED_KEY)).toBe(false);
  });

  test('a correction that still misses hunks leaves them Ungrouped, not lost', async () => {
    const o = opts();
    const ids = keptHunks(o.meat).map((h) => h.id);
    const partial = { overallSummary: 'x', groups: [{ key: 'a', label: 'A', summary: '', category: 'api', hunkIds: ids.slice(0, 1) }] };
    o.transport.queue({ structured: partial });
    o.transport.queue({ structured: partial });
    const result = await runGrouping(o);
    expect(result.groups.at(-1)!.key).toBe(UNGROUPED_KEY);
    expect(result.groups.at(-1)!.hunkIds).toHaveLength(ids.length - 1);
  });

  test('a model failure groups by directory and says why', async () => {
    const transport = { async run() { throw new Error('rate limited'); } };
    const result = await runGrouping({ ...opts(), transport: transport as never });
    expect(result.source).toBe('directory');
    expect(result.error?.detail).toContain('rate limited');
    expect(result.groups.map((g) => g.label)).toEqual(['src/api', 'src/ui', 'tests']);
  });

  test('the directory fallback is never cached', async () => {
    const cache = new MemoryGroupCache();
    const transport = { async run() { throw new Error('down'); } };
    await runGrouping({ ...opts(big(), new FakeTransport(), cache), transport: transport as never });
    expect(cache.map.size).toBe(0);
  });

  test('a model grouping is cached and served without a second call', async () => {
    const cache = new MemoryGroupCache();
    const first = opts(big(), new FakeTransport(), cache);
    const ids = keptHunks(first.meat).map((h) => h.id);
    first.transport.queue({ structured: { overallSummary: 's', groups: [{ key: 'a', label: 'A', summary: '', category: 'api', hunkIds: ids }] } });
    await runGrouping(first);

    const second = opts(big(), new FakeTransport(), cache);
    const result = await runGrouping(second);
    expect(result.source).toBe('cache');
    expect(second.transport.requests).toHaveLength(0);
  });
});

describe('buildGroupingPrompt', () => {
  test('inlines hunk bodies for an ordinary change', () => {
    const o = opts();
    const { prompt, inline } = buildGroupingPrompt(o, keptHunks(o.meat));
    expect(inline).toBe(true);
    expect(prompt).toContain('<hunk id="h_');
  });

  test('lists commit subjects only when there is more than one', () => {
    const o = opts();
    expect(buildGroupingPrompt({ ...o, commits: ['one'] }, keptHunks(o.meat)).prompt).not.toContain('Commits');
    expect(buildGroupingPrompt({ ...o, commits: ['one', 'two'] }, keptHunks(o.meat)).prompt).toContain('- two');
  });

  test('switches to on-demand reading when the hunks are too large to inline', () => {
    const huge = meatOf({ 'a.ts': [['x'.repeat(160_000), true]] });
    const { prompt, inline } = buildGroupingPrompt({ ...opts(huge) }, keptHunks(huge));
    expect(inline).toBe(false);
    expect(prompt).toContain('read_hunks');
    expect(prompt).not.toContain('xxxxxxxxxx');
  });
});

describe('readHunksTool', () => {
  test('returns requested hunks, flags unknown ids, and does not repeat itself', async () => {
    const meat = big();
    const hunks = keptHunks(meat);
    const tool = readHunksTool(hunks);
    const first = await tool.handler({ ids: [hunks[0]!.id, 'h_nope'] });
    expect(first).toContain('retry()');
    expect(first).toContain('h_nope: not a hunk id');
    expect(await tool.handler({ ids: [hunks[0]!.id] })).toContain('already shown');
  });

  test('defers what does not fit in one call', async () => {
    const meat = meatOf({ 'a.ts': [['a'.repeat(READ_CALL_LIMIT - 100), true], ['b'.repeat(500), true]] });
    const hunks = keptHunks(meat);
    const out = await readHunksTool(hunks).handler({ ids: hunks.map((h) => h.id) });
    expect(out).toContain(`request again: ${hunks[1]!.id}`);
  });
});
