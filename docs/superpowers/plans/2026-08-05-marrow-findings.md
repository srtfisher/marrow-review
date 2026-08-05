# marrow Findings & Verify Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Have the agent read the pull request and draft findings anchored to specific lines, adversarially verify each one, and let the reviewer triage them into a staged GitHub review — plus a chat pane for asking about the hunk under the cursor.

**Architecture:** Two new core passes (`findings`, `verify`) behind the existing `AgentTransport` seam, so every test runs against `FakeTransport` with no model in the loop. Triage state extends the `ReviewDraft` already built in Plan 1. The TUI renders findings interleaved with their hunks, in the `agent` color token reserved for model-authored content.

**Tech Stack:** Same as Plans 1 and 2. No new dependencies.

**Specs:** `docs/superpowers/specs/2026-08-05-marrow-design.md`, `.interface-design/system.md`

## Global Constraints

- Node 24, ESM, `.js` extensions on all relative imports.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- `src/core/**` imports no UI library; `bun run lint:boundary` stays green.
- Tests import from `bun:test`. **No live model calls in tests** — everything drives `FakeTransport`.
- **The findings agent is read-only.** `disallowedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash']` plus a `canUseTool` that rejects anything not in the read-only set. A review tool has no business mutating the checkout, and denying `Bash` means it cannot run arbitrary commands in your repo.
- **Model-authored content renders in `theme.color.agent` (magenta)** and nothing else uses that token. You must always be able to tell what the model said from what you and your colleagues said.
- Conventional-commit prefix; commit after every task.

## Interfaces consumed from Plans 1 and 2

```ts
// core/agent/types.ts
AgentTransport { run(req: AgentRequest): Promise<AgentRun> }
AgentRequest { prompt; systemPrompt?; model; cwd?; allowedTools?; disallowedTools?;
               schema?; resume?; maxTurns? }
AgentRun { text; structured: unknown; sessionId; usage; usageWarning }
// core/agent/fake.ts   FakeTransport { queue(run); requests: AgentRequest[] }
// core/meat/index.ts   MeatResult, MeatFile, MeatHunk
// core/diff/types.ts   DiffFile, Hunk, DiffLine
// core/review/types.ts StagedComment, ReviewDraft, Side, Verdict
// core/review/anchors.ts findAnchorProblems(draft, files)
// core/github/types.ts ReviewThread, CheckRun
// tui/theme.ts         theme = { color, tier, layout, glyph }
// tui/units.ts         ReviewUnit, buildUnits
```

---

### Task 1: Findings pass

**Files:**
- Create: `src/core/findings/types.ts`, `src/core/findings/schema.ts`, `src/core/findings/find.ts`
- Test: `tests/core/findings/find.test.ts`

**Interfaces produced:**
- `type Severity = 'critical' | 'important' | 'minor'`
- `type Confidence = 'high' | 'medium' | 'low'`
- `interface Finding { id: string; path: string; line: number; side: Side; startLine: number | null; severity: Severity; title: string; body: string; confidence: Confidence; suggestion: string | null }`
- `const FINDINGS_SCHEMA: Record<string, unknown>`
- `const FINDINGS_SYSTEM_PROMPT: string`
- `const READ_ONLY_TOOLS: readonly string[]`, `const DENIED_TOOLS: readonly string[]`
- `function buildFindingsPrompt(input: FindingsInput): string`
- `function findingId(raw: RawFinding): string`
- `function runFindings(transport, model, input, cwd): Promise<Finding[]>`
- `interface FindingsInput { prTitle: string; prBody: string; meat: MeatResult; threads: ReviewThread[]; failingChecks: CheckRun[] }`

- [ ] **Step 1: Write the failing tests**

`tests/core/findings/find.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
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
  };
}

const input = { prTitle: 'Add retries', prBody: 'Retries on 5xx.', meat: meat(), threads: [], failingChecks: [] };

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
                  comments: [{ author: 'tqbf', body: 'This busy-waits.', createdAt: 'now' }] }],
    });
    expect(prompt).toContain('This busy-waits.');
    expect(prompt).toContain('tqbf');
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
                  severity: 'minor' as const, confidence: 'low' as const, startLine: null, suggestion: null };
    expect(findingId(raw)).toBe(findingId({ ...raw }));
  });

  test('differs when the anchor or title differs', () => {
    const raw = { path: 'a.ts', line: 1, side: 'RIGHT' as const, title: 't', body: 'b',
                  severity: 'minor' as const, confidence: 'low' as const, startLine: null, suggestion: null };
    expect(findingId(raw)).not.toBe(findingId({ ...raw, line: 2 }));
    expect(findingId(raw)).not.toBe(findingId({ ...raw, title: 'other' }));
  });
});

describe('runFindings', () => {
  test('sends a read-only tool policy and the schema', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { findings: [] } });
    await runFindings(transport, 'opus', input, '/tmp/wt');

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
      { path: 'src/api.ts', line: 11, side: 'RIGHT', startLine: null, severity: 'important',
        title: 'Busy-wait', body: 'sleep(0) does not yield.', confidence: 'high', suggestion: null },
    ] } });

    const found = await runFindings(transport, 'opus', input, '/tmp/wt');
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe('Busy-wait');
    expect(found[0]!.id.length).toBeGreaterThan(0);
  });

  test('returns an empty list rather than throwing when the model returns nothing', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: null });
    expect(await runFindings(transport, 'opus', input, '/tmp/wt')).toEqual([]);
  });

  test('a transport failure yields no findings instead of killing the review', async () => {
    const transport = { async run() { throw new Error('SDK died'); } };
    expect(await runFindings(transport as never, 'opus', input, '/tmp/wt')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/core/findings/find.test.ts` → FAIL (cannot resolve `find.js`).

