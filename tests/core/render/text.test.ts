import { test, expect } from 'bun:test';
import { renderMeat } from '../../../src/core/render/text.js';
import { computeMeat } from '../../../src/core/meat/index.js';
import { MemoryVerdictCache } from '../../../src/core/meat/cache.js';
import { FakeTransport } from '../../../src/core/agent/fake.js';
import { parseUnifiedDiff } from '../../../src/core/diff/parse.js';

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
`;

async function meat() {
  const transport = new FakeTransport();
  transport.queue({ structured: { summary: 'Flips an operator.', verdicts: [] } });
  return computeMeat({
    files: parseUnifiedDiff(DIFF),
    ruleContext: { generatedPaths: new Set() },
    transport,
    cache: new MemoryVerdictCache(),
    model: 'sonnet',
    prTitle: 'T',
    prBody: '',
  });
}

test('shows the summary and the kept counter', async () => {
  const out = renderMeat(await meat());
  expect(out).toContain('Flips an operator.');
  expect(out).toContain('kept 2/4 changed lines in 1/2 files');
});

test('shows kept hunk content', async () => {
  const out = renderMeat(await meat());
  expect(out).toContain('src/app.ts');
  expect(out).toContain('-return a + b;');
  expect(out).toContain('+return a - b;');
});

test('names the rule for a dropped file without printing its content', async () => {
  const out = renderMeat(await meat());
  expect(out).toContain('pnpm-lock.yaml');
  expect(out).toContain('dropped: lockfile');
  expect(out).not.toContain('lockfileVersion: 10');
});
