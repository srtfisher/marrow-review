import { test, expect } from 'bun:test';
import { computeMeat } from '../../../src/core/meat/index.js';
import { MemoryVerdictCache, hunkKey } from '../../../src/core/meat/cache.js';
import { FakeTransport } from '../../../src/core/agent/fake.js';
import type { AgentRun, AgentTransport } from '../../../src/core/agent/types.js';
import { parseUnifiedDiff } from '../../../src/core/diff/parse.js';

/** Stands in for an SDK subprocess that dies. */
class BrokenTransport implements AgentTransport {
  async run(): Promise<AgentRun> {
    throw new Error('SDK subprocess exited');
  }
}

const DIFF = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 111..222 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1,1 +1,1 @@
-lockfileVersion: 9
+lockfileVersion: 10
diff --git a/src/app.ts b/src/app.ts
index 333..444 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,1 +1,1 @@
-return a + b;
+return a - b;
@@ -10,1 +10,1 @@
-import { x } from './x.js';
+import { y } from './y.js';
`;

test('rules drop the lockfile before the model ever sees it', async () => {
  const files = parseUnifiedDiff(DIFF);
  const transport = new FakeTransport();
  transport.queue({
    structured: { summary: 'Flips an operator.', verdicts: [] },
  });

  const result = await computeMeat({
    files,
    ruleContext: { generatedPaths: new Set() },
    transport,
    cache: new MemoryVerdictCache(),
    model: 'sonnet',
    prTitle: 'T',
    prBody: '',
  });

  const lock = result.files.find((f) => f.file.path === 'pnpm-lock.yaml')!;
  expect(lock.dropped?.rule).toBe('lockfile');

  // Only the substantive hunk reached the model: the import hunk was
  // rule-dropped and the lockfile file was dropped whole.
  expect(transport.requests).toHaveLength(1);
  expect(transport.requests[0]!.prompt).toContain('return a - b;');
  expect(transport.requests[0]!.prompt).not.toContain('lockfileVersion');
  expect(transport.requests[0]!.prompt).not.toContain("from './y.js'");
});

test('reports kept and total counters', async () => {
  const files = parseUnifiedDiff(DIFF);
  const transport = new FakeTransport();
  transport.queue({ structured: { summary: 's', verdicts: [] } });

  const result = await computeMeat({
    files,
    ruleContext: { generatedPaths: new Set() },
    transport,
    cache: new MemoryVerdictCache(),
    model: 'sonnet',
    prTitle: 'T',
    prBody: '',
  });

  expect(result.totalFiles).toBe(2);
  expect(result.keptFiles).toBe(1);
  expect(result.totalLines).toBe(6);
  expect(result.keptLines).toBe(2);
  expect(result.summary).toBe('s');
});

test('a cached verdict skips the model entirely', async () => {
  const files = parseUnifiedDiff(DIFF);
  const app = files.find((f) => f.path === 'src/app.ts')!;
  const cache = new MemoryVerdictCache();
  await cache.set(hunkKey('src/app.ts', app.hunks[0]!), {
    keep: false,
    reason: 'cached noise',
  });

  const transport = new FakeTransport(); // empty queue: any run throws

  const result = await computeMeat({
    files,
    ruleContext: { generatedPaths: new Set() },
    transport,
    cache,
    model: 'sonnet',
    prTitle: 'T',
    prBody: '',
  });

  expect(transport.requests).toHaveLength(0);
  const appFile = result.files.find((f) => f.file.path === 'src/app.ts')!;
  const first = appFile.hunks.find((h) => h.hunk === app.hunks[0])!;
  expect(first.keep).toBe(false);
  expect(first.source).toBe('cache');
  expect(first.reason).toBe('cached noise');
});

test('model verdicts are written back to the cache', async () => {
  const files = parseUnifiedDiff(DIFF);
  const app = files.find((f) => f.path === 'src/app.ts')!;
  const cache = new MemoryVerdictCache();
  const transport = new FakeTransport();

  const key = hunkKey('src/app.ts', app.hunks[0]!);
  transport.queue({
    structured: { summary: 's', verdicts: [{ id: key, keep: true, reason: 'logic change' }] },
  });

  await computeMeat({
    files,
    ruleContext: { generatedPaths: new Set() },
    transport,
    cache,
    model: 'sonnet',
    prTitle: 'T',
    prBody: '',
  });

  expect(await cache.get(key)).toEqual({ keep: true, reason: 'logic change' });
});

test('a model failure keeps the hunks and never fails the run', async () => {
  const files = parseUnifiedDiff(DIFF);
  const app = files.find((f) => f.path === 'src/app.ts')!;
  const cache = new MemoryVerdictCache();

  const result = await computeMeat({
    files,
    ruleContext: { generatedPaths: new Set() },
    transport: new BrokenTransport(),
    cache,
    model: 'sonnet',
    prTitle: 'T',
    prBody: '',
  });

  const appFile = result.files.find((f) => f.file.path === 'src/app.ts')!;
  const first = appFile.hunks.find((h) => h.hunk === app.hunks[0])!;
  expect(first.keep).toBe(true);
  expect(first.reason).toBe('classification failed');
  expect(result.keptLines).toBe(2);
});

test('a degraded verdict is not written to the cache', async () => {
  const files = parseUnifiedDiff(DIFF);
  const app = files.find((f) => f.path === 'src/app.ts')!;
  const cache = new MemoryVerdictCache();
  const transport = new FakeTransport();

  // The model answers, but omits the only hunk it was asked about.
  transport.queue({ structured: { summary: 's', verdicts: [] } });

  await computeMeat({
    files,
    ruleContext: { generatedPaths: new Set() },
    transport,
    cache,
    model: 'sonnet',
    prTitle: 'T',
    prBody: '',
  });

  expect(await cache.get(hunkKey('src/app.ts', app.hunks[0]!))).toBeNull();
});

test('a transport failure leaves the cache untouched', async () => {
  const files = parseUnifiedDiff(DIFF);
  const app = files.find((f) => f.path === 'src/app.ts')!;
  const cache = new MemoryVerdictCache();

  await computeMeat({
    files,
    ruleContext: { generatedPaths: new Set() },
    transport: new BrokenTransport(),
    cache,
    model: 'sonnet',
    prTitle: 'T',
    prBody: '',
  });

  expect(await cache.get(hunkKey('src/app.ts', app.hunks[0]!))).toBeNull();
});