- [ ] **Step 3: Implement**

`src/core/findings/types.ts`:

```ts
import type { Side } from '../review/types.js';

export type Severity = 'critical' | 'important' | 'minor';
export type Confidence = 'high' | 'medium' | 'low';

export interface Finding {
  /** Stable local id derived from the anchor and title. Not sent to GitHub. */
  id: string;
  path: string;
  line: number;
  side: Side;
  startLine: number | null;
  severity: Severity;
  title: string;
  body: string;
  confidence: Confidence;
  /** Replacement code for a GitHub suggestion block, when the model offered one. */
  suggestion: string | null;
}

export type RawFinding = Omit<Finding, 'id'>;
```

`src/core/findings/schema.ts`:

```ts
export const FINDINGS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'line', 'side', 'severity', 'title', 'body', 'confidence'],
        properties: {
          path: { type: 'string' },
          line: { type: 'integer', description: 'Line number in the side indicated below.' },
          side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
          startLine: { type: ['integer', 'null'] },
          severity: { type: 'string', enum: ['critical', 'important', 'minor'] },
          title: { type: 'string', description: 'One short clause.' },
          body: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          suggestion: { type: ['string', 'null'] },
        },
      },
    },
  },
};
```

`src/core/findings/find.ts`:

```ts
import { createHash } from 'node:crypto';
import type { AgentTransport } from '../agent/types.js';
import type { CheckRun, ReviewThread } from '../github/types.js';
import type { MeatResult } from '../meat/index.js';
import { FINDINGS_SCHEMA } from './schema.js';
import type { Finding, RawFinding } from './types.js';

export { FINDINGS_SCHEMA };
export type { Finding, RawFinding };

/** The agent may read the worktree. It may not change it or run commands in it. */
export const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'] as const;
export const DENIED_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'Bash'] as const;

export const FINDINGS_SYSTEM_PROMPT = `You are reviewing a pull request for a senior engineer who will decide what to do with each of your findings.

You have read-only access to the repository at the pull request's head commit. Use it: open the whole file when a hunk is not self-explanatory, grep for other callers before claiming a signature change is safe, and read the tests.

Report a finding only when you can name a concrete consequence — wrong output, a crash, a security hole, data loss, a broken contract for an existing caller. "Consider extracting this" is not a finding.

Anchor every finding to a line that appears in the diff you were given. A concern about code the diff does not touch still belongs in the report; anchor it to the nearest changed line and say so in the body.

Do not repeat a point an existing review thread already makes.

Be honest about confidence. A high-confidence finding you cannot substantiate costs the reviewer more than a low-confidence one you flag as uncertain.`;

export interface FindingsInput {
  prTitle: string;
  prBody: string;
  meat: MeatResult;
  threads: ReviewThread[];
  failingChecks: CheckRun[];
}

export function buildFindingsPrompt(input: FindingsInput): string {
  const parts: string[] = [`Pull request: ${input.prTitle}`];

  if (input.prBody.trim().length > 0) parts.push(`\nDescription:\n${input.prBody.trim()}`);
  if (input.meat.summary.length > 0) parts.push(`\nWhat this change does:\n${input.meat.summary}`);

  if (input.failingChecks.length > 0) {
    const lines = input.failingChecks.map(
      (c) => `- ${c.name}${c.output ? `: ${c.output}` : ''}`,
    );
    parts.push(`\nFailing checks:\n${lines.join('\n')}`);
  }

  if (input.threads.length > 0) {
    const lines = input.threads.flatMap((t) =>
      t.comments.map((c) => `- ${t.path}:${t.line ?? '?'} ${c.author}: ${c.body}`),
    );
    parts.push(`\nExisting review comments — do not repeat these:\n${lines.join('\n')}`);
  }

  parts.push('\nThe abridged diff follows. Only hunks worth reading are included.\n');

  for (const file of input.meat.files) {
    const kept = file.hunks.filter((h) => h.keep);
    if (kept.length === 0) continue;
    parts.push(`<file path="${file.file.path}">`);
    for (const meatHunk of kept) {
      const body = meatHunk.hunk.lines
        .map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`)
        .join('\n');
      parts.push(`${meatHunk.hunk.header}\n${body}`);
    }
    parts.push('</file>');
  }

  return parts.join('\n');
}

export function findingId(raw: RawFinding): string {
  return createHash('sha256')
    .update(`${raw.path}:${raw.side}:${raw.line}:${raw.title}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Runs the findings pass. Never throws: the agent passes are additive, and a
 * model failure must leave the reviewer with a fully usable manual review.
 */
export async function runFindings(
  transport: AgentTransport,
  model: string,
  input: FindingsInput,
  cwd: string,
): Promise<Finding[]> {
  let structured: unknown;
  try {
    const run = await transport.run({
      model,
      cwd,
      systemPrompt: FINDINGS_SYSTEM_PROMPT,
      prompt: buildFindingsPrompt(input),
      schema: FINDINGS_SCHEMA,
      allowedTools: [...READ_ONLY_TOOLS],
      disallowedTools: [...DENIED_TOOLS],
    });
    structured = run.structured;
  } catch {
    return [];
  }

  const raw = (structured as { findings?: RawFinding[] } | null)?.findings ?? [];
  return raw.map((f) => ({ ...f, id: findingId(f) }));
}
```

- [ ] **Step 4: Verify**

Run: `bun test tests/core/findings/find.test.ts && bun run typecheck && bun run lint:boundary`
Expected: 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/findings tests/core/findings
git commit -m "feat: add the read-only findings pass"
```

---

### Task 2: Adversarial verify pass

**Files:**
- Create: `src/core/findings/verify.ts`
- Test: `tests/core/findings/verify.test.ts`

**Interfaces produced:**
- `type Verdict = 'confirmed' | 'plausible' | 'refuted'`
- `interface Refutation { lens: Lens; refuted: boolean; reasoning: string }`
- `interface VerifiedFinding extends Finding { verdict: Verdict; refutations: Refutation[] }`
- `type Lens = 'reachability' | 'reproduction'`
- `const VERIFY_SCHEMA: Record<string, unknown>`
- `function buildVerifyPrompt(finding: Finding, lens: Lens): string`
- `function scoreVerdict(refutations: Refutation[]): Verdict`
- `function runVerify(transport, model, findings, cwd): Promise<VerifiedFinding[]>`

**Design note:** two lenses rather than two identical skeptics. *Reachability* asks whether the code path can be reached at all; *reproduction* asks whether the failure actually occurs when it is. Redundant refuters agree with each other; different lenses catch different mistakes.

- [ ] **Step 1: Write the failing tests**

`tests/core/findings/verify.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import { buildVerifyPrompt, runVerify, scoreVerdict, VERIFY_SCHEMA } from '../../../src/core/findings/verify.js';
import { FakeTransport } from '../../../src/core/agent/fake.js';
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
```

- [ ] **Step 2: Run to verify failure, then implement**

`src/core/findings/verify.ts`:

```ts
import type { AgentTransport } from '../agent/types.js';
import { DENIED_TOOLS, READ_ONLY_TOOLS } from './find.js';
import type { Finding } from './types.js';

export type Lens = 'reachability' | 'reproduction';
export type Verdict = 'confirmed' | 'plausible' | 'refuted';

export interface Refutation {
  lens: Lens;
  refuted: boolean;
  reasoning: string;
}

export interface VerifiedFinding extends Finding {
  verdict: Verdict;
  refutations: Refutation[];
}

export const LENSES: readonly Lens[] = ['reachability', 'reproduction'];

export const VERIFY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string', description: 'One or two sentences.' },
  },
};

const LENS_INSTRUCTION: Record<Lens, string> = {
  reachability:
    'Determine whether the code path this claim depends on is reachable at all. Read the callers. If nothing can reach it — dead code, an impossible branch, a guard upstream — the claim is refuted.',
  reproduction:
    'Determine whether the described failure actually occurs when the path runs. Read the surrounding code and the tests. If the failure cannot reproduce — the value is always validated, the error is caught, the case is already handled — the claim is refuted.',
};

export function buildVerifyPrompt(finding: Finding, lens: Lens): string {
  return [
    'Your job is to REFUTE the claim below, not to agree with it. Assume it is wrong and look for the evidence.',
    '',
    `Claim: ${finding.title}`,
    `Location: ${finding.path}:${finding.line} (${finding.side})`,
    `Detail: ${finding.body}`,
    '',
    LENS_INSTRUCTION[lens],
    '',
    'If you cannot find evidence that refutes it, say so — do not manufacture a refutation. Answer with refuted true or false and one or two sentences of reasoning.',
  ].join('\n');
}

/**
 * Both lenses must refute to call a finding refuted; a split is `plausible`.
 * Zero refutations means verification did not run, which is NOT the same as
 * being confirmed — it must never silently promote a finding.
 */
export function scoreVerdict(refutations: Refutation[]): Verdict {
  if (refutations.length === 0) return 'plausible';
  const refuting = refutations.filter((r) => r.refuted).length;
  if (refuting === 0) return 'confirmed';
  if (refuting === refutations.length) return 'refuted';
  return 'plausible';
}

export async function runVerify(
  transport: AgentTransport,
  model: string,
  findings: Finding[],
  cwd: string,
): Promise<VerifiedFinding[]> {
  return Promise.all(
    findings.map(async (finding) => {
      const results = await Promise.all(
        LENSES.map(async (lens): Promise<Refutation | null> => {
          try {
            const run = await transport.run({
              model,
              cwd,
              prompt: buildVerifyPrompt(finding, lens),
              schema: VERIFY_SCHEMA,
              allowedTools: [...READ_ONLY_TOOLS],
              disallowedTools: [...DENIED_TOOLS],
            });
            const s = run.structured as { refuted?: boolean; reasoning?: string } | null;
            if (!s) return null;
            return { lens, refuted: s.refuted === true, reasoning: s.reasoning ?? '' };
          } catch {
            return null;
          }
        }),
      );

      const refutations = results.filter((r): r is Refutation => r !== null);
      return { ...finding, verdict: scoreVerdict(refutations), refutations };
    }),
  );
}
```

- [ ] **Step 3: Verify**

Run: `bun test tests/core/findings/ && bun run typecheck && bun run lint:boundary`
Expected: 20 tests PASS across both files.

- [ ] **Step 4: Commit**

```bash
git add src/core/findings/verify.ts tests/core/findings/verify.test.ts
git commit -m "feat: add the adversarial verify pass with two distinct lenses"
```

---

### Task 3: Triage — turning findings into staged comments

**Files:**
- Create: `src/core/findings/triage.ts`
- Test: `tests/core/findings/triage.test.ts`

**Interfaces produced:**
- `type TriageState = 'pending' | 'accepted' | 'dropped'`
- `interface TriagedFinding extends VerifiedFinding { state: TriageState; editedBody: string | null; asSuggestion: boolean }`
- `function initTriage(findings: VerifiedFinding[]): TriagedFinding[]`
- `function accept(list, id): TriagedFinding[]`, `drop(list, id)`, `edit(list, id, body)`, `toggleSuggestion(list, id)`
- `function toStagedComments(list: TriagedFinding[]): StagedComment[]`
- `function visibleFindings(list: TriagedFinding[], showRefuted: boolean): TriagedFinding[]`

- [ ] **Step 1: Write the failing tests**

`tests/core/findings/triage.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import {
  accept, drop, edit, initTriage, toggleSuggestion, toStagedComments, visibleFindings,
} from '../../../src/core/findings/triage.js';
import type { VerifiedFinding } from '../../../src/core/findings/verify.js';

function vf(id: string, over: Partial<VerifiedFinding> = {}): VerifiedFinding {
  return {
    id, path: 'a.ts', line: 10, side: 'RIGHT', startLine: null,
    severity: 'important', title: `t-${id}`, body: `b-${id}`,
    confidence: 'high', suggestion: null, verdict: 'confirmed', refutations: [], ...over,
  };
}

describe('initTriage', () => {
  test('everything starts pending and unedited', () => {
    const list = initTriage([vf('a'), vf('b')]);
    expect(list.every((f) => f.state === 'pending')).toBe(true);
    expect(list.every((f) => f.editedBody === null && !f.asSuggestion)).toBe(true);
  });
});

describe('transitions', () => {
  test('accept and drop affect only the named finding', () => {
    let list = initTriage([vf('a'), vf('b')]);
    list = accept(list, 'a');
    expect(list.find((f) => f.id === 'a')!.state).toBe('accepted');
    expect(list.find((f) => f.id === 'b')!.state).toBe('pending');

    list = drop(list, 'b');
    expect(list.find((f) => f.id === 'b')!.state).toBe('dropped');
    expect(list.find((f) => f.id === 'a')!.state).toBe('accepted');
  });

  test('editing sets the body and accepts, since editing implies keeping', () => {
    const list = edit(initTriage([vf('a')]), 'a', 'my words');
    expect(list[0]!.editedBody).toBe('my words');
    expect(list[0]!.state).toBe('accepted');
  });

  test('an unknown id is a no-op rather than an error', () => {
    const before = initTriage([vf('a')]);
    expect(accept(before, 'nope')).toEqual(before);
  });

  test('toggling a suggestion flips it', () => {
    let list = initTriage([vf('a', { suggestion: 'const x = 1;' })]);
    list = toggleSuggestion(list, 'a');
    expect(list[0]!.asSuggestion).toBe(true);
    list = toggleSuggestion(list, 'a');
    expect(list[0]!.asSuggestion).toBe(false);
  });
});

describe('toStagedComments', () => {
  test('stages only accepted findings', () => {
    let list = initTriage([vf('a'), vf('b'), vf('c')]);
    list = accept(list, 'a');
    list = drop(list, 'b');
    const staged = toStagedComments(list);
    expect(staged).toHaveLength(1);
    expect(staged[0]!.id).toBe('a');
  });

  test('prefers the edited body over the model text', () => {
    const list = edit(initTriage([vf('a')]), 'a', 'my words');
    expect(toStagedComments(list)[0]!.body).toBe('my words');
  });

  test('carries the suggestion only when toggled on', () => {
    let list = initTriage([vf('a', { suggestion: 'const x = 1;' })]);
    list = accept(list, 'a');
    expect(toStagedComments(list)[0]!.suggestion).toBeNull();

    list = toggleSuggestion(list, 'a');
    expect(toStagedComments(list)[0]!.suggestion).toBe('const x = 1;');
  });

  test('preserves the anchor exactly', () => {
    const list = accept(initTriage([vf('a', { line: 42, side: 'LEFT', startLine: 40 })]), 'a');
    const staged = toStagedComments(list)[0]!;
    expect(staged.line).toBe(42);
    expect(staged.side).toBe('LEFT');
    expect(staged.startLine).toBe(40);
  });
});

describe('visibleFindings', () => {
  test('hides refuted findings by default but never deletes them', () => {
    const list = initTriage([vf('a'), vf('b', { verdict: 'refuted' })]);
    expect(visibleFindings(list, false).map((f) => f.id)).toEqual(['a']);
    expect(visibleFindings(list, true).map((f) => f.id)).toEqual(['a', 'b']);
  });

  test('plausible findings stay visible — only refuted collapse', () => {
    const list = initTriage([vf('a', { verdict: 'plausible' })]);
    expect(visibleFindings(list, false)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

`src/core/findings/triage.ts`:

```ts
import type { StagedComment } from '../review/types.js';
import type { VerifiedFinding } from './verify.js';

export type TriageState = 'pending' | 'accepted' | 'dropped';

export interface TriagedFinding extends VerifiedFinding {
  state: TriageState;
  /** The reviewer's own wording, when they rewrote the model's. */
  editedBody: string | null;
  asSuggestion: boolean;
}

export function initTriage(findings: VerifiedFinding[]): TriagedFinding[] {
  return findings.map((f) => ({ ...f, state: 'pending', editedBody: null, asSuggestion: false }));
}

function update(
  list: TriagedFinding[],
  id: string,
  change: (f: TriagedFinding) => TriagedFinding,
): TriagedFinding[] {
  return list.map((f) => (f.id === id ? change(f) : f));
}

export function accept(list: TriagedFinding[], id: string): TriagedFinding[] {
  return update(list, id, (f) => ({ ...f, state: 'accepted' }));
}

export function drop(list: TriagedFinding[], id: string): TriagedFinding[] {
  return update(list, id, (f) => ({ ...f, state: 'dropped' }));
}

/** Editing implies keeping — nobody rewrites a comment they intend to discard. */
export function edit(list: TriagedFinding[], id: string, body: string): TriagedFinding[] {
  return update(list, id, (f) => ({ ...f, editedBody: body, state: 'accepted' }));
}

export function toggleSuggestion(list: TriagedFinding[], id: string): TriagedFinding[] {
  return update(list, id, (f) => ({ ...f, asSuggestion: !f.asSuggestion }));
}

export function toStagedComments(list: TriagedFinding[]): StagedComment[] {
  return list
    .filter((f) => f.state === 'accepted')
    .map((f) => ({
      id: f.id,
      path: f.path,
      line: f.line,
      side: f.side,
      startLine: f.startLine,
      body: f.editedBody ?? f.body,
      suggestion: f.asSuggestion ? f.suggestion : null,
    }));
}

/**
 * Refuted findings collapse out of the default view but are never deleted — if
 * the verifier was wrong, the reviewer has to be able to see that it was.
 */
export function visibleFindings(
  list: TriagedFinding[],
  showRefuted: boolean,
): TriagedFinding[] {
  return showRefuted ? list : list.filter((f) => f.verdict !== 'refuted');
}
```

- [ ] **Step 3: Verify and commit**

Run: `bun test tests/core/findings/ && bun run typecheck && bun run lint:boundary` → 33 tests PASS.

```bash
git add src/core/findings/triage.ts tests/core/findings/triage.test.ts
git commit -m "feat: add finding triage that stages accepted findings as comments"
```

---

### Task 4: Render findings in the detail pane

**Files:**
- Create: `src/tui/components/FindingCard.tsx`
- Modify: `src/tui/units.ts` (add a `finding` unit kind), `src/tui/components/Detail.tsx`
- Test: `tests/tui/finding.test.tsx`, extend `tests/tui/units.test.ts`

**Interfaces produced:**
- `ReviewUnit` gains `| { kind: 'finding'; file: MeatFile; finding: TriagedFinding; index: number }`
- `buildUnits` gains an optional `findings: TriagedFinding[]` in `UnitOptions`, placing each finding immediately after the hunk containing its anchor line
- `<FindingCard finding={TriagedFinding} selected={boolean} />`

**Design rules:** the card renders in `theme.color.agent` (magenta) — the token reserved for model-authored content, so you can always tell the model's words from your colleagues'. Severity is a typographic mark, not a colored badge or emoji. An accepted finding shows `theme.glyph.staged` in `theme.color.pending`. A refuted finding renders dim with its refutation reasoning.

- [ ] **Step 1: Write the failing tests**

`tests/tui/finding.test.tsx`:

```tsx
import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { FindingCard } from '../../src/tui/components/FindingCard.js';
import { initTriage, accept } from '../../src/core/findings/triage.js';
import type { VerifiedFinding } from '../../src/core/findings/verify.js';

const base: VerifiedFinding = {
  id: 'f1', path: 'src/api.ts', line: 11, side: 'RIGHT', startLine: null,
  severity: 'important', title: 'Busy-wait', body: 'sleep(0) does not yield to the loop.',
  confidence: 'high', suggestion: null, verdict: 'confirmed', refutations: [],
};

describe('FindingCard', () => {
  test('shows the title, body, and severity', () => {
    const [f] = initTriage([base]);
    const out = renderToString(<FindingCard finding={f!} selected={false} />);
    expect(out).toContain('Busy-wait');
    expect(out).toContain('sleep(0) does not yield');
    expect(out.toLowerCase()).toContain('important');
  });

  test('marks an accepted finding as staged', () => {
    const list = accept(initTriage([base]), 'f1');
    const out = renderToString(<FindingCard finding={list[0]!} selected={false} />);
    expect(out).toContain('staged');
  });

  test('shows the refutation reasoning on a refuted finding', () => {
    const [f] = initTriage([{
      ...base, verdict: 'refuted',
      refutations: [{ lens: 'reachability', refuted: true, reasoning: 'guarded upstream' }],
    }]);
    const out = renderToString(<FindingCard finding={f!} selected={false} />);
    expect(out).toContain('guarded upstream');
  });

  test('distinguishes plausible from confirmed', () => {
    const [conf] = initTriage([base]);
    const [plaus] = initTriage([{ ...base, verdict: 'plausible' }]);
    const a = renderToString(<FindingCard finding={conf!} selected={false} />);
    const b = renderToString(<FindingCard finding={plaus!} selected={false} />);
    expect(a).not.toBe(b);
    expect(b.toLowerCase()).toContain('plausible');
  });

  test('shows that a suggestion is available', () => {
    const [f] = initTriage([{ ...base, suggestion: 'await sleep(1);' }]);
    const out = renderToString(<FindingCard finding={f!} selected={false} />);
    expect(out.toLowerCase()).toContain('suggestion');
  });
});
```

- [ ] **Step 2: Implement `FindingCard`**

`src/tui/components/FindingCard.tsx`:

```tsx
import { Box, Text } from 'ink';
import type { TriagedFinding } from '../../core/findings/triage.js';
import { theme } from '../theme.js';

/** Typographic severity marks — no emoji, whose cell width is unreliable. */
const SEVERITY_MARK: Record<TriagedFinding['severity'], string> = {
  critical: '!!',
  important: '!',
  minor: '·',
};

export interface FindingCardProps {
  finding: TriagedFinding;
  selected: boolean;
}

export function FindingCard({ finding, selected }: FindingCardProps) {
  const refuted = finding.verdict === 'refuted';

  return (
    <Box flexDirection="column" marginLeft={3}>
      <Text
        color={refuted ? undefined : theme.color.agent}
        dimColor={refuted}
        inverse={selected}
      >
        {`${SEVERITY_MARK[finding.severity]} ${finding.title}`}
        <Text {...theme.tier.muted}>{`  ${finding.severity}`}</Text>
        {finding.verdict !== 'confirmed' && (
          <Text {...theme.tier.muted}>{`  ${finding.verdict}`}</Text>
        )}
        {finding.state === 'accepted' && (
          <Text color={theme.color.pending}>{`  ${theme.glyph.staged} staged`}</Text>
        )}
      </Text>

      <Text dimColor={refuted} {...(refuted ? {} : theme.tier.secondary)}>
        {`  ${finding.editedBody ?? finding.body}`}
      </Text>

      {finding.suggestion !== null && (
        <Text {...theme.tier.muted}>{'  suggestion available — press s'}</Text>
      )}

      {refuted &&
        finding.refutations.map((r, i) => (
          <Text key={i} {...theme.tier.muted}>{`  refuted (${r.lens}): ${r.reasoning}`}</Text>
        ))}
    </Box>
  );
}
```

- [ ] **Step 3: Extend `buildUnits` to place findings after their hunk**

In `src/tui/units.ts`, add the `finding` variant to `ReviewUnit`, add `findings?: TriagedFinding[]` to `UnitOptions`, and after emitting each hunk unit, emit a finding unit for every finding whose `path` matches the file and whose anchor line falls inside that hunk's line range. Findings whose anchor matches no shown hunk are emitted after that file's last hunk, so none is ever invisible.

Add to `tests/tui/units.test.ts`:

```ts
test('places a finding immediately after the hunk containing its anchor', () => {
  // Construct a MeatResult with two kept hunks and a finding anchored in the second.
  // Assert the unit order is: file-header, hunk, hunk, finding.
});

test('a finding whose anchor matches no shown hunk still appears', () => {
  // Assert it is emitted after the file's last hunk rather than dropped.
});
```

Write those two tests concretely following the existing helpers in that file.

- [ ] **Step 4: Verify and commit**

Run: `bun test tests/tui/ && bun run typecheck && bun run lint:boundary`

```bash
git add src/tui/components/FindingCard.tsx src/tui/units.ts tests/tui
git commit -m "feat(tui): render findings inline, in the reserved agent color"
```

---

### Task 5: Chat pane

**Files:**
- Create: `src/core/findings/chat.ts`, `src/tui/components/ChatPane.tsx`
- Test: `tests/core/findings/chat.test.ts`

**Interfaces produced:**
- `interface ChatTurn { role: 'user' | 'agent'; text: string }`
- `interface ChatSession { id: string | null; turns: ChatTurn[] }`
- `function buildChatContext(unit: ReviewUnitLike): string`
- `function ask(transport, model, session, question, cwd): Promise<ChatSession>`
- `<ChatPane session={ChatSession} pending={boolean} />`

**Design note:** `ask` threads `session.id` into `AgentRequest.resume`, so follow-up questions reuse the agent's context instead of re-establishing it. That is the difference between a usable chat and one that re-reads the repo on every question.

- [ ] **Step 1: Write the failing tests**

`tests/core/findings/chat.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import { ask, buildChatContext } from '../../../src/core/findings/chat.js';
import { FakeTransport } from '../../../src/core/agent/fake.js';

const hunkContext = {
  path: 'src/api.ts',
  header: '@@ -10,2 +10,3 @@ retry()',
  lines: [
    { kind: 'context' as const, text: 'function retry() {' },
    { kind: 'add' as const, text: '  await sleep(0);' },
  ],
};

describe('buildChatContext', () => {
  test('includes the path, header, and lines with markers', () => {
    const ctx = buildChatContext(hunkContext);
    expect(ctx).toContain('src/api.ts');
    expect(ctx).toContain('@@ -10,2 +10,3 @@');
    expect(ctx).toContain('+  await sleep(0);');
  });
});

describe('ask', () => {
  test('the first question starts a session and records both turns', async () => {
    const transport = new FakeTransport();
    transport.queue({ text: 'Because sleep(0) resolves immediately.', sessionId: 's1' });

    const session = await ask(transport, 'opus', { id: null, turns: [] }, 'why?', '/tmp/wt');
    expect(session.id).toBe('s1');
    expect(session.turns).toEqual([
      { role: 'user', text: 'why?' },
      { role: 'agent', text: 'Because sleep(0) resolves immediately.' },
    ]);
    expect(transport.requests[0]!.resume).toBeUndefined();
  });

  test('a follow-up resumes the existing session rather than starting over', async () => {
    const transport = new FakeTransport();
    transport.queue({ text: 'second', sessionId: 's1' });

    await ask(transport, 'opus', { id: 's1', turns: [{ role: 'user', text: 'first' }] }, 'more?', '/tmp/wt');
    expect(transport.requests[0]!.resume).toBe('s1');
  });

  test('a failure appends an error turn instead of throwing', async () => {
    const transport = { async run() { throw new Error('SDK died'); } };
    const session = await ask(transport as never, 'opus', { id: null, turns: [] }, 'why?', '/tmp/wt');
    expect(session.turns).toHaveLength(2);
    expect(session.turns[1]!.role).toBe('agent');
    expect(session.turns[1]!.text.toLowerCase()).toContain('could not');
  });

  test('chat is read-only too', async () => {
    const transport = new FakeTransport();
    transport.queue({ text: 'x', sessionId: 's1' });
    await ask(transport, 'opus', { id: null, turns: [] }, 'q', '/tmp/wt');
    expect(transport.requests[0]!.disallowedTools).toContain('Bash');
  });
});
```

- [ ] **Step 2: Implement**

`src/core/findings/chat.ts`:

```ts
import type { AgentTransport } from '../agent/types.js';
import { DENIED_TOOLS, READ_ONLY_TOOLS } from './find.js';

export interface ChatTurn {
  role: 'user' | 'agent';
  text: string;
}

export interface ChatSession {
  /** Agent SDK session id, so follow-ups resume rather than start over. */
  id: string | null;
  turns: ChatTurn[];
}

export interface ReviewUnitLike {
  path: string;
  header: string;
  lines: Array<{ kind: 'context' | 'add' | 'del'; text: string }>;
}

export function buildChatContext(unit: ReviewUnitLike): string {
  const body = unit.lines
    .map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`)
    .join('\n');
  return `File: ${unit.path}\n${unit.header}\n${body}`;
}

const CHAT_SYSTEM_PROMPT =
  'You are answering questions about a pull request under review. You have read-only access to the repository at the head commit. Answer concretely and briefly; read the code before speculating. If you do not know, say so.';

export async function ask(
  transport: AgentTransport,
  model: string,
  session: ChatSession,
  question: string,
  cwd: string,
): Promise<ChatSession> {
  const turns: ChatTurn[] = [...session.turns, { role: 'user', text: question }];

  try {
    const run = await transport.run({
      model,
      cwd,
      systemPrompt: CHAT_SYSTEM_PROMPT,
      prompt: question,
      allowedTools: [...READ_ONLY_TOOLS],
      disallowedTools: [...DENIED_TOOLS],
      ...(session.id ? { resume: session.id } : {}),
    });
    return { id: run.sessionId, turns: [...turns, { role: 'agent', text: run.text }] };
  } catch {
    return {
      id: session.id,
      turns: [...turns, { role: 'agent', text: 'Could not reach the model. Your review is unaffected.' }],
    };
  }
}
```

`src/tui/components/ChatPane.tsx` renders the turns — user turns in `theme.tier.secondary`, agent turns in `theme.color.agent`, and a `theme.tier.muted` "thinking…" line while `pending`. (This is the one place a pending indicator is allowed: the user explicitly asked a question and is waiting on the answer.)

- [ ] **Step 3: Verify and commit**

Run: `bun test tests/core/findings/ && bun run typecheck && bun run lint:boundary`

```bash
git add src/core/findings/chat.ts src/tui/components/ChatPane.tsx tests/core/findings/chat.test.ts
git commit -m "feat: add the chat pane with session resume"
```

---

### Task 6: Wire findings into the app

**Files:**
- Modify: `src/tui/App.tsx`, `src/tui/keymap.ts`, `src/cli.tsx`
- Test: extend `tests/tui/keymap.test.ts`

**What changes:**
- Keymap gains detail-mode actions: `a` accept, `e` edit, `s` toggle suggestion, `x` drop, `v` show refutations, `n`/`p` next/previous finding, `i` open chat. Add a `chat` mode that, like `comment` and `search`, swallows every key except escape.
- `App` runs `runFindings` then `runVerify` after `computeMeat` resolves, holds `TriagedFinding[]`, and passes `toStagedComments(findings)` into the draft it hands the submit screen.
- The status bar's staged count includes accepted findings.
- `src/cli.tsx` passes the worktree path as `cwd` so the agent can read the repo, and skips both passes entirely in `--dry-run`.

**The property to preserve, and to test:** findings are additive. If `runFindings` returns `[]` — because the model failed, the transport died, or the user is offline — the reviewer still has the full diff, navigation, manual comments, and submit. Add a keymap test that the new letters do nothing in `chat` mode, and an App-level test that a findings failure leaves the detail pane rendering.

- [ ] Verify: `bun test && bun run typecheck && bun run lint:boundary && bun run build`
- [ ] Smoke-test `marrow <n>` against a real PR and confirm findings appear, `a` stages one, and `!` shows it on the submit screen.
- [ ] Commit.

---

## Plan 3 self-review

**Spec coverage.** AI-drafted findings → Task 1. Read-only tool policy → Task 1, asserted in tests. Adversarial verify with distinct lenses → Task 2. Confirmed/plausible/refuted labels with refuted collapsed-not-deleted → Tasks 2 and 3. Triage keystrokes and staging → Tasks 3 and 6. Suggestion blocks → Task 3. Freeform chat with session resume → Task 5. Findings rendered distinguishably → Task 4.

**Deliberately not here.** Cross-repo inbox, thread replies, editing submitted comments — out of scope per the spec. Syntax highlighting stays deferred from Plan 2.

**Type consistency.** `Finding` is defined once in `findings/types.ts`; `VerifiedFinding` extends it; `TriagedFinding` extends that. `READ_ONLY_TOOLS`/`DENIED_TOOLS` are defined once in `find.ts` and reused by `verify.ts` and `chat.ts`, so the read-only policy cannot drift between passes.

**Known risk.** Task 6 is the integration task and the only one whose verification is partly interactive; if it stalls, split the keymap and triage wiring from the CLI wiring.
