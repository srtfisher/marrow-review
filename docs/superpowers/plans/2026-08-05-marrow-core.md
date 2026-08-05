# marrow Core Engine Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build marrow's core library and a working CLI that abridges a GitHub pull request diff down to its meaningful hunks and can construct and submit a validated GitHub review.

**Architecture:** One npm package with a hard boundary between `src/core/**` (pure, no UI) and later UI code, enforced by dependency-cruiser in CI. Core is a set of single-responsibility modules: diff parsing, GitHub access, git worktrees, the meat rule engine, an injectable-transport Agent SDK wrapper, and a review state machine. The CLI in this plan is a thin stdout renderer that proves the pipeline end to end.

**Tech Stack:** TypeScript (strict), Node 24 ESM, bun for install/test, `@octokit/rest` 22.0.1, `@anthropic-ai/claude-agent-sdk` 0.3.222, `zod`, `dependency-cruiser`. `gh` CLI 2.97+ at runtime for auth.

**Spec:** `docs/superpowers/specs/2026-08-05-marrow-design.md`

**Not in this plan:** Ink TUI (Plan 2). Findings pass, adversarial verify, chat (Plan 3). Resume/persistence beyond the meat verdict cache (Plan 2, where triage state first exists).

## Global Constraints

Every task's requirements implicitly include this section.

- **Package name** `@srtfisher/marrow`, **binary name** `marrow`.
- **Node 24**, `"type": "module"`. TypeScript `strict: true`, `module: "nodenext"`, `moduleResolution: "nodenext"`.
- **All relative imports MUST carry a `.js` extension** (`import { x } from './foo.js'`) even though the source file is `.ts`. This is required by Node ESM + `nodenext`. Getting this wrong produces `ERR_MODULE_NOT_FOUND` at runtime but compiles clean.
- **`src/core/**` must never import from `src/tui/**` or from `ink`.** Enforced by dependency-cruiser (Task 1).
- **Test runner is `bun test`.** Import from `bun:test`: `import { test, expect, describe } from 'bun:test'`.
- **No live network calls in tests.** GitHub is tested against recorded JSON fixtures; the Agent SDK is tested against a fake transport.
- **Exact dependency versions:** `ink@7.1.1` (Plan 2), `@anthropic-ai/claude-agent-sdk@0.3.222`, `@octokit/rest@22.0.1`, `ink-text-input@6.0.0` (Plan 2).
- **Anthropic auth defaults to the Claude Code subscription.** `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are stripped from the agent subprocess environment unless `--use-api-key` is passed.
- **Never show per-token dollar figures as user cost.** Under subscription auth nothing is billed per token.
- Commit after every task. Conventional commit prefixes (`feat:`, `test:`, `chore:`).

## Verified SDK facts

These were read from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` at version 0.3.222. Do not substitute values recalled from documentation.

- `query({ prompt, options })` returns a `Query` (an `AsyncGenerator<SDKMessage, void>`).
- Message discriminator is `type: 'assistant' | 'system' | 'result' | ...` — **not** `'assistant_message'`.
- `SDKResultSuccess` = `{ type: 'result', subtype: 'success', result: string, structured_output?: unknown, total_cost_usd: number, usage: NonNullableUsage, modelUsage: Record<string, ModelUsage>, num_turns: number, stop_reason: string | null, session_id: string, ... }`.
- Structured output is native: `options.outputFormat = { type: 'json_schema', schema: Record<string, unknown> }`; the parsed value arrives on the result message's `structured_output`.
- `options.env?: { [k: string]: string | undefined }` — when omitted the subprocess inherits `process.env`. Passing a key as `undefined` removes it.
- Relevant `Options` fields: `systemPrompt`, `allowedTools`, `disallowedTools`, `canUseTool`, `permissionMode`, `mcpServers`, `agents`, `model`, `cwd`, `resume`, `forkSession`, `sessionId`, `persistSession`, `maxTurns`, `abortController`, `includePartialMessages`, `outputFormat`, `env`.
- Exported constants `USAGE_LIMIT_ERROR_PREFIXES`, `USAGE_WARNING_PREFIXES` can be matched against system/result text to detect subscription usage limits.

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `.dependency-cruiser.cjs` | Build, test, and the core/tui boundary rule. |
| `src/core/diff/types.ts` | `DiffFile`, `Hunk`, `DiffLine` and friends. The vocabulary everything else speaks. |
| `src/core/diff/parse.ts` | Unified-diff parser. Assigns old/new line numbers per line. |
| `src/core/github/types.ts` | Domain types: `PullRequestSummary`, `PullRequestDetail`, `ReviewThread`, `CheckRun`. |
| `src/core/github/auth.ts` | Resolves a GitHub token from `gh auth token`, falling back to `GITHUB_TOKEN`. |
| `src/core/github/client.ts` | Octokit REST wrapper: list PRs, get PR, get raw diff. |
| `src/core/github/graphql.ts` | Review threads and check runs in one GraphQL query. |
| `src/core/github/submit.ts` | `createReview` call. Separated from reads so the write path is easy to audit. |
| `src/core/git/repo.ts` | Detect repo root and `owner/repo` from the current directory. |
| `src/core/git/worktree.ts` | Fetch PR head ref, create/reuse/prune detached worktrees. |
| `src/core/git/gitattributes.ts` | Parse `.gitattributes` for `linguist-generated` paths. |
| `src/core/meat/rules.ts` | The deterministic rule table and its evaluator. |
| `src/core/meat/classify.ts` | LLM classification pass over surviving hunks. |
| `src/core/meat/cache.ts` | Verdict cache keyed by hunk content hash. |
| `src/core/meat/index.ts` | Orchestrates rules → cache → classify into a `MeatResult`. |
| `src/core/agent/types.ts` | `AgentRequest`, `AgentRun`, `AgentTransport`, `UsageSummary`. |
| `src/core/agent/sdk.ts` | `SdkTransport` — the only file that imports the Agent SDK. |
| `src/core/agent/fake.ts` | `FakeTransport` for tests. |
| `src/core/review/types.ts` | `StagedComment`, `ReviewDraft`, `Verdict`. |
| `src/core/review/anchors.ts` | Anchor validation and the demote-to-top-level path. |
| `src/core/review/payload.ts` | Builds the GitHub `createReview` payload. |
| `src/cli.ts` | Arg parsing and stdout rendering. |
| `tests/fixtures/diffs/*.diff` | Real diff corpus. |
| `tests/fixtures/github/*.json` | Recorded API responses. |

---

### Task 1: Project scaffolding and the core boundary

**Files:**
- Create: `package.json`, `tsconfig.json`, `.dependency-cruiser.cjs`, `.gitignore`, `src/core/version.ts`, `tests/version.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MARROW_VERSION: string` from `src/core/version.ts`. A working `bun test` and `bun run lint:boundary`.

- [ ] **Step 1: Write the failing test**

`tests/version.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { MARROW_VERSION } from '../src/core/version.js';

test('exports a semver version string', () => {
  expect(MARROW_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/version.test.ts`
Expected: FAIL — cannot resolve `../src/core/version.js`.

- [ ] **Step 3: Create the package and TypeScript config**

`package.json`:

```json
{
  "name": "@srtfisher/marrow",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "marrow": "./dist/cli.js" },
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "bun test",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint:boundary": "depcruise src --config .dependency-cruiser.cjs"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "0.3.222",
    "@octokit/rest": "22.0.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "dependency-cruiser": "^16.0.0",
    "typescript": "^5.6.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

`.gitignore`:

```
node_modules/
dist/
*.log
```

- [ ] **Step 4: Add the boundary rule**

`.dependency-cruiser.cjs`:

```js
module.exports = {
  forbidden: [
    {
      name: 'core-must-not-import-ui',
      severity: 'error',
      comment: 'src/core must stay UI-free so it can back a non-terminal frontend later.',
      from: { path: '^src/core' },
      to: { path: '^(src/tui|node_modules/(ink|ink-text-input|react))' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
```

- [ ] **Step 5: Write the implementation**

`src/core/version.ts`:

```ts
export const MARROW_VERSION = '0.1.0';
```

- [ ] **Step 6: Install and verify the test passes**

Run: `bun install && bun test tests/version.test.ts && bun run typecheck && bun run lint:boundary`
Expected: test PASS, typecheck clean, dependency-cruiser reports no violations.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .dependency-cruiser.cjs .gitignore bun.lock src tests
git commit -m "chore: scaffold marrow package with enforced core/UI boundary"
```

---

### Task 2: Unified diff parser

The module every anchoring bug traces back to. Build the fixture corpus first.

**Files:**
- Create: `src/core/diff/types.ts`, `src/core/diff/parse.ts`
- Create: `tests/fixtures/diffs/modify.diff`, `added.diff`, `deleted.diff`, `rename.diff`, `binary.diff`, `no-newline.diff`, `multi-hunk.diff`
- Test: `tests/core/diff/parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LineKind = 'context' | 'add' | 'del'`
  - `interface DiffLine { kind: LineKind; text: string; oldLine: number | null; newLine: number | null; noNewlineAtEof: boolean }`
  - `interface Hunk { header: string; section: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] }`
  - `type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'binary'`
  - `interface DiffFile { path: string; oldPath: string | null; status: FileStatus; similarity: number | null; hunks: Hunk[]; additions: number; deletions: number }`
  - `function parseUnifiedDiff(diff: string): DiffFile[]`

- [ ] **Step 1: Create the fixture corpus**

`tests/fixtures/diffs/modify.diff`:

```
diff --git a/src/app.ts b/src/app.ts
index 1234567..89abcde 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,5 +10,6 @@ export function boot() {
   const config = load();
   validate(config);
-  start(config);
+  const server = start(config);
+  server.on('error', fail);
   return config;
 }
```

The hunk counts above are the real ones for this body: 4 context + 1 deletion = 5
old lines, 4 context + 2 additions = 6 new lines. Verified against actual `git diff`
output for the same edit. Transcribe them exactly — a fixture that is not valid git
output would teach the parser the wrong thing while still showing a green suite.

`tests/fixtures/diffs/added.diff`:

```
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const a = 1;
+export const b = 2;
```

`tests/fixtures/diffs/deleted.diff`:

```
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 1111111..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const a = 1;
-export const b = 2;
```

`tests/fixtures/diffs/rename.diff`:

```
diff --git a/src/a.ts b/src/b.ts
similarity index 100%
rename from src/a.ts
rename to src/b.ts
```

`tests/fixtures/diffs/binary.diff`:

```
diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
Binary files a/logo.png and b/logo.png differ
```

`tests/fixtures/diffs/no-newline.diff`:

```
diff --git a/x.txt b/x.txt
index 1111111..2222222 100644
--- a/x.txt
+++ b/x.txt
@@ -1 +1 @@
-old
\ No newline at end of file
+new
\ No newline at end of file
```

`tests/fixtures/diffs/multi-hunk.diff`:

```
diff --git a/src/m.ts b/src/m.ts
index 1111111..2222222 100644
--- a/src/m.ts
+++ b/src/m.ts
@@ -1,3 +1,4 @@ function first()
 a
+b
 c
 d
@@ -20,2 +21,2 @@ function second()
-old line
+new line
 tail
```

- [ ] **Step 2: Write the failing tests**

`tests/core/diff/parse.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseUnifiedDiff } from '../../../src/core/diff/parse.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/diffs/${name}.diff`, import.meta.url), 'utf8');

describe('parseUnifiedDiff', () => {
  test('assigns old and new line numbers correctly', () => {
    const [file] = parseUnifiedDiff(fixture('modify'));
    expect(file!.path).toBe('src/app.ts');
    expect(file!.status).toBe('modified');
    expect(file!.additions).toBe(2);
    expect(file!.deletions).toBe(1);

    const hunk = file!.hunks[0]!;
    expect(hunk.oldStart).toBe(10);
    expect(hunk.newStart).toBe(10);
    expect(hunk.section).toBe('export function boot() {');

    // context, context, del, add, add, context, context
    expect(hunk.lines.map((l) => l.kind)).toEqual([
      'context', 'context', 'del', 'add', 'add', 'context', 'context',
    ]);

    const del = hunk.lines[2]!;
    expect(del.oldLine).toBe(12);
    expect(del.newLine).toBeNull();
    expect(del.text).toBe('  start(config);');

    const firstAdd = hunk.lines[3]!;
    expect(firstAdd.oldLine).toBeNull();
    expect(firstAdd.newLine).toBe(12);

    const trailing = hunk.lines[5]!;
    expect(trailing.oldLine).toBe(13);
    expect(trailing.newLine).toBe(14);
  });

  test('parses an added file', () => {
    const [file] = parseUnifiedDiff(fixture('added'));
    expect(file!.status).toBe('added');
    expect(file!.path).toBe('src/new.ts');
    expect(file!.hunks[0]!.lines.every((l) => l.kind === 'add')).toBe(true);
    expect(file!.hunks[0]!.lines[0]!.newLine).toBe(1);
  });

  test('parses a deleted file and keeps its old path', () => {
    const [file] = parseUnifiedDiff(fixture('deleted'));
    expect(file!.status).toBe('deleted');
    expect(file!.path).toBe('src/old.ts');
    expect(file!.deletions).toBe(2);
  });

  test('parses a pure rename with no hunks', () => {
    const [file] = parseUnifiedDiff(fixture('rename'));
    expect(file!.status).toBe('renamed');
    expect(file!.oldPath).toBe('src/a.ts');
    expect(file!.path).toBe('src/b.ts');
    expect(file!.similarity).toBe(100);
    expect(file!.hunks).toHaveLength(0);
  });

  test('marks binary files and produces no hunks', () => {
    const [file] = parseUnifiedDiff(fixture('binary'));
    expect(file!.status).toBe('binary');
    expect(file!.hunks).toHaveLength(0);
  });

  test('attaches no-newline markers to the preceding line', () => {
    const [file] = parseUnifiedDiff(fixture('no-newline'));
    const lines = file!.hunks[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]!.kind).toBe('del');
    expect(lines[0]!.noNewlineAtEof).toBe(true);
    expect(lines[1]!.kind).toBe('add');
    expect(lines[1]!.noNewlineAtEof).toBe(true);
  });

  test('parses multiple hunks with independent numbering', () => {
    const [file] = parseUnifiedDiff(fixture('multi-hunk'));
    expect(file!.hunks).toHaveLength(2);
    expect(file!.hunks[1]!.oldStart).toBe(20);
    expect(file!.hunks[1]!.newStart).toBe(21);
    expect(file!.hunks[1]!.section).toBe('function second()');
  });

  test('handles a hunk header with omitted counts', () => {
    const [file] = parseUnifiedDiff(fixture('no-newline'));
    const hunk = file!.hunks[0]!;
    expect(hunk.oldLines).toBe(1);
    expect(hunk.newLines).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test tests/core/diff/parse.test.ts`
Expected: FAIL — cannot resolve `parse.js`.

- [ ] **Step 4: Write the types**

`src/core/diff/types.ts`:

```ts
export type LineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: LineKind;
  /** Line content with the leading +/-/space removed. */
  text: string;
  /** Line number in the pre-image, or null for additions. */
  oldLine: number | null;
  /** Line number in the post-image, or null for deletions. */
  newLine: number | null;
  noNewlineAtEof: boolean;
}

export interface Hunk {
  /** The raw @@ line, verbatim. */
  header: string;
  /** Trailing context after the second @@, often a function signature. '' if absent. */
  section: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'binary';

export interface DiffFile {
  /** Post-image path, or the pre-image path when the file was deleted. */
  path: string;
  /** Pre-image path, set only for renames. */
  oldPath: string | null;
  status: FileStatus;
  /** Rename similarity percentage, when git reported one. */
  similarity: number | null;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}
```

- [ ] **Step 5: Write the parser**

`src/core/diff/parse.ts`:

```ts
import type { DiffFile, DiffLine, FileStatus, Hunk } from './types.js';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

interface Draft {
  path: string | null;
  oldPath: string | null;
  status: FileStatus;
  similarity: number | null;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

function newDraft(): Draft {
  return {
    path: null,
    oldPath: null,
    status: 'modified',
    similarity: null,
    hunks: [],
    additions: 0,
    deletions: 0,
  };
}

function finish(draft: Draft, out: DiffFile[]): void {
  if (draft.path === null) return;
  out.push({
    path: draft.path,
    oldPath: draft.oldPath,
    status: draft.status,
    similarity: draft.similarity,
    hunks: draft.hunks,
    additions: draft.additions,
    deletions: draft.deletions,
  });
}

/** Strips git's a/ or b/ prefix. Leaves /dev/null alone. */
function stripPrefix(p: string): string {
  if (p === '/dev/null') return p;
  return p.replace(/^[ab]\//, '');
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const out: DiffFile[] = [];
  let draft = newDraft();
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      finish(draft, out);
      draft = newDraft();
      hunk = null;
      // Fall back to the paths on the diff --git line; ---/+++ overrides below.
      const parts = raw.slice('diff --git '.length).split(' ');
      if (parts.length === 2) {
        draft.oldPath = stripPrefix(parts[0]!);
        draft.path = stripPrefix(parts[1]!);
      }
      continue;
    }

    if (raw.startsWith('new file mode')) {
      draft.status = 'added';
      continue;
    }
    if (raw.startsWith('deleted file mode')) {
      draft.status = 'deleted';
      continue;
    }
    if (raw.startsWith('similarity index ')) {
      const pct = Number.parseInt(raw.slice('similarity index '.length), 10);
      draft.similarity = Number.isNaN(pct) ? null : pct;
      continue;
    }
    if (raw.startsWith('rename from ')) {
      draft.status = 'renamed';
      draft.oldPath = raw.slice('rename from '.length);
      continue;
    }
    if (raw.startsWith('rename to ')) {
      draft.status = 'renamed';
      draft.path = raw.slice('rename to '.length);
      continue;
    }
    if (raw.startsWith('Binary files ')) {
      draft.status = 'binary';
      continue;
    }
    if (raw.startsWith('index ') || raw.startsWith('old mode') || raw.startsWith('new mode')) {
      continue;
    }

    if (raw.startsWith('--- ')) {
      const p = stripPrefix(raw.slice(4));
      if (p !== '/dev/null') draft.oldPath = p;
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = stripPrefix(raw.slice(4));
      if (p !== '/dev/null') draft.path = p;
      else if (draft.oldPath !== null) draft.path = draft.oldPath;
      continue;
    }

    const m = HUNK_RE.exec(raw);
    if (m) {
      oldNo = Number.parseInt(m[1]!, 10);
      newNo = Number.parseInt(m[3]!, 10);
      hunk = {
        header: raw,
        section: m[5] ?? '',
        oldStart: oldNo,
        // An omitted count means exactly 1 line.
        oldLines: m[2] === undefined ? 1 : Number.parseInt(m[2], 10),
        newStart: newNo,
        newLines: m[4] === undefined ? 1 : Number.parseInt(m[4], 10),
        lines: [],
      };
      draft.hunks.push(hunk);
      continue;
    }

    if (hunk === null) continue;

    if (raw.startsWith('\\')) {
      // "\ No newline at end of file" annotates the line above it.
      const last = hunk.lines[hunk.lines.length - 1];
      if (last) last.noNewlineAtEof = true;
      continue;
    }

    const marker = raw[0];
    const text = raw.slice(1);
    let line: DiffLine | null = null;

    if (marker === '+') {
      line = { kind: 'add', text, oldLine: null, newLine: newNo++, noNewlineAtEof: false };
      draft.additions += 1;
    } else if (marker === '-') {
      line = { kind: 'del', text, oldLine: oldNo++, newLine: null, noNewlineAtEof: false };
      draft.deletions += 1;
    } else if (marker === ' ') {
      line = { kind: 'context', text, oldLine: oldNo++, newLine: newNo++, noNewlineAtEof: false };
    }
    // Any other leading character is not part of a hunk body; ignore it.

    if (line) hunk.lines.push(line);
  }

  finish(draft, out);
  return out;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/core/diff/parse.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add src/core/diff tests/core/diff tests/fixtures/diffs
git commit -m "feat: add unified diff parser with line-number anchoring"
```

---

### Task 3: GitHub auth and read client

**Files:**
- Create: `src/core/github/types.ts`, `src/core/github/auth.ts`, `src/core/github/client.ts`
- Create: `tests/fixtures/github/pr-detail.json`, `tests/fixtures/github/pr-list.json`
- Test: `tests/core/github/auth.test.ts`, `tests/core/github/client.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface PullRequestSummary { number: number; title: string; author: string; state: 'open' | 'closed' | 'merged'; isDraft: boolean; headSha: string; baseRef: string; headRef: string; updatedAt: string; additions: number; deletions: number; changedFiles: number }`
  - `interface PullRequestDetail extends PullRequestSummary { body: string; diff: string; viewerIsAuthor: boolean }`
  - `function resolveGitHubToken(run?: CommandRunner, env?: NodeJS.ProcessEnv): Promise<string>`
  - `type CommandRunner = (cmd: string, args: string[]) => Promise<{ stdout: string; code: number }>`
  - `class GitHubClient { constructor(token: string, octokit?: OctokitLike); listPulls(owner, repo, filter): Promise<PullRequestSummary[]>; getPull(owner, repo, number): Promise<PullRequestDetail> }`
  - `type PullFilter = 'open' | 'review-requested' | 'all'`

- [ ] **Step 1: Write the failing auth tests**

`tests/core/github/auth.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { resolveGitHubToken } from '../../../src/core/github/auth.js';

test('prefers gh auth token', async () => {
  const run = async () => ({ stdout: 'gho_fromGh\n', code: 0 });
  const token = await resolveGitHubToken(run, { GITHUB_TOKEN: 'ghp_fromEnv' });
  expect(token).toBe('gho_fromGh');
});

test('falls back to GITHUB_TOKEN when gh fails', async () => {
  const run = async () => ({ stdout: '', code: 1 });
  const token = await resolveGitHubToken(run, { GITHUB_TOKEN: 'ghp_fromEnv' });
  expect(token).toBe('ghp_fromEnv');
});

test('throws an actionable error when neither is available', async () => {
  const run = async () => ({ stdout: '', code: 1 });
  await expect(resolveGitHubToken(run, {})).rejects.toThrow(/gh auth login/);
});
```

- [ ] **Step 2: Run the auth tests to verify they fail**

Run: `bun test tests/core/github/auth.test.ts`
Expected: FAIL — cannot resolve `auth.js`.

- [ ] **Step 3: Implement auth**

`src/core/github/auth.ts`:

```ts
import { execFile } from 'node:child_process';

export type CommandRunner = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; code: number }>;

export const defaultRunner: CommandRunner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, (error, stdout) => {
      resolve({ stdout, code: error ? 1 : 0 });
    });
  });

export async function resolveGitHubToken(
  run: CommandRunner = defaultRunner,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const gh = await run('gh', ['auth', 'token']);
  const fromGh = gh.stdout.trim();
  if (gh.code === 0 && fromGh.length > 0) return fromGh;

  const fromEnv = env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  throw new Error(
    'No GitHub credentials found. Run `gh auth login`, or set GITHUB_TOKEN.',
  );
}
```

- [ ] **Step 4: Run the auth tests to verify they pass**

Run: `bun test tests/core/github/auth.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Record the fixtures**

Create `tests/fixtures/github/pr-detail.json` with the minimum shape the client reads:

```json
{
  "number": 42,
  "title": "Fix thematic-break rendering",
  "body": "Preserves CommonMark thematic breaks.",
  "state": "open",
  "draft": false,
  "merged": false,
  "additions": 106,
  "deletions": 0,
  "changed_files": 3,
  "updated_at": "2026-08-01T12:00:00Z",
  "user": { "login": "hazadus" },
  "head": { "sha": "abc1234def5678", "ref": "fix/thematic-break" },
  "base": { "ref": "main" }
}
```

Create `tests/fixtures/github/pr-list.json`:

```json
[
  {
    "number": 42,
    "title": "Fix thematic-break rendering",
    "state": "open",
    "draft": false,
    "updated_at": "2026-08-01T12:00:00Z",
    "user": { "login": "hazadus" },
    "head": { "sha": "abc1234def5678", "ref": "fix/thematic-break" },
    "base": { "ref": "main" }
  }
]
```

- [ ] **Step 6: Write the failing client tests**

`tests/core/github/client.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GitHubClient } from '../../../src/core/github/client.js';

const detail = JSON.parse(
  readFileSync(new URL('../../fixtures/github/pr-detail.json', import.meta.url), 'utf8'),
);
const list = JSON.parse(
  readFileSync(new URL('../../fixtures/github/pr-list.json', import.meta.url), 'utf8'),
);

function fakeOctokit(diff = 'diff --git a/x b/x\n') {
  return {
    rest: {
      pulls: {
        get: async ({ mediaType }: { mediaType?: { format?: string } }) =>
          mediaType?.format === 'diff' ? { data: diff } : { data: detail },
        list: async () => ({ data: list }),
      },
    },
    paginate: async () => list,
  };
}

test('maps a PR detail response to the domain type', async () => {
  const client = new GitHubClient('tok', fakeOctokit());
  const pr = await client.getPull('srtfisher', 'marrow', 42, 'srtfisher');

  expect(pr.number).toBe(42);
  expect(pr.author).toBe('hazadus');
  expect(pr.state).toBe('open');
  expect(pr.headSha).toBe('abc1234def5678');
  expect(pr.baseRef).toBe('main');
  expect(pr.changedFiles).toBe(3);
  expect(pr.diff).toContain('diff --git');
  expect(pr.viewerIsAuthor).toBe(false);
});

test('flags the viewer as author when logins match', async () => {
  const client = new GitHubClient('tok', fakeOctokit());
  const pr = await client.getPull('srtfisher', 'marrow', 42, 'hazadus');
  expect(pr.viewerIsAuthor).toBe(true);
});

test('reports merged state distinctly from closed', async () => {
  const merged = { ...detail, state: 'closed', merged: true };
  const octokit = {
    rest: {
      pulls: {
        get: async ({ mediaType }: { mediaType?: { format?: string } }) =>
          mediaType?.format === 'diff' ? { data: '' } : { data: merged },
        list: async () => ({ data: [] }),
      },
    },
    paginate: async () => [],
  };
  const client = new GitHubClient('tok', octokit);
  const pr = await client.getPull('srtfisher', 'marrow', 42, 'srtfisher');
  expect(pr.state).toBe('merged');
});

test('maps a PR list response', async () => {
  const client = new GitHubClient('tok', fakeOctokit());
  const prs = await client.listPulls('srtfisher', 'marrow', 'open');
  expect(prs).toHaveLength(1);
  expect(prs[0]!.title).toBe('Fix thematic-break rendering');
  expect(prs[0]!.headRef).toBe('fix/thematic-break');
});
```

- [ ] **Step 7: Run the client tests to verify they fail**

Run: `bun test tests/core/github/client.test.ts`
Expected: FAIL — cannot resolve `client.js`.

- [ ] **Step 8: Write the domain types**

`src/core/github/types.ts`:

```ts
export type PullState = 'open' | 'closed' | 'merged';
export type PullFilter = 'open' | 'review-requested' | 'all';

export interface PullRequestSummary {
  number: number;
  title: string;
  author: string;
  state: PullState;
  isDraft: boolean;
  headSha: string;
  baseRef: string;
  headRef: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface PullRequestDetail extends PullRequestSummary {
  body: string;
  /** Raw unified diff, as served by GitHub. */
  diff: string;
  viewerIsAuthor: boolean;
}

export interface ReviewThreadComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewThread {
  path: string;
  line: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  comments: ReviewThreadComment[];
}

export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'skipped'
  | null;

export interface CheckRun {
  name: string;
  status: string;
  conclusion: CheckConclusion;
  detailsUrl: string | null;
  /** Summary text, when the check provided one. */
  output: string | null;
}
```

- [ ] **Step 9: Write the read client**

`src/core/github/client.ts`:

```ts
import { Octokit } from '@octokit/rest';
import type {
  PullFilter,
  PullRequestDetail,
  PullRequestSummary,
  PullState,
} from './types.js';

/** The slice of Octokit this client uses, so tests can supply a fake. */
export interface OctokitLike {
  rest: {
    pulls: {
      get(params: Record<string, unknown>): Promise<{ data: unknown }>;
      list(params: Record<string, unknown>): Promise<{ data: unknown }>;
    };
  };
  paginate(fn: unknown, params?: Record<string, unknown>): Promise<unknown[]>;
}

interface RawPull {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  draft?: boolean;
  merged?: boolean;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  updated_at: string;
  user: { login: string } | null;
  head: { sha: string; ref: string };
  base: { ref: string };
}

function toState(raw: RawPull): PullState {
  if (raw.merged === true) return 'merged';
  return raw.state === 'closed' ? 'closed' : 'open';
}

function toSummary(raw: RawPull): PullRequestSummary {
  return {
    number: raw.number,
    title: raw.title,
    author: raw.user?.login ?? 'unknown',
    state: toState(raw),
    isDraft: raw.draft === true,
    headSha: raw.head.sha,
    baseRef: raw.base.ref,
    headRef: raw.head.ref,
    updatedAt: raw.updated_at,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changed_files ?? 0,
  };
}

export class GitHubClient {
  private readonly octokit: OctokitLike;

  constructor(token: string, octokit?: OctokitLike) {
    this.octokit = octokit ?? (new Octokit({ auth: token }) as unknown as OctokitLike);
  }

  async listPulls(
    owner: string,
    repo: string,
    filter: PullFilter,
  ): Promise<PullRequestSummary[]> {
    const state = filter === 'all' ? 'all' : 'open';
    const { data } = await this.octokit.rest.pulls.list({
      owner,
      repo,
      state,
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    });
    return (data as RawPull[]).map(toSummary);
  }

  async getPull(
    owner: string,
    repo: string,
    pull_number: number,
    viewerLogin: string,
  ): Promise<PullRequestDetail> {
    const [detailRes, diffRes] = await Promise.all([
      this.octokit.rest.pulls.get({ owner, repo, pull_number }),
      this.octokit.rest.pulls.get({
        owner,
        repo,
        pull_number,
        mediaType: { format: 'diff' },
      }),
    ]);

    const raw = detailRes.data as RawPull;
    return {
      ...toSummary(raw),
      body: raw.body ?? '',
      diff: String(diffRes.data),
      viewerIsAuthor: (raw.user?.login ?? '') === viewerLogin,
    };
  }
}
```

- [ ] **Step 10: Run the client tests to verify they pass**

Run: `bun test tests/core/github/`
Expected: PASS, 7 tests total.

- [ ] **Step 11: Commit**

```bash
git add src/core/github tests/core/github tests/fixtures/github
git commit -m "feat: add GitHub auth resolution and PR read client"
```

---

### Task 4: Review threads and checks via GraphQL

Kept separate from Task 3 because it's a different transport with a different failure mode, and a reviewer could reasonably accept the REST client while rejecting this query.

**Files:**
- Create: `src/core/github/graphql.ts`
- Create: `tests/fixtures/github/threads-checks.json`
- Test: `tests/core/github/graphql.test.ts`

**Interfaces:**
- Consumes: `ReviewThread`, `CheckRun` from `src/core/github/types.ts` (Task 3).
- Produces:
  - `interface PullContext { threads: ReviewThread[]; checks: CheckRun[]; viewerPendingReviewId: string | null }`
  - `function fetchPullContext(graphql: GraphQlFn, owner: string, repo: string, number: number): Promise<PullContext>`
  - `type GraphQlFn = (query: string, vars: Record<string, unknown>) => Promise<unknown>`

- [ ] **Step 1: Record the fixture**

`tests/fixtures/github/threads-checks.json`:

```json
{
  "repository": {
    "pullRequest": {
      "reviewThreads": {
        "nodes": [
          {
            "path": "mdv/SmartTypography.swift",
            "line": 57,
            "isResolved": false,
            "isOutdated": false,
            "comments": {
              "nodes": [
                {
                  "author": { "login": "tqbf" },
                  "body": "Does this handle setext headings?",
                  "createdAt": "2026-08-01T13:00:00Z"
                }
              ]
            }
          }
        ]
      },
      "reviews": {
        "nodes": [{ "id": "PRR_pending1", "state": "PENDING" }]
      },
      "commits": {
        "nodes": [
          {
            "commit": {
              "statusCheckRollup": {
                "contexts": {
                  "nodes": [
                    {
                      "__typename": "CheckRun",
                      "name": "unit-tests",
                      "status": "COMPLETED",
                      "conclusion": "FAILURE",
                      "detailsUrl": "https://github.com/x/y/runs/1",
                      "summary": "3 tests failed"
                    },
                    {
                      "__typename": "StatusContext",
                      "context": "ci/legacy",
                      "state": "SUCCESS",
                      "targetUrl": "https://ci.example.com/1"
                    }
                  ]
                }
              }
            }
          }
        ]
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`tests/core/github/graphql.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fetchPullContext } from '../../../src/core/github/graphql.js';

const payload = JSON.parse(
  readFileSync(new URL('../../fixtures/github/threads-checks.json', import.meta.url), 'utf8'),
);

test('maps review threads', async () => {
  const ctx = await fetchPullContext(async () => payload, 'o', 'r', 42);
  expect(ctx.threads).toHaveLength(1);
  expect(ctx.threads[0]!.path).toBe('mdv/SmartTypography.swift');
  expect(ctx.threads[0]!.line).toBe(57);
  expect(ctx.threads[0]!.comments[0]!.author).toBe('tqbf');
});

test('maps both CheckRun and StatusContext into CheckRun', async () => {
  const ctx = await fetchPullContext(async () => payload, 'o', 'r', 42);
  expect(ctx.checks).toHaveLength(2);

  const run = ctx.checks.find((c) => c.name === 'unit-tests')!;
  expect(run.conclusion).toBe('failure');
  expect(run.output).toBe('3 tests failed');

  const legacy = ctx.checks.find((c) => c.name === 'ci/legacy')!;
  expect(legacy.conclusion).toBe('success');
  expect(legacy.detailsUrl).toBe('https://ci.example.com/1');
});

test('surfaces a pending review id so the UI can warn', async () => {
  const ctx = await fetchPullContext(async () => payload, 'o', 'r', 42);
  expect(ctx.viewerPendingReviewId).toBe('PRR_pending1');
});

test('returns empty context when the PR has no threads or checks', async () => {
  const empty = {
    repository: {
      pullRequest: {
        reviewThreads: { nodes: [] },
        reviews: { nodes: [] },
        commits: { nodes: [] },
      },
    },
  };
  const ctx = await fetchPullContext(async () => empty, 'o', 'r', 42);
  expect(ctx.threads).toEqual([]);
  expect(ctx.checks).toEqual([]);
  expect(ctx.viewerPendingReviewId).toBeNull();
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test tests/core/github/graphql.test.ts`
Expected: FAIL — cannot resolve `graphql.js`.

- [ ] **Step 4: Write the implementation**

`src/core/github/graphql.ts`:

```ts
import type { CheckConclusion, CheckRun, ReviewThread } from './types.js';

export type GraphQlFn = (
  query: string,
  vars: Record<string, unknown>,
) => Promise<unknown>;

export interface PullContext {
  threads: ReviewThread[];
  checks: CheckRun[];
  /** Non-null when the viewer already has an unsubmitted review from the web UI. */
  viewerPendingReviewId: string | null;
}

export const PULL_CONTEXT_QUERY = `
query PullContext($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          path
          line
          isResolved
          isOutdated
          comments(first: 50) {
            nodes { author { login } body createdAt }
          }
        }
      }
      reviews(first: 20, states: [PENDING]) { nodes { id state } }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    name status conclusion detailsUrl
                    summary: title
                  }
                  ... on StatusContext {
                    context state targetUrl
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

function lower(value: unknown): string | null {
  return typeof value === 'string' ? value.toLowerCase() : null;
}

function toCheck(node: Record<string, unknown>): CheckRun | null {
  if (node['__typename'] === 'CheckRun') {
    return {
      name: String(node['name'] ?? 'check'),
      status: lower(node['status']) ?? 'unknown',
      conclusion: lower(node['conclusion']) as CheckConclusion,
      detailsUrl: (node['detailsUrl'] as string | null) ?? null,
      output: (node['summary'] as string | null) ?? null,
    };
  }
  if (node['__typename'] === 'StatusContext') {
    return {
      name: String(node['context'] ?? 'status'),
      status: 'completed',
      conclusion: lower(node['state']) as CheckConclusion,
      detailsUrl: (node['targetUrl'] as string | null) ?? null,
      output: null,
    };
  }
  return null;
}

export async function fetchPullContext(
  graphql: GraphQlFn,
  owner: string,
  repo: string,
  number: number,
): Promise<PullContext> {
  const raw = (await graphql(PULL_CONTEXT_QUERY, { owner, repo, number })) as {
    repository?: {
      pullRequest?: {
        reviewThreads?: { nodes?: unknown[] };
        reviews?: { nodes?: { id: string }[] };
        commits?: { nodes?: { commit?: { statusCheckRollup?: { contexts?: { nodes?: unknown[] } } } }[] };
      };
    };
  };

  const pr = raw.repository?.pullRequest;

  const threads: ReviewThread[] = (pr?.reviewThreads?.nodes ?? []).map((n) => {
    const node = n as Record<string, unknown>;
    const comments = (node['comments'] as { nodes?: unknown[] } | undefined)?.nodes ?? [];
    return {
      path: String(node['path'] ?? ''),
      line: typeof node['line'] === 'number' ? node['line'] : null,
      isResolved: node['isResolved'] === true,
      isOutdated: node['isOutdated'] === true,
      comments: comments.map((c) => {
        const comment = c as Record<string, unknown>;
        const author = comment['author'] as { login?: string } | null;
        return {
          author: author?.login ?? 'unknown',
          body: String(comment['body'] ?? ''),
          createdAt: String(comment['createdAt'] ?? ''),
        };
      }),
    };
  });

  const contexts =
    pr?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const checks = contexts
    .map((c) => toCheck(c as Record<string, unknown>))
    .filter((c): c is CheckRun => c !== null);

  return {
    threads,
    checks,
    viewerPendingReviewId: pr?.reviews?.nodes?.[0]?.id ?? null,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/core/github/graphql.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/github/graphql.ts tests/core/github/graphql.test.ts tests/fixtures/github/threads-checks.json
git commit -m "feat: fetch review threads, checks, and pending review via GraphQL"
```

---

### Task 5: Repo detection and worktree management

**Files:**
- Create: `src/core/git/repo.ts`, `src/core/git/worktree.ts`, `src/core/git/gitattributes.ts`
- Test: `tests/core/git/repo.test.ts`, `tests/core/git/gitattributes.test.ts`

**Interfaces:**
- Consumes: `CommandRunner` from `src/core/github/auth.ts` (Task 3).
- Produces:
  - `interface RepoContext { root: string; owner: string; repo: string }`
  - `function parseRemoteUrl(url: string): { owner: string; repo: string } | null`
  - `function detectRepo(cwd: string, run?: CommandRunner): Promise<RepoContext | null>`
  - `interface Worktree { path: string; sha: string }`
  - `function ensureWorktree(repo: RepoContext, prNumber: number, sha: string, run?: CommandRunner): Promise<Worktree>`
  - `function pruneWorktrees(maxAgeDays: number, now?: Date): Promise<number>`
  - `function parseGeneratedPaths(gitattributes: string): Set<string>`

- [ ] **Step 1: Write the failing remote-URL and gitattributes tests**

`tests/core/git/repo.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { parseRemoteUrl, detectRepo } from '../../../src/core/git/repo.js';

test('parses an ssh remote', () => {
  expect(parseRemoteUrl('git@github.com:srtfisher/marrow.git')).toEqual({
    owner: 'srtfisher',
    repo: 'marrow',
  });
});

test('parses an https remote with and without .git', () => {
  expect(parseRemoteUrl('https://github.com/srtfisher/marrow.git')).toEqual({
    owner: 'srtfisher',
    repo: 'marrow',
  });
  expect(parseRemoteUrl('https://github.com/srtfisher/marrow')).toEqual({
    owner: 'srtfisher',
    repo: 'marrow',
  });
});

test('returns null for a non-GitHub remote', () => {
  expect(parseRemoteUrl('https://gitlab.com/a/b.git')).toBeNull();
});

test('detectRepo returns null outside a git repo', async () => {
  const run = async () => ({ stdout: '', code: 1 });
  expect(await detectRepo('/tmp', run)).toBeNull();
});

test('detectRepo combines root and remote', async () => {
  const run = async (_cmd: string, args: string[]) => {
    if (args.includes('--show-toplevel')) return { stdout: '/repo\n', code: 0 };
    return { stdout: 'git@github.com:srtfisher/marrow.git\n', code: 0 };
  };
  expect(await detectRepo('/repo/src', run)).toEqual({
    root: '/repo',
    owner: 'srtfisher',
    repo: 'marrow',
  });
});
```

`tests/core/git/gitattributes.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { parseGeneratedPaths } from '../../../src/core/git/gitattributes.js';

test('collects linguist-generated patterns', () => {
  const attrs = [
    '*.pb.go linguist-generated=true',
    'schema.json linguist-generated',
    'src/**/*.snap linguist-generated=true',
    '*.md text',
    '# a comment linguist-generated',
    '',
  ].join('\n');

  const generated = parseGeneratedPaths(attrs);
  expect(generated.has('*.pb.go')).toBe(true);
  expect(generated.has('schema.json')).toBe(true);
  expect(generated.has('src/**/*.snap')).toBe(true);
  expect(generated.has('*.md')).toBe(false);
  expect(generated.size).toBe(3);
});

test('ignores linguist-generated=false', () => {
  expect(parseGeneratedPaths('dist/x.js linguist-generated=false').size).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/core/git/`
Expected: FAIL — cannot resolve `repo.js` or `gitattributes.js`.

- [ ] **Step 3: Implement repo detection**

`src/core/git/repo.ts`:

```ts
import { defaultRunner, type CommandRunner } from '../github/auth.js';

export interface RepoContext {
  root: string;
  owner: string;
  repo: string;
}

const SSH_RE = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/;
const HTTPS_RE = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/;

export function parseRemoteUrl(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  for (const re of [SSH_RE, HTTPS_RE]) {
    const m = re.exec(trimmed);
    if (m) return { owner: m[1]!, repo: m[2]! };
  }
  return null;
}

export async function detectRepo(
  cwd: string,
  run: CommandRunner = defaultRunner,
): Promise<RepoContext | null> {
  const top = await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel']);
  if (top.code !== 0) return null;

  const remote = await run('git', ['-C', cwd, 'remote', 'get-url', 'origin']);
  if (remote.code !== 0) return null;

  const parsed = parseRemoteUrl(remote.stdout);
  if (!parsed) return null;

  return { root: top.stdout.trim(), ...parsed };
}
```

- [ ] **Step 4: Implement gitattributes parsing**

`src/core/git/gitattributes.ts`:

```ts
/**
 * Extracts path patterns the repository declares as generated. This is the
 * maintainers' own statement about what is noise, so it outranks any built-in
 * pattern list in the meat rule engine.
 */
export function parseGeneratedPaths(gitattributes: string): Set<string> {
  const out = new Set<string>();

  for (const raw of gitattributes.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const pattern = parts[0];
    if (!pattern) continue;

    for (const attr of parts.slice(1)) {
      if (attr === 'linguist-generated' || attr === 'linguist-generated=true') {
        out.add(pattern);
        break;
      }
    }
  }

  return out;
}
```

- [ ] **Step 5: Implement worktree management**

`src/core/git/worktree.ts`:

```ts
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultRunner, type CommandRunner } from '../github/auth.js';
import type { RepoContext } from './repo.js';

export interface Worktree {
  path: string;
  sha: string;
}

export function worktreeRoot(): string {
  return join(homedir(), '.cache', 'marrow', 'worktrees');
}

function worktreePath(repo: RepoContext, sha: string): string {
  return join(worktreeRoot(), `${repo.owner}-${repo.repo}-${sha.slice(0, 12)}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches the PR head into the local clone and checks it out in a detached
 * worktree. Reuses an existing worktree for the same SHA. Throws on failure —
 * callers degrade to diff-only mode rather than treating this as fatal.
 */
export async function ensureWorktree(
  repo: RepoContext,
  prNumber: number,
  sha: string,
  run: CommandRunner = defaultRunner,
): Promise<Worktree> {
  const path = worktreePath(repo, sha);
  if (await exists(path)) return { path, sha };

  const fetch = await run('git', [
    '-C',
    repo.root,
    'fetch',
    'origin',
    `refs/pull/${prNumber}/head`,
  ]);
  if (fetch.code !== 0) {
    throw new Error(`git fetch failed for PR #${prNumber}`);
  }

  await mkdir(worktreeRoot(), { recursive: true });

  const add = await run('git', [
    '-C',
    repo.root,
    'worktree',
    'add',
    '--detach',
    path,
    sha,
  ]);
  if (add.code !== 0) {
    throw new Error(`git worktree add failed for ${sha}`);
  }

  return { path, sha };
}

/** Removes worktree directories untouched for longer than maxAgeDays. */
export async function pruneWorktrees(
  maxAgeDays: number,
  now: Date = new Date(),
): Promise<number> {
  const root = worktreeRoot();
  if (!(await exists(root))) return 0;

  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const entry of await readdir(root)) {
    const path = join(root, entry);
    const info = await stat(path);
    if (info.mtimeMs < cutoff) {
      await rm(path, { recursive: true, force: true });
      removed += 1;
    }
  }

  return removed;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/core/git/ && bun run typecheck`
Expected: PASS, 7 tests; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/git tests/core/git
git commit -m "feat: add repo detection, worktree management, and gitattributes parsing"
```

---

### Task 6: Deterministic meat rule engine

**Files:**
- Create: `src/core/meat/rules.ts`
- Test: `tests/core/meat/rules.test.ts`

**Interfaces:**
- Consumes: `DiffFile`, `Hunk`, `DiffLine` from `src/core/diff/types.ts` (Task 2).
- Produces:
  - `interface RuleContext { generatedPaths: Set<string> }`
  - `interface RuleVerdict { drop: true; rule: string }`
  - `function evaluateFile(file: DiffFile, ctx: RuleContext): RuleVerdict | null`
  - `function evaluateHunk(hunk: Hunk): RuleVerdict | null`
  - `function matchesGlob(pattern: string, path: string): boolean`
  - `const FILE_RULE_NAMES: readonly string[]`, `const HUNK_RULE_NAMES: readonly string[]`

- [ ] **Step 1: Write the failing tests**

`tests/core/meat/rules.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import { evaluateFile, evaluateHunk, matchesGlob } from '../../../src/core/meat/rules.js';
import type { DiffFile, DiffLine, Hunk } from '../../../src/core/diff/types.js';

function file(path: string, over: Partial<DiffFile> = {}): DiffFile {
  return {
    path,
    oldPath: null,
    status: 'modified',
    similarity: null,
    hunks: [],
    additions: 1,
    deletions: 1,
    ...over,
  };
}

function line(kind: DiffLine['kind'], text: string): DiffLine {
  return { kind, text, oldLine: 1, newLine: 1, noNewlineAtEof: false };
}

function hunk(lines: DiffLine[]): Hunk {
  return {
    header: '@@ -1,1 +1,1 @@',
    section: '',
    oldStart: 1,
    oldLines: lines.length,
    newStart: 1,
    newLines: lines.length,
    lines,
  };
}

const noCtx = { generatedPaths: new Set<string>() };

describe('matchesGlob', () => {
  test('matches * within a segment only', () => {
    expect(matchesGlob('*.min.js', 'app.min.js')).toBe(true);
    expect(matchesGlob('*.min.js', 'src/app.min.js')).toBe(false);
  });

  test('matches ** across segments', () => {
    expect(matchesGlob('src/**/*.snap', 'src/a/b/x.snap')).toBe(true);
    expect(matchesGlob('**/*.pb.go', 'api/v1/service.pb.go')).toBe(true);
  });

  test('matches an exact path', () => {
    expect(matchesGlob('schema.json', 'schema.json')).toBe(true);
    expect(matchesGlob('schema.json', 'sub/schema.json')).toBe(false);
  });
});

describe('evaluateFile', () => {
  test('drops lockfiles', () => {
    expect(evaluateFile(file('pnpm-lock.yaml'), noCtx)?.rule).toBe('lockfile');
    expect(evaluateFile(file('sub/composer.lock'), noCtx)?.rule).toBe('lockfile');
    expect(evaluateFile(file('go.sum'), noCtx)?.rule).toBe('lockfile');
  });

  test('drops vendored and build output directories', () => {
    expect(evaluateFile(file('dist/bundle.js'), noCtx)?.rule).toBe('build-output');
    expect(evaluateFile(file('vendor/pkg/x.go'), noCtx)?.rule).toBe('build-output');
  });

  test('drops snapshots and minified files', () => {
    expect(evaluateFile(file('src/__snapshots__/a.test.ts.snap'), noCtx)?.rule).toBe('snapshot');
    expect(evaluateFile(file('public/app.min.js'), noCtx)?.rule).toBe('minified');
  });

  test('drops binary files', () => {
    expect(evaluateFile(file('logo.png', { status: 'binary' }), noCtx)?.rule).toBe('binary');
  });

  test('drops 100%-similarity renames', () => {
    const renamed = file('b.ts', { status: 'renamed', similarity: 100, oldPath: 'a.ts' });
    expect(evaluateFile(renamed, noCtx)?.rule).toBe('pure-rename');
  });

  test('keeps a rename that also changed content', () => {
    const renamed = file('b.ts', { status: 'renamed', similarity: 87, oldPath: 'a.ts' });
    expect(evaluateFile(renamed, noCtx)).toBeNull();
  });

  test('gitattributes linguist-generated outranks everything', () => {
    const ctx = { generatedPaths: new Set(['api/**/*.ts']) };
    expect(evaluateFile(file('api/v1/client.ts'), ctx)?.rule).toBe('linguist-generated');
  });

  test('keeps ordinary source files', () => {
    expect(evaluateFile(file('src/app.ts'), noCtx)).toBeNull();
  });
});

describe('evaluateHunk', () => {
  test('drops whitespace-only changes', () => {
    const h = hunk([line('del', 'const a = 1;'), line('add', 'const a = 1;  ')]);
    expect(evaluateHunk(h)?.rule).toBe('whitespace-only');
  });

  test('drops import-only hunks', () => {
    const h = hunk([
      line('add', "import { z } from 'zod';"),
      line('del', "import { y } from 'yup';"),
    ]);
    expect(evaluateHunk(h)?.rule).toBe('imports-only');
  });

  test('drops use-statement-only hunks in PHP and Rust', () => {
    expect(evaluateHunk(hunk([line('add', 'use App\\Models\\Post;')]))?.rule).toBe('imports-only');
    expect(evaluateHunk(hunk([line('add', 'use std::fmt;')]))?.rule).toBe('imports-only');
  });

  test('keeps an import hunk that also changes code', () => {
    const h = hunk([line('add', "import { z } from 'zod';"), line('add', 'const x = z.string();')]);
    expect(evaluateHunk(h)).toBeNull();
  });

  test('drops license header changes', () => {
    const h = hunk([
      line('del', ' * Copyright (c) 2025 Alley'),
      line('add', ' * Copyright (c) 2026 Alley'),
    ]);
    expect(evaluateHunk(h)?.rule).toBe('license-header');
  });

  test('keeps a hunk with no changed lines out of scope', () => {
    expect(evaluateHunk(hunk([line('context', 'unchanged')]))).toBeNull();
  });

  test('keeps a substantive change', () => {
    const h = hunk([line('del', 'return a + b;'), line('add', 'return a - b;')]);
    expect(evaluateHunk(h)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/core/meat/rules.test.ts`
Expected: FAIL — cannot resolve `rules.js`.

- [ ] **Step 3: Write the implementation**

`src/core/meat/rules.ts`:

```ts
import type { DiffFile, DiffLine, Hunk } from '../diff/types.js';

export interface RuleContext {
  /** Glob patterns the repo declares as generated, from .gitattributes. */
  generatedPaths: Set<string>;
}

export interface RuleVerdict {
  drop: true;
  rule: string;
}

export const FILE_RULE_NAMES = [
  'linguist-generated',
  'lockfile',
  'build-output',
  'snapshot',
  'minified',
  'binary',
  'pure-rename',
] as const;

export const HUNK_RULE_NAMES = [
  'whitespace-only',
  'imports-only',
  'license-header',
] as const;

const LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'composer.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'go.sum',
  'poetry.lock',
  'uv.lock',
]);

const BUILD_DIRS = ['dist', 'build', 'vendor', 'node_modules', '.next', 'out'];

/**
 * Glob matcher supporting `*` (within a path segment) and `**` (across
 * segments). Deliberately small — we only ever match .gitattributes patterns
 * and our own rule patterns, not arbitrary user input.
 */
export function matchesGlob(pattern: string, path: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const source = escaped
    .replace(/\*\*\//g, ' SLASHSTAR ')
    .replace(/\*\*/g, ' DOUBLESTAR ')
    .replace(/\*/g, '[^/]*')
    .replace(/ SLASHSTAR /g, '(?:.*/)?')
    .replace(/ DOUBLESTAR /g, '.*');
  return new RegExp(`^${source}$`).test(path);
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function evaluateFile(file: DiffFile, ctx: RuleContext): RuleVerdict | null {
  for (const pattern of ctx.generatedPaths) {
    if (matchesGlob(pattern, file.path)) {
      return { drop: true, rule: 'linguist-generated' };
    }
  }

  if (file.status === 'binary') return { drop: true, rule: 'binary' };

  if (file.status === 'renamed' && file.similarity === 100 && file.hunks.length === 0) {
    return { drop: true, rule: 'pure-rename' };
  }

  if (LOCKFILES.has(basename(file.path))) return { drop: true, rule: 'lockfile' };

  const segments = file.path.split('/');
  if (segments.some((s) => BUILD_DIRS.includes(s))) {
    return { drop: true, rule: 'build-output' };
  }

  if (segments.includes('__snapshots__') || file.path.endsWith('.snap')) {
    return { drop: true, rule: 'snapshot' };
  }

  if (/\.min\.(js|css)$/.test(file.path)) return { drop: true, rule: 'minified' };

  return null;
}

const IMPORT_RE =
  /^\s*(?:import\b|export\s+(?:\*|\{)[^;]*\bfrom\b|from\s+\S+\s+import\b|use\s+[\w\\:{}, ]+;|require\s*\(|#include\b)/;

const LICENSE_RE = /copyright|licensed under|spdx-license-identifier|all rights reserved/i;

function changed(hunk: Hunk): DiffLine[] {
  return hunk.lines.filter((l) => l.kind !== 'context');
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function evaluateHunk(hunk: Hunk): RuleVerdict | null {
  const lines = changed(hunk);
  if (lines.length === 0) return null;

  const adds = lines.filter((l) => l.kind === 'add').map((l) => normalize(l.text));
  const dels = lines.filter((l) => l.kind === 'del').map((l) => normalize(l.text));

  // Whitespace-only: the multiset of normalized added and deleted lines matches.
  if (adds.length === dels.length && adds.length > 0) {
    const sortedAdds = [...adds].sort();
    const sortedDels = [...dels].sort();
    if (sortedAdds.every((a, i) => a === sortedDels[i])) {
      return { drop: true, rule: 'whitespace-only' };
    }
  }

  if (lines.every((l) => l.text.trim() === '' || IMPORT_RE.test(l.text))) {
    return { drop: true, rule: 'imports-only' };
  }

  if (lines.every((l) => l.text.trim() === '' || LICENSE_RE.test(l.text))) {
    return { drop: true, rule: 'license-header' };
  }

  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/core/meat/rules.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/meat/rules.ts tests/core/meat/rules.test.ts
git commit -m "feat: add deterministic meat rule engine"
```

---

### Task 7: Agent SDK wrapper with injectable transport

The only file in the codebase that imports the Agent SDK. Everything else talks to `AgentTransport`.

**Files:**
- Create: `src/core/agent/types.ts`, `src/core/agent/sdk.ts`, `src/core/agent/fake.ts`
- Test: `tests/core/agent/env.test.ts`, `tests/core/agent/fake.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface UsageSummary { inputTokens: number; outputTokens: number; numTurns: number }`
  - `interface AgentRequest { prompt: string; systemPrompt?: string; model: string; cwd?: string; allowedTools?: string[]; disallowedTools?: string[]; schema?: Record<string, unknown>; resume?: string; maxTurns?: number }`
  - `interface AgentRun { text: string; structured: unknown; sessionId: string; usage: UsageSummary; usageWarning: string | null }`
  - `interface AgentTransport { run(req: AgentRequest): Promise<AgentRun> }`
  - `function buildSubprocessEnv(source: NodeJS.ProcessEnv, useApiKey: boolean): Record<string, string | undefined>`
  - `class SdkTransport implements AgentTransport`
  - `class FakeTransport implements AgentTransport` with `queue(run: Partial<AgentRun>)` and `readonly requests: AgentRequest[]`

- [ ] **Step 1: Write the failing env test**

`tests/core/agent/env.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { buildSubprocessEnv } from '../../../src/core/agent/sdk.js';

const source = {
  PATH: '/usr/bin',
  HOME: '/Users/srtfisher',
  ANTHROPIC_API_KEY: 'sk-ant-leaked',
  ANTHROPIC_AUTH_TOKEN: 'tok-leaked',
};

test('strips Anthropic credentials so the subscription is used', () => {
  const env = buildSubprocessEnv(source, false);
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  expect(env.PATH).toBe('/usr/bin');
  expect(env.HOME).toBe('/Users/srtfisher');
});

test('preserves credentials when the user opts into API billing', () => {
  const env = buildSubprocessEnv(source, true);
  expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-leaked');
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok-leaked');
});

test('identifies marrow in the User-Agent', () => {
  const env = buildSubprocessEnv(source, false);
  expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toMatch(/^marrow\//);
});
```

- [ ] **Step 2: Run the env test to verify it fails**

Run: `bun test tests/core/agent/env.test.ts`
Expected: FAIL — cannot resolve `sdk.js`.

- [ ] **Step 3: Write the transport types**

`src/core/agent/types.ts`:

```ts
export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
}

export interface AgentRequest {
  prompt: string;
  systemPrompt?: string;
  /** Model alias, e.g. 'opus' or 'sonnet'. */
  model: string;
  /** Working directory the agent's file tools are scoped to. */
  cwd?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  /** JSON Schema. When set, the run must return structured output. */
  schema?: Record<string, unknown>;
  /** Session id to resume, for follow-up turns. */
  resume?: string;
  maxTurns?: number;
}

export interface AgentRun {
  text: string;
  /** Parsed structured output when a schema was supplied, else null. */
  structured: unknown;
  sessionId: string;
  usage: UsageSummary;
  /**
   * Set when the SDK reported a subscription usage warning or limit, so the UI
   * can surface it instead of failing opaquely.
   */
  usageWarning: string | null;
}

export interface AgentTransport {
  run(req: AgentRequest): Promise<AgentRun>;
}
```

- [ ] **Step 4: Write the SDK transport**

`src/core/agent/sdk.ts`:

```ts
import {
  query,
  USAGE_LIMIT_ERROR_PREFIXES,
  USAGE_WARNING_PREFIXES,
} from '@anthropic-ai/claude-agent-sdk';
import { MARROW_VERSION } from '../version.js';
import type { AgentRequest, AgentRun, AgentTransport } from './types.js';

/**
 * Builds the environment for the Claude Code subprocess.
 *
 * Claude Code resolves credentials ANTHROPIC_API_KEY -> ANTHROPIC_AUTH_TOKEN ->
 * OAuth profile. A stray key in the shell would silently move every review onto
 * metered API billing, so both are removed unless the user explicitly opts in.
 */
export function buildSubprocessEnv(
  source: NodeJS.ProcessEnv,
  useApiKey: boolean,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...source,
    CLAUDE_AGENT_SDK_CLIENT_APP: `marrow/${MARROW_VERSION}`,
  };

  if (!useApiKey) {
    env.ANTHROPIC_API_KEY = undefined;
    env.ANTHROPIC_AUTH_TOKEN = undefined;
  }

  return env;
}

function matchUsageNotice(text: string): string | null {
  for (const prefix of [...USAGE_LIMIT_ERROR_PREFIXES, ...USAGE_WARNING_PREFIXES]) {
    if (text.startsWith(prefix)) return text;
  }
  return null;
}

export interface SdkTransportOptions {
  useApiKey?: boolean;
  env?: NodeJS.ProcessEnv;
}

export class SdkTransport implements AgentTransport {
  private readonly env: Record<string, string | undefined>;

  constructor(options: SdkTransportOptions = {}) {
    this.env = buildSubprocessEnv(options.env ?? process.env, options.useApiKey === true);
  }

  async run(req: AgentRequest): Promise<AgentRun> {
    const stream = query({
      prompt: req.prompt,
      options: {
        model: req.model,
        cwd: req.cwd,
        systemPrompt: req.systemPrompt,
        allowedTools: req.allowedTools,
        disallowedTools: req.disallowedTools,
        maxTurns: req.maxTurns,
        resume: req.resume,
        env: this.env,
        ...(req.schema
          ? { outputFormat: { type: 'json_schema' as const, schema: req.schema } }
          : {}),
      },
    });

    let text = '';
    let structured: unknown = null;
    let sessionId = '';
    let usageWarning: string | null = null;
    let usage = { inputTokens: 0, outputTokens: 0, numTurns: 0 };

    for await (const message of stream) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            text += block.text;
            const notice = matchUsageNotice(block.text);
            if (notice) usageWarning = notice;
          }
        }
        continue;
      }

      if (message.type === 'result') {
        sessionId = message.session_id;
        if (message.subtype === 'success') {
          structured = message.structured_output ?? null;
          if (text.length === 0) text = message.result;
          usage = {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            numTurns: message.num_turns,
          };
        } else {
          throw new Error(`Agent run failed: ${message.subtype}`);
        }
      }
    }

    if (req.schema && structured === null) {
      throw new Error('Agent returned no structured output despite a schema being set.');
    }

    return { text, structured, sessionId, usage, usageWarning };
  }
}
```

- [ ] **Step 5: Run the env test to verify it passes**

Run: `bun test tests/core/agent/env.test.ts && bun run typecheck`
Expected: PASS, 3 tests; typecheck clean.

If typecheck reports a mismatch on `message.message.content` or `message.usage`, read the exact
shape from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (search for
`SDKAssistantMessage` and `NonNullableUsage`) and adjust. Do not widen to `any` — narrow
correctly, since this file is the single place SDK shapes are allowed to appear.

- [ ] **Step 6: Write the failing fake-transport test**

`tests/core/agent/fake.test.ts`:

```ts
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
```

- [ ] **Step 7: Run the fake test to verify it fails**

Run: `bun test tests/core/agent/fake.test.ts`
Expected: FAIL — cannot resolve `fake.js`.

- [ ] **Step 8: Write the fake transport**

`src/core/agent/fake.ts`:

```ts
import type { AgentRequest, AgentRun, AgentTransport } from './types.js';

const EMPTY_RUN: AgentRun = {
  text: '',
  structured: null,
  sessionId: 'fake-session',
  usage: { inputTokens: 0, outputTokens: 0, numTurns: 1 },
  usageWarning: null,
};

/** Deterministic transport for tests. Never touches the network. */
export class FakeTransport implements AgentTransport {
  readonly requests: AgentRequest[] = [];
  private readonly queued: AgentRun[] = [];

  queue(run: Partial<AgentRun>): void {
    this.queued.push({ ...EMPTY_RUN, ...run });
  }

  async run(req: AgentRequest): Promise<AgentRun> {
    this.requests.push(req);
    const next = this.queued.shift();
    if (!next) {
      throw new Error(
        `FakeTransport queue is empty; got an unexpected run with prompt: ${req.prompt.slice(0, 80)}`,
      );
    }
    return next;
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `bun test tests/core/agent/`
Expected: PASS, 5 tests.

- [ ] **Step 10: Commit**

```bash
git add src/core/agent tests/core/agent
git commit -m "feat: add Agent SDK transport with subscription-only env and test fake"
```

---

### Task 8: Meat verdict cache

**Files:**
- Create: `src/core/meat/cache.ts`
- Test: `tests/core/meat/cache.test.ts`

**Interfaces:**
- Consumes: `Hunk` from `src/core/diff/types.ts` (Task 2).
- Produces:
  - `interface CachedVerdict { keep: boolean; reason: string }`
  - `function hunkKey(filePath: string, hunk: Hunk): string`
  - `interface VerdictCache { get(key: string): Promise<CachedVerdict | null>; set(key: string, v: CachedVerdict): Promise<void> }`
  - `class FileVerdictCache implements VerdictCache` — constructor `(repoSlug: string, rootDir?: string)`
  - `class MemoryVerdictCache implements VerdictCache`

- [ ] **Step 1: Write the failing tests**

`tests/core/meat/cache.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileVerdictCache,
  MemoryVerdictCache,
  hunkKey,
} from '../../../src/core/meat/cache.js';
import type { Hunk } from '../../../src/core/diff/types.js';

function hunk(text: string): Hunk {
  return {
    header: '@@ -1,1 +1,1 @@',
    section: '',
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: [{ kind: 'add', text, oldLine: null, newLine: 1, noNewlineAtEof: false }],
  };
}

test('hunkKey is stable for identical content', () => {
  expect(hunkKey('a.ts', hunk('x'))).toBe(hunkKey('a.ts', hunk('x')));
});

test('hunkKey changes with content, path, or position', () => {
  expect(hunkKey('a.ts', hunk('x'))).not.toBe(hunkKey('a.ts', hunk('y')));
  expect(hunkKey('a.ts', hunk('x'))).not.toBe(hunkKey('b.ts', hunk('x')));

  const moved = { ...hunk('x'), newStart: 99 };
  expect(hunkKey('a.ts', hunk('x'))).not.toBe(hunkKey('a.ts', moved));
});

test('MemoryVerdictCache round-trips', async () => {
  const cache = new MemoryVerdictCache();
  expect(await cache.get('k')).toBeNull();
  await cache.set('k', { keep: true, reason: 'core logic' });
  expect(await cache.get('k')).toEqual({ keep: true, reason: 'core logic' });
});

test('FileVerdictCache persists across instances', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'marrow-cache-'));
  try {
    const first = new FileVerdictCache('srtfisher/marrow', dir);
    await first.set('abc', { keep: false, reason: 'noise' });

    const second = new FileVerdictCache('srtfisher/marrow', dir);
    expect(await second.get('abc')).toEqual({ keep: false, reason: 'noise' });

    const otherRepo = new FileVerdictCache('other/repo', dir);
    expect(await otherRepo.get('abc')).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FileVerdictCache survives a corrupt cache file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'marrow-cache-'));
  try {
    const cache = new FileVerdictCache('srtfisher/marrow', dir);
    await cache.set('abc', { keep: true, reason: 'ok' });
    await Bun.write(join(dir, 'srtfisher__marrow.json'), '{not json');

    const reopened = new FileVerdictCache('srtfisher/marrow', dir);
    expect(await reopened.get('abc')).toBeNull();
    await reopened.set('def', { keep: true, reason: 'recovered' });
    expect(await reopened.get('def')).toEqual({ keep: true, reason: 'recovered' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/core/meat/cache.test.ts`
Expected: FAIL — cannot resolve `cache.js`.

- [ ] **Step 3: Write the implementation**

`src/core/meat/cache.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Hunk } from '../diff/types.js';

export interface CachedVerdict {
  keep: boolean;
  reason: string;
}

export interface VerdictCache {
  get(key: string): Promise<CachedVerdict | null>;
  set(key: string, verdict: CachedVerdict): Promise<void>;
}

/**
 * Content-addressed key for a hunk. Includes the file path and hunk position so
 * an identical snippet in two places is judged in its own context, but excludes
 * anything that changes without the content changing.
 */
export function hunkKey(filePath: string, hunk: Hunk): string {
  const body = hunk.lines.map((l) => `${l.kind}:${l.text}`).join('\n');
  return createHash('sha256')
    .update(`${filePath} ${hunk.oldStart} ${hunk.newStart} ${body}`)
    .digest('hex');
}

export class MemoryVerdictCache implements VerdictCache {
  private readonly map = new Map<string, CachedVerdict>();

  async get(key: string): Promise<CachedVerdict | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, verdict: CachedVerdict): Promise<void> {
    this.map.set(key, verdict);
  }
}

export function cacheRoot(): string {
  return join(homedir(), '.cache', 'marrow', 'meat');
}

/**
 * JSON-file-backed cache, one file per repository. Loaded lazily and written
 * atomically. A corrupt file is treated as an empty cache rather than an error —
 * losing cached verdicts costs tokens, not correctness.
 */
export class FileVerdictCache implements VerdictCache {
  private readonly path: string;
  private loaded: Map<string, CachedVerdict> | null = null;

  constructor(repoSlug: string, rootDir: string = cacheRoot()) {
    this.path = join(rootDir, `${repoSlug.replace(/\//g, '__')}.json`);
  }

  private async load(): Promise<Map<string, CachedVerdict>> {
    if (this.loaded) return this.loaded;
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Record<
        string,
        CachedVerdict
      >;
      this.loaded = new Map(Object.entries(parsed));
    } catch {
      this.loaded = new Map();
    }
    return this.loaded;
  }

  async get(key: string): Promise<CachedVerdict | null> {
    return (await this.load()).get(key) ?? null;
  }

  async set(key: string, verdict: CachedVerdict): Promise<void> {
    const map = await this.load();
    map.set(key, verdict);

    await mkdir(join(this.path, '..'), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(map)), 'utf8');
    await rename(tmp, this.path);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/core/meat/cache.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/meat/cache.ts tests/core/meat/cache.test.ts
git commit -m "feat: add content-addressed meat verdict cache"
```

---

### Task 9: Meat classification and orchestration

**Files:**
- Create: `src/core/meat/classify.ts`, `src/core/meat/index.ts`
- Test: `tests/core/meat/classify.test.ts`, `tests/core/meat/index.test.ts`

**Interfaces:**
- Consumes: `DiffFile`, `Hunk` (Task 2); `evaluateFile`, `evaluateHunk`, `RuleContext` (Task 6); `AgentTransport` (Task 7); `VerdictCache`, `hunkKey` (Task 8).
- Produces:
  - `const CLASSIFY_SCHEMA: Record<string, unknown>`
  - `function chunkHunks(items: ClassifyItem[], maxChars: number): ClassifyItem[][]`
  - `interface ClassifyItem { id: string; filePath: string; hunk: Hunk }`
  - `interface ClassifyResult { summary: string; verdicts: Map<string, CachedVerdict> }`
  - `function classifyHunks(transport: AgentTransport, model: string, prTitle: string, prBody: string, items: ClassifyItem[], maxChars?: number): Promise<ClassifyResult>`
  - `interface MeatHunk { hunk: Hunk; keep: boolean; reason: string; source: 'rule' | 'model' | 'cache' }`
  - `interface MeatFile { file: DiffFile; dropped: RuleVerdict | null; hunks: MeatHunk[] }`
  - `interface MeatResult { summary: string; files: MeatFile[]; keptLines: number; totalLines: number; keptFiles: number; totalFiles: number }`
  - `function computeMeat(opts: ComputeMeatOptions): Promise<MeatResult>` where `ComputeMeatOptions = { files: DiffFile[]; ruleContext: RuleContext; transport: AgentTransport; cache: VerdictCache; model: string; prTitle: string; prBody: string }`

- [ ] **Step 1: Write the failing classify tests**

`tests/core/meat/classify.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { chunkHunks, classifyHunks, CLASSIFY_SCHEMA } from '../../../src/core/meat/classify.js';
import { FakeTransport } from '../../../src/core/agent/fake.js';
import type { Hunk } from '../../../src/core/diff/types.js';

function hunk(text: string): Hunk {
  return {
    header: '@@ -1,1 +1,1 @@',
    section: '',
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: [{ kind: 'add', text, oldLine: null, newLine: 1, noNewlineAtEof: false }],
  };
}

const items = [
  { id: 'h1', filePath: 'a.ts', hunk: hunk('const a = 1;') },
  { id: 'h2', filePath: 'b.ts', hunk: hunk('const b = 2;') },
];

test('schema requires a summary and per-hunk verdicts', () => {
  expect(CLASSIFY_SCHEMA['type']).toBe('object');
  const required = CLASSIFY_SCHEMA['required'] as string[];
  expect(required).toContain('summary');
  expect(required).toContain('verdicts');
});

test('chunks never split a hunk and respect the char budget', () => {
  const big = [
    { id: 'a', filePath: 'a.ts', hunk: hunk('x'.repeat(400)) },
    { id: 'b', filePath: 'b.ts', hunk: hunk('y'.repeat(400)) },
    { id: 'c', filePath: 'c.ts', hunk: hunk('z'.repeat(400)) },
  ];
  const chunks = chunkHunks(big, 900);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.flat().map((i) => i.id)).toEqual(['a', 'b', 'c']);
  for (const chunk of chunks) expect(chunk.length).toBeGreaterThan(0);
});

test('an oversized single hunk still gets its own chunk', () => {
  const chunks = chunkHunks([{ id: 'a', filePath: 'a.ts', hunk: hunk('x'.repeat(5000)) }], 100);
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!).toHaveLength(1);
});

test('merges verdicts across chunks and keeps the first summary', async () => {
  const transport = new FakeTransport();
  transport.queue({
    structured: {
      summary: 'Adds two constants.',
      verdicts: [{ id: 'h1', keep: true, reason: 'new public constant' }],
    },
  });
  transport.queue({
    structured: {
      summary: 'second summary',
      verdicts: [{ id: 'h2', keep: false, reason: 'trivial' }],
    },
  });

  const result = await classifyHunks(transport, 'sonnet', 'Title', 'Body', items, 60);

  expect(result.summary).toBe('Adds two constants.');
  expect(result.verdicts.get('h1')).toEqual({ keep: true, reason: 'new public constant' });
  expect(result.verdicts.get('h2')).toEqual({ keep: false, reason: 'trivial' });
  expect(transport.requests).toHaveLength(2);
  expect(transport.requests[0]!.model).toBe('sonnet');
  expect(transport.requests[0]!.schema).toBe(CLASSIFY_SCHEMA);
});

test('a hunk the model omits defaults to kept', async () => {
  const transport = new FakeTransport();
  transport.queue({ structured: { summary: 's', verdicts: [] } });

  const result = await classifyHunks(transport, 'sonnet', 'T', 'B', items, 100_000);

  expect(result.verdicts.get('h1')).toEqual({
    keep: true,
    reason: 'not classified; kept by default',
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/core/meat/classify.test.ts`
Expected: FAIL — cannot resolve `classify.js`.

- [ ] **Step 3: Write the classifier**

`src/core/meat/classify.ts`:

```ts
import type { AgentTransport } from '../agent/types.js';
import type { Hunk } from '../diff/types.js';
import type { CachedVerdict } from './cache.js';

export interface ClassifyItem {
  /** Stable id used to correlate the model's verdict back to the hunk. */
  id: string;
  filePath: string;
  hunk: Hunk;
}

export interface ClassifyResult {
  summary: string;
  verdicts: Map<string, CachedVerdict>;
}

export const CLASSIFY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'verdicts'],
  properties: {
    summary: {
      type: 'string',
      description: 'One or two sentences on what this pull request actually does.',
    },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'keep', 'reason'],
        properties: {
          id: { type: 'string' },
          keep: { type: 'boolean' },
          reason: { type: 'string', description: 'One short clause.' },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You abridge code diffs for human review.

For each hunk decide whether a reviewer who wants to understand the concepts,
algorithm choices, and architecture of this change needs to read it.

Keep a hunk when it changes behavior, logic, control flow, data shape, a public
interface, or a security- or correctness-relevant detail.

Drop a hunk when it is mechanical: pure renames, boilerplate, test fixtures that
restate the obvious, formatting, or changes whose meaning is fully implied by
another hunk you kept.

Bias toward keeping when genuinely uncertain — a reviewer can skim an extra hunk,
but cannot review one they never saw. Give every verdict a short reason.`;

function renderHunk(item: ClassifyItem): string {
  const body = item.hunk.lines
    .map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`)
    .join('\n');
  return `<hunk id="${item.id}" file="${item.filePath}">\n${item.hunk.header}\n${body}\n</hunk>`;
}

/**
 * Groups hunks into chunks under a character budget, never splitting a hunk. A
 * single hunk larger than the budget gets its own chunk rather than being cut.
 */
export function chunkHunks(items: ClassifyItem[], maxChars: number): ClassifyItem[][] {
  const chunks: ClassifyItem[][] = [];
  let current: ClassifyItem[] = [];
  let size = 0;

  for (const item of items) {
    const rendered = renderHunk(item).length;
    if (current.length > 0 && size + rendered > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += rendered;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

interface RawVerdict {
  id: string;
  keep: boolean;
  reason: string;
}

export async function classifyHunks(
  transport: AgentTransport,
  model: string,
  prTitle: string,
  prBody: string,
  items: ClassifyItem[],
  maxChars = 40_000,
): Promise<ClassifyResult> {
  const verdicts = new Map<string, CachedVerdict>();
  if (items.length === 0) return { summary: '', verdicts };

  const chunks = chunkHunks(items, maxChars);

  const runs = await Promise.all(
    chunks.map((chunk) =>
      transport.run({
        model,
        systemPrompt: SYSTEM_PROMPT,
        schema: CLASSIFY_SCHEMA,
        disallowedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash'],
        prompt: [
          `Pull request: ${prTitle}`,
          prBody.trim().length > 0 ? `\nDescription:\n${prBody.trim()}` : '',
          '\nClassify every hunk below. Return one verdict per hunk id.\n',
          chunk.map(renderHunk).join('\n\n'),
        ].join('\n'),
      }),
    ),
  );

  let summary = '';
  for (const run of runs) {
    const structured = run.structured as
      | { summary?: string; verdicts?: RawVerdict[] }
      | null;
    if (!structured) continue;

    if (summary.length === 0 && typeof structured.summary === 'string') {
      summary = structured.summary;
    }
    for (const v of structured.verdicts ?? []) {
      verdicts.set(v.id, { keep: v.keep, reason: v.reason });
    }
  }

  // Anything the model failed to classify is kept — never silently hidden.
  for (const item of items) {
    if (!verdicts.has(item.id)) {
      verdicts.set(item.id, { keep: true, reason: 'not classified; kept by default' });
    }
  }

  return { summary, verdicts };
}
```

- [ ] **Step 4: Run the classify tests to verify they pass**

Run: `bun test tests/core/meat/classify.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing orchestration test**

`tests/core/meat/index.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { computeMeat } from '../../../src/core/meat/index.js';
import { MemoryVerdictCache, hunkKey } from '../../../src/core/meat/cache.js';
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
```

- [ ] **Step 6: Run the orchestration test to verify it fails**

Run: `bun test tests/core/meat/index.test.ts`
Expected: FAIL — cannot resolve `index.js`.

- [ ] **Step 7: Write the orchestrator**

`src/core/meat/index.ts`:

```ts
import type { AgentTransport } from '../agent/types.js';
import type { DiffFile, Hunk } from '../diff/types.js';
import { hunkKey, type CachedVerdict, type VerdictCache } from './cache.js';
import { classifyHunks, type ClassifyItem } from './classify.js';
import { evaluateFile, evaluateHunk, type RuleContext, type RuleVerdict } from './rules.js';

export interface MeatHunk {
  hunk: Hunk;
  keep: boolean;
  reason: string;
  source: 'rule' | 'model' | 'cache';
}

export interface MeatFile {
  file: DiffFile;
  /** Set when a file-level rule dropped the whole file. */
  dropped: RuleVerdict | null;
  hunks: MeatHunk[];
}

export interface MeatResult {
  summary: string;
  files: MeatFile[];
  keptLines: number;
  totalLines: number;
  keptFiles: number;
  totalFiles: number;
}

export interface ComputeMeatOptions {
  files: DiffFile[];
  ruleContext: RuleContext;
  transport: AgentTransport;
  cache: VerdictCache;
  model: string;
  prTitle: string;
  prBody: string;
}

function changedLineCount(hunk: Hunk): number {
  return hunk.lines.filter((l) => l.kind !== 'context').length;
}

export async function computeMeat(opts: ComputeMeatOptions): Promise<MeatResult> {
  const staged: MeatFile[] = [];
  const toClassify: ClassifyItem[] = [];
  const pendingKeys = new Map<string, MeatHunk>();

  for (const file of opts.files) {
    const fileVerdict = evaluateFile(file, opts.ruleContext);
    if (fileVerdict) {
      staged.push({
        file,
        dropped: fileVerdict,
        hunks: file.hunks.map((hunk) => ({
          hunk,
          keep: false,
          reason: fileVerdict.rule,
          source: 'rule' as const,
        })),
      });
      continue;
    }

    const hunks: MeatHunk[] = [];
    for (const hunk of file.hunks) {
      const hunkVerdict = evaluateHunk(hunk);
      if (hunkVerdict) {
        hunks.push({ hunk, keep: false, reason: hunkVerdict.rule, source: 'rule' });
        continue;
      }

      const key = hunkKey(file.path, hunk);
      const cached = await opts.cache.get(key);
      if (cached) {
        hunks.push({ hunk, keep: cached.keep, reason: cached.reason, source: 'cache' });
        continue;
      }

      const entry: MeatHunk = {
        hunk,
        keep: true,
        reason: 'pending classification',
        source: 'model',
      };
      hunks.push(entry);
      pendingKeys.set(key, entry);
      toClassify.push({ id: key, filePath: file.path, hunk });
    }

    staged.push({ file, dropped: null, hunks });
  }

  let summary = '';
  if (toClassify.length > 0) {
    const classified = await classifyHunks(
      opts.transport,
      opts.model,
      opts.prTitle,
      opts.prBody,
      toClassify,
    );
    summary = classified.summary;

    for (const [key, verdict] of classified.verdicts) {
      const entry = pendingKeys.get(key);
      if (!entry) continue;
      entry.keep = verdict.keep;
      entry.reason = verdict.reason;
      await opts.cache.set(key, verdict satisfies CachedVerdict);
    }
  }

  let keptLines = 0;
  let totalLines = 0;
  let keptFiles = 0;

  for (const meatFile of staged) {
    let fileKept = 0;
    for (const h of meatFile.hunks) {
      const count = changedLineCount(h.hunk);
      totalLines += count;
      if (h.keep) {
        keptLines += count;
        fileKept += count;
      }
    }
    if (fileKept > 0) keptFiles += 1;
  }

  return {
    summary,
    files: staged,
    keptLines,
    totalLines,
    keptFiles,
    totalFiles: staged.length,
  };
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test tests/core/meat/ && bun run typecheck`
Expected: PASS, 14 tests in `tests/core/meat/`; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add src/core/meat tests/core/meat
git commit -m "feat: add meat classification pass and rules/cache/model orchestration"
```

---

### Task 10: Review anchors, payload, and submission

**Files:**
- Create: `src/core/review/types.ts`, `src/core/review/anchors.ts`, `src/core/review/payload.ts`, `src/core/github/submit.ts`
- Test: `tests/core/review/anchors.test.ts`, `tests/core/review/payload.test.ts`

**Interfaces:**
- Consumes: `DiffFile` (Task 2); `OctokitLike` (Task 3).
- Produces:
  - `type Verdict = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'`
  - `type Side = 'LEFT' | 'RIGHT'`
  - `interface StagedComment { id: string; path: string; line: number; side: Side; startLine: number | null; body: string; suggestion: string | null }`
  - `interface ReviewDraft { verdict: Verdict | null; body: string; comments: StagedComment[] }`
  - `interface AnchorProblem { commentId: string; reason: string }`
  - `function findAnchorProblems(draft: ReviewDraft, files: DiffFile[]): AnchorProblem[]`
  - `function demoteUnanchorable(draft: ReviewDraft, files: DiffFile[]): { draft: ReviewDraft; demoted: StagedComment[] }`
  - `function renderCommentBody(comment: StagedComment): string`
  - `interface ReviewPayload { event: Verdict; body: string; comments: { path: string; line: number; side: Side; start_line?: number; start_side?: Side; body: string }[] }`
  - `function buildReviewPayload(draft: ReviewDraft, files: DiffFile[]): ReviewPayload`
  - `function submitReview(octokit: OctokitLike, owner: string, repo: string, pull_number: number, payload: ReviewPayload): Promise<{ id: number; htmlUrl: string }>`

- [ ] **Step 1: Write the failing anchor tests**

`tests/core/review/anchors.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { parseUnifiedDiff } from '../../../src/core/diff/parse.js';
import {
  demoteUnanchorable,
  findAnchorProblems,
} from '../../../src/core/review/anchors.js';
import type { ReviewDraft, StagedComment } from '../../../src/core/review/types.js';

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,4 @@ function boot()
 const c = load();
-start(c);
+const s = start(c);
+s.on('error', fail);
 return c;
@@ -50,2 +47,1 @@ function shutdown()
 keep();
-drop();
`;

const files = parseUnifiedDiff(DIFF);

// The second hunk is load-bearing for this fixture. With only the first hunk,
// the old and new ranges both start at 10, so every valid LEFT line is also a
// valid RIGHT line — and the "reject a RIGHT comment on a deleted line" test
// would pass for the wrong reason. The trailing pure deletion gives old line 51
// no counterpart on the RIGHT side, so the rule is actually exercised.
// Hunk counts verified: 1 context + 1 deletion = 2 old, 1 new.

function comment(over: Partial<StagedComment> = {}): StagedComment {
  return {
    id: 'c1',
    path: 'src/app.ts',
    line: 12,
    side: 'RIGHT',
    startLine: null,
    body: 'Consider handling this.',
    suggestion: null,
    ...over,
  };
}

function draft(comments: StagedComment[]): ReviewDraft {
  return { verdict: 'COMMENT', body: '', comments };
}

test('accepts a comment on an added line', () => {
  expect(findAnchorProblems(draft([comment({ line: 12 })]), files)).toEqual([]);
});

test('accepts a comment on a context line', () => {
  expect(findAnchorProblems(draft([comment({ line: 13 })]), files)).toEqual([]);
});

test('accepts a LEFT comment on a deleted line', () => {
  const problems = findAnchorProblems(draft([comment({ line: 51, side: 'LEFT' })]), files);
  expect(problems).toEqual([]);
});

test('rejects a line outside every hunk', () => {
  const problems = findAnchorProblems(draft([comment({ line: 500 })]), files);
  expect(problems).toHaveLength(1);
  expect(problems[0]!.reason).toMatch(/not present in the diff/);
});

test('rejects an unknown file path', () => {
  const problems = findAnchorProblems(draft([comment({ path: 'src/other.ts' })]), files);
  expect(problems).toHaveLength(1);
  expect(problems[0]!.reason).toMatch(/not part of this pull request/);
});

test('rejects a RIGHT comment aimed at a deleted line', () => {
  const problems = findAnchorProblems(draft([comment({ line: 51, side: 'RIGHT' })]), files);
  expect(problems).toHaveLength(1);
});

test('rejects a range whose start is after its end', () => {
  const problems = findAnchorProblems(
    draft([comment({ line: 12, startLine: 13 })]),
    files,
  );
  expect(problems).toHaveLength(1);
  expect(problems[0]!.reason).toMatch(/startLine/);
});

test('demotes unanchorable comments into the review body', () => {
  const good = comment({ id: 'ok', line: 12 });
  const bad = comment({ id: 'bad', line: 500, body: 'Wider concern about boot().' });

  const { draft: cleaned, demoted } = demoteUnanchorable(
    { verdict: 'COMMENT', body: 'Overall looks reasonable.', comments: [good, bad] },
    files,
  );

  expect(cleaned.comments.map((c) => c.id)).toEqual(['ok']);
  expect(demoted.map((c) => c.id)).toEqual(['bad']);
  expect(cleaned.body).toContain('Overall looks reasonable.');
  expect(cleaned.body).toContain('Wider concern about boot().');
  expect(cleaned.body).toContain('src/app.ts');
});

test('demoting nothing leaves the body untouched', () => {
  const original = { verdict: 'COMMENT' as const, body: 'Body.', comments: [comment()] };
  const { draft: cleaned, demoted } = demoteUnanchorable(original, files);
  expect(demoted).toEqual([]);
  expect(cleaned.body).toBe('Body.');
});
```

- [ ] **Step 2: Run the anchor tests to verify they fail**

Run: `bun test tests/core/review/anchors.test.ts`
Expected: FAIL — cannot resolve `anchors.js`.

- [ ] **Step 3: Write the review types**

`src/core/review/types.ts`:

```ts
export type Verdict = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

/** RIGHT anchors to the post-image, LEFT to a deleted line in the pre-image. */
export type Side = 'LEFT' | 'RIGHT';

export interface StagedComment {
  /** Stable local id; not sent to GitHub. */
  id: string;
  path: string;
  /** End line of the comment, in the side's numbering. */
  line: number;
  side: Side;
  /** Start line for a multi-line comment, else null. */
  startLine: number | null;
  body: string;
  /**
   * Replacement code for a GitHub suggestion block. For a multi-line
   * suggestion the line range must cover exactly the lines being replaced.
   */
  suggestion: string | null;
}

export interface ReviewDraft {
  verdict: Verdict | null;
  body: string;
  comments: StagedComment[];
}
```

- [ ] **Step 4: Write anchor validation**

`src/core/review/anchors.ts`:

```ts
import type { DiffFile } from '../diff/types.js';
import type { ReviewDraft, Side, StagedComment } from './types.js';

export interface AnchorProblem {
  commentId: string;
  reason: string;
}

/** Line numbers GitHub will accept a comment on, per file and side. */
function anchorableLines(files: DiffFile[]): Map<string, { LEFT: Set<number>; RIGHT: Set<number> }> {
  const map = new Map<string, { LEFT: Set<number>; RIGHT: Set<number> }>();

  for (const file of files) {
    const entry = { LEFT: new Set<number>(), RIGHT: new Set<number>() };
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.oldLine !== null) entry.LEFT.add(line.oldLine);
        if (line.newLine !== null) entry.RIGHT.add(line.newLine);
      }
    }
    map.set(file.path, entry);
  }

  return map;
}

function problem(comment: StagedComment, reason: string): AnchorProblem {
  return { commentId: comment.id, reason };
}

export function findAnchorProblems(
  draft: ReviewDraft,
  files: DiffFile[],
): AnchorProblem[] {
  const anchors = anchorableLines(files);
  const problems: AnchorProblem[] = [];

  for (const comment of draft.comments) {
    const entry = anchors.get(comment.path);
    if (!entry) {
      problems.push(problem(comment, `${comment.path} is not part of this pull request`));
      continue;
    }

    if (comment.startLine !== null && comment.startLine > comment.line) {
      problems.push(problem(comment, 'startLine must not be greater than line'));
      continue;
    }

    const valid: Set<number> = entry[comment.side];
    const lines: number[] =
      comment.startLine === null
        ? [comment.line]
        : Array.from(
            { length: comment.line - comment.startLine + 1 },
            (_, i) => comment.startLine! + i,
          );

    const missing = lines.filter((l) => !valid.has(l));
    if (missing.length > 0) {
      problems.push(
        problem(
          comment,
          `line ${missing[0]} on the ${comment.side} side is not present in the diff for ${comment.path}`,
        ),
      );
    }
  }

  return problems;
}

function describeSide(side: Side): string {
  return side === 'LEFT' ? 'removed line' : 'line';
}

/**
 * Splits a draft into comments GitHub will accept and comments it will not.
 * The rejected ones are folded into the review body rather than discarded — a
 * finding about an unchanged line is still worth telling the author.
 */
export function demoteUnanchorable(
  draft: ReviewDraft,
  files: DiffFile[],
): { draft: ReviewDraft; demoted: StagedComment[] } {
  const problems = findAnchorProblems(draft, files);
  if (problems.length === 0) return { draft, demoted: [] };

  const bad = new Set(problems.map((p) => p.commentId));
  const kept = draft.comments.filter((c) => !bad.has(c.id));
  const demoted = draft.comments.filter((c) => bad.has(c.id));

  const rendered = demoted
    .map(
      (c) =>
        `- **${c.path}** (${describeSide(c.side)} ${c.line}, not in the diff): ${c.body}`,
    )
    .join('\n');

  const body = [draft.body.trim(), '### Additional comments', rendered]
    .filter((part) => part.length > 0)
    .join('\n\n');

  return { draft: { ...draft, body, comments: kept }, demoted };
}
```

- [ ] **Step 5: Run the anchor tests to verify they pass**

Run: `bun test tests/core/review/anchors.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Write the failing payload tests**

`tests/core/review/payload.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { parseUnifiedDiff } from '../../../src/core/diff/parse.js';
import {
  buildReviewPayload,
  renderCommentBody,
} from '../../../src/core/review/payload.js';
import type { ReviewDraft, StagedComment } from '../../../src/core/review/types.js';

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,4 @@ function boot()
 const c = load();
-start(c);
+const s = start(c);
+s.on('error', fail);
 return c;
`;

const files = parseUnifiedDiff(DIFF);

function comment(over: Partial<StagedComment> = {}): StagedComment {
  return {
    id: 'c1',
    path: 'src/app.ts',
    line: 12,
    side: 'RIGHT',
    startLine: null,
    body: 'Handle this.',
    suggestion: null,
    ...over,
  };
}

test('renders a plain comment body unchanged', () => {
  expect(renderCommentBody(comment())).toBe('Handle this.');
});

test('appends a suggestion fence when a suggestion is present', () => {
  const rendered = renderCommentBody(
    comment({ suggestion: 'const s = start(c) ?? fallback();' }),
  );
  expect(rendered).toBe(
    'Handle this.\n\n```suggestion\nconst s = start(c) ?? fallback();\n```',
  );
});

test('builds a single-line comment payload', () => {
  const draft: ReviewDraft = { verdict: 'COMMENT', body: 'Body.', comments: [comment()] };
  const payload = buildReviewPayload(draft, files);

  expect(payload.event).toBe('COMMENT');
  expect(payload.body).toBe('Body.');
  expect(payload.comments).toEqual([
    { path: 'src/app.ts', line: 12, side: 'RIGHT', body: 'Handle this.' },
  ]);
});

test('includes start_line and start_side for a range comment', () => {
  const draft: ReviewDraft = {
    verdict: 'REQUEST_CHANGES',
    body: '',
    comments: [comment({ line: 13, startLine: 12 })],
  };
  const payload = buildReviewPayload(draft, files);

  expect(payload.event).toBe('REQUEST_CHANGES');
  expect(payload.comments[0]).toEqual({
    path: 'src/app.ts',
    line: 13,
    side: 'RIGHT',
    start_line: 12,
    start_side: 'RIGHT',
    body: 'Handle this.',
  });
});

test('throws rather than submitting an invalid anchor', () => {
  const draft: ReviewDraft = {
    verdict: 'COMMENT',
    body: '',
    comments: [comment({ line: 999 })],
  };
  expect(() => buildReviewPayload(draft, files)).toThrow(/not present in the diff/);
});

test('throws when no verdict has been chosen', () => {
  const draft: ReviewDraft = { verdict: null, body: 'x', comments: [] };
  expect(() => buildReviewPayload(draft, files)).toThrow(/verdict/);
});

test('an approval with no body and no comments is still valid', () => {
  const draft: ReviewDraft = { verdict: 'APPROVE', body: '', comments: [] };
  const payload = buildReviewPayload(draft, files);
  expect(payload).toEqual({ event: 'APPROVE', body: '', comments: [] });
});
```

- [ ] **Step 7: Run the payload tests to verify they fail**

Run: `bun test tests/core/review/payload.test.ts`
Expected: FAIL — cannot resolve `payload.js`.

- [ ] **Step 8: Write the payload builder**

`src/core/review/payload.ts`:

```ts
import type { DiffFile } from '../diff/types.js';
import { findAnchorProblems } from './anchors.js';
import type { ReviewDraft, Side, StagedComment, Verdict } from './types.js';

export interface PayloadComment {
  path: string;
  line: number;
  side: Side;
  start_line?: number;
  start_side?: Side;
  body: string;
}

export interface ReviewPayload {
  event: Verdict;
  body: string;
  comments: PayloadComment[];
}

export function renderCommentBody(comment: StagedComment): string {
  if (comment.suggestion === null) return comment.body;
  return `${comment.body}\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``;
}

/**
 * Builds the createReview payload, validating anchors first.
 *
 * GitHub rejects a review atomically — one bad anchor discards every comment in
 * it — so this throws locally rather than letting the API 422 after the user has
 * already committed to submitting.
 */
export function buildReviewPayload(draft: ReviewDraft, files: DiffFile[]): ReviewPayload {
  if (draft.verdict === null) {
    throw new Error('Cannot build a review payload without a verdict.');
  }

  const problems = findAnchorProblems(draft, files);
  if (problems.length > 0) {
    throw new Error(
      `Cannot submit: ${problems.length} comment(s) have invalid anchors. First: ${problems[0]!.reason}`,
    );
  }

  const comments: PayloadComment[] = draft.comments.map((c) => {
    const base: PayloadComment = {
      path: c.path,
      line: c.line,
      side: c.side,
      body: renderCommentBody(c),
    };
    if (c.startLine !== null) {
      base.start_line = c.startLine;
      base.start_side = c.side;
    }
    return base;
  });

  return { event: draft.verdict, body: draft.body, comments };
}
```

- [ ] **Step 9: Write the submission call**

`src/core/github/submit.ts`:

```ts
import type { ReviewPayload } from '../review/payload.js';

/** The slice of Octokit needed to submit, so tests can supply a fake. */
export interface ReviewSubmitter {
  rest: {
    pulls: {
      createReview(params: Record<string, unknown>): Promise<{
        data: { id: number; html_url: string };
      }>;
    };
  };
}

export async function submitReview(
  octokit: ReviewSubmitter,
  owner: string,
  repo: string,
  pull_number: number,
  payload: ReviewPayload,
): Promise<{ id: number; htmlUrl: string }> {
  const { data } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number,
    event: payload.event,
    body: payload.body,
    comments: payload.comments,
  });

  return { id: data.id, htmlUrl: data.html_url };
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `bun test tests/core/review/ && bun run typecheck && bun run lint:boundary`
Expected: PASS, 16 tests; typecheck clean; no boundary violations.

- [ ] **Step 11: Commit**

```bash
git add src/core/review src/core/github/submit.ts tests/core/review
git commit -m "feat: add review anchor validation, payload builder, and submission"
```

---

### Task 11: CLI wiring and stdout renderer

Proves the whole pipeline end to end without any Ink. This is what makes Plan 1 shippable on its own.

**Files:**
- Create: `src/cli.ts`, `src/core/render/text.ts`
- Test: `tests/core/render/text.test.ts`, `tests/cli/args.test.ts`
- Create: `src/cli/args.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–10.
- Produces:
  - `interface CliArgs { prNumber: number | null; model: string; meatModel: string; dryRun: boolean; useApiKey: boolean; showHelp: boolean; filter: PullFilter }`
  - `function parseArgs(argv: string[]): CliArgs`
  - `function tierBelow(model: string): string`
  - `function renderMeat(result: MeatResult): string`

- [ ] **Step 1: Write the failing arg tests**

`tests/cli/args.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { parseArgs, tierBelow } from '../../src/cli/args.js';

test('defaults to opus with sonnet for the meat pass', () => {
  const args = parseArgs([]);
  expect(args.model).toBe('opus');
  expect(args.meatModel).toBe('sonnet');
  expect(args.prNumber).toBeNull();
  expect(args.dryRun).toBe(false);
  expect(args.useApiKey).toBe(false);
});

test('parses a bare PR number', () => {
  expect(parseArgs(['42']).prNumber).toBe(42);
});

test('parses a PR URL', () => {
  expect(parseArgs(['https://github.com/srtfisher/marrow/pull/42']).prNumber).toBe(42);
});

test('--model shifts the meat model down a tier', () => {
  const args = parseArgs(['--model', 'sonnet']);
  expect(args.model).toBe('sonnet');
  expect(args.meatModel).toBe('haiku');
});

test('--meat-model overrides independently', () => {
  const args = parseArgs(['--model', 'opus', '--meat-model', 'haiku']);
  expect(args.meatModel).toBe('haiku');
});

test('parses flags', () => {
  const args = parseArgs(['--dry-run', '--use-api-key', '42']);
  expect(args.dryRun).toBe(true);
  expect(args.useApiKey).toBe(true);
  expect(args.prNumber).toBe(42);
});

test('haiku stays at haiku', () => {
  expect(tierBelow('haiku')).toBe('haiku');
});

test('rejects an unknown flag with a clear message', () => {
  expect(() => parseArgs(['--nope'])).toThrow(/Unknown option: --nope/);
});
```

- [ ] **Step 2: Run the arg tests to verify they fail**

Run: `bun test tests/cli/args.test.ts`
Expected: FAIL — cannot resolve `args.js`.

- [ ] **Step 3: Write arg parsing**

`src/cli/args.ts`:

```ts
import type { PullFilter } from '../core/github/types.js';

export interface CliArgs {
  prNumber: number | null;
  model: string;
  meatModel: string;
  dryRun: boolean;
  useApiKey: boolean;
  showHelp: boolean;
  filter: PullFilter;
}

const TIERS = ['opus', 'sonnet', 'haiku'] as const;

export function tierBelow(model: string): string {
  const i = TIERS.indexOf(model as (typeof TIERS)[number]);
  if (i === -1) return model;
  return TIERS[Math.min(i + 1, TIERS.length - 1)]!;
}

const PR_URL_RE = /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/;

export function parseArgs(argv: string[]): CliArgs {
  let prNumber: number | null = null;
  let model = 'opus';
  let meatModel: string | null = null;
  let dryRun = false;
  let useApiKey = false;
  let showHelp = false;
  let filter: PullFilter = 'open';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--use-api-key') { useApiKey = true; continue; }
    if (arg === '--help' || arg === '-h') { showHelp = true; continue; }

    if (arg === '--model') { model = argv[++i] ?? model; continue; }
    if (arg === '--meat-model') { meatModel = argv[++i] ?? null; continue; }
    if (arg === '--filter') { filter = (argv[++i] ?? 'open') as PullFilter; continue; }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    const fromUrl = PR_URL_RE.exec(arg);
    if (fromUrl) { prNumber = Number.parseInt(fromUrl[1]!, 10); continue; }

    const asNumber = Number.parseInt(arg, 10);
    if (!Number.isNaN(asNumber)) { prNumber = asNumber; continue; }

    throw new Error(`Could not interpret argument: ${arg}`);
  }

  return {
    prNumber,
    model,
    meatModel: meatModel ?? tierBelow(model),
    dryRun,
    useApiKey,
    showHelp,
    filter,
  };
}
```

- [ ] **Step 4: Run the arg tests to verify they pass**

Run: `bun test tests/cli/args.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing renderer test**

`tests/core/render/text.test.ts`:

```ts
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
  expect(out).toContain('kept 1/2 changed lines in 1/2 files');
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
```

- [ ] **Step 6: Run the renderer test to verify it fails**

Run: `bun test tests/core/render/text.test.ts`
Expected: FAIL — cannot resolve `text.js`.

- [ ] **Step 7: Write the renderer**

`src/core/render/text.ts`:

```ts
import type { MeatResult } from '../meat/index.js';
import type { DiffLine } from '../diff/types.js';

function marker(line: DiffLine): string {
  if (line.kind === 'add') return '+';
  if (line.kind === 'del') return '-';
  return ' ';
}

/** Plain-text rendering of a meat result. Plan 2 replaces this with the TUI. */
export function renderMeat(result: MeatResult): string {
  const out: string[] = [];

  if (result.summary.length > 0) {
    out.push(result.summary, '');
  }

  out.push(
    `kept ${result.keptLines}/${result.totalLines} changed lines in ${result.keptFiles}/${result.totalFiles} files`,
    '',
  );

  for (const file of result.files) {
    if (file.dropped) {
      out.push(`── ${file.file.path}  (dropped: ${file.dropped.rule})`, '');
      continue;
    }

    const kept = file.hunks.filter((h) => h.keep);
    const droppedCount = file.hunks.length - kept.length;

    const suffix = droppedCount > 0 ? `  (${droppedCount} hunk(s) dropped)` : '';
    out.push(`── ${file.file.path}${suffix}`);

    if (kept.length === 0) {
      out.push('   (nothing kept)', '');
      continue;
    }

    for (const meatHunk of kept) {
      out.push(`   ${meatHunk.hunk.header}    [${meatHunk.reason}]`);
      for (const line of meatHunk.hunk.lines) {
        out.push(`   ${marker(line)}${line.text}`);
      }
      out.push('');
    }
  }

  return out.join('\n');
}
```

- [ ] **Step 8: Run the renderer test to verify it passes**

Run: `bun test tests/core/render/text.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 9: Write the CLI entry point**

`src/cli.ts`:

```ts
#!/usr/bin/env node
import { Octokit } from '@octokit/rest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from './cli/args.js';
import { SdkTransport } from './core/agent/sdk.js';
import { GitHubClient } from './core/github/client.js';
import { fetchPullContext } from './core/github/graphql.js';
import { resolveGitHubToken } from './core/github/auth.js';
import { detectRepo } from './core/git/repo.js';
import { ensureWorktree } from './core/git/worktree.js';
import { parseGeneratedPaths } from './core/git/gitattributes.js';
import { parseUnifiedDiff } from './core/diff/parse.js';
import { computeMeat } from './core/meat/index.js';
import { FileVerdictCache } from './core/meat/cache.js';
import { renderMeat } from './core/render/text.js';

const HELP = `marrow — review large pull requests in the terminal

Usage:
  marrow                      list pull requests for the current repo
  marrow <number|url>         review a pull request
  marrow --dry-run <number>   print what would be reviewed, submit nothing

Options:
  --model <alias>       reasoning model (default: opus)
  --meat-model <alias>  diff classifier (default: one tier below --model)
  --filter <f>          open | review-requested | all (default: open)
  --use-api-key         allow ANTHROPIC_API_KEY; otherwise the Claude Code
                        subscription is used and the key is stripped
  -h, --help            show this help
`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    process.stdout.write(HELP);
    return 0;
  }

  const repo = await detectRepo(process.cwd());
  if (!repo) {
    process.stderr.write(
      'Not inside a GitHub clone. Run marrow from a repository with a github.com origin.\n',
    );
    return 1;
  }

  const token = await resolveGitHubToken();
  const octokit = new Octokit({ auth: token });
  const client = new GitHubClient(token, octokit as never);

  const viewer = (await octokit.rest.users.getAuthenticated()).data.login;

  if (args.prNumber === null) {
    const prs = await client.listPulls(repo.owner, repo.repo, args.filter);
    for (const pr of prs) {
      process.stdout.write(
        `#${pr.number}\t${pr.state}\t${pr.author}\t${pr.title}\n`,
      );
    }
    return 0;
  }

  const pr = await client.getPull(repo.owner, repo.repo, args.prNumber, viewer);
  const context = await fetchPullContext(
    (query, vars) => octokit.graphql(query, vars),
    repo.owner,
    repo.repo,
    args.prNumber,
  );

  if (!args.useApiKey && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) {
    process.stderr.write(
      'note: ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN found and withheld from the agent so your Claude Code subscription is used. Pass --use-api-key to override.\n',
    );
  }

  // The worktree only supplies reading context; failing to create one is not fatal.
  try {
    await ensureWorktree(repo, pr.number, pr.headSha);
  } catch {
    process.stderr.write('note: could not create a worktree; continuing diff-only.\n');
  }

  let generatedPaths = new Set<string>();
  try {
    generatedPaths = parseGeneratedPaths(
      await readFile(join(repo.root, '.gitattributes'), 'utf8'),
    );
  } catch {
    // No .gitattributes is the common case.
  }

  const result = await computeMeat({
    files: parseUnifiedDiff(pr.diff),
    ruleContext: { generatedPaths },
    transport: new SdkTransport({ useApiKey: args.useApiKey }),
    cache: new FileVerdictCache(`${repo.owner}/${repo.repo}`),
    model: args.meatModel,
    prTitle: pr.title,
    prBody: pr.body,
  });

  process.stdout.write(`${pr.title} #${pr.number} by ${pr.author}\n`);
  process.stdout.write(`${pr.baseRef} <- ${pr.headRef}\n\n`);

  const failing = context.checks.filter((c) => c.conclusion === 'failure');
  if (failing.length > 0) {
    process.stdout.write(`failing checks: ${failing.map((c) => c.name).join(', ')}\n\n`);
  }
  if (context.threads.length > 0) {
    process.stdout.write(`${context.threads.length} existing review thread(s)\n\n`);
  }
  if (context.viewerPendingReviewId !== null) {
    process.stdout.write('warning: you have an unsubmitted review on this PR from the web UI\n\n');
  }

  process.stdout.write(renderMeat(result));

  if (args.dryRun) {
    process.stdout.write('\n(dry run: nothing was submitted)\n');
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
```

- [ ] **Step 10: Verify the whole suite and build**

Run: `bun test && bun run typecheck && bun run lint:boundary && bun run build`
Expected: all tests PASS; typecheck clean; no boundary violations; `dist/cli.js` emitted.

- [ ] **Step 11: Smoke-test against a real PR**

Run from inside any GitHub clone you have:

```bash
node dist/cli.js --help
node dist/cli.js --filter open
node dist/cli.js --dry-run <a real PR number in that repo>
```

Expected: help renders; the PR list prints; the dry run prints a summary, a
`kept N/M changed lines` counter, kept hunks, and dropped files with rule names.
Confirm the subscription note appears if you have `ANTHROPIC_API_KEY` set.

- [ ] **Step 12: Commit**

```bash
git add src/cli.ts src/cli/args.ts src/core/render tests/cli tests/core/render
git commit -m "feat: add CLI entry point and plain-text meat renderer"
```

---

## Plan 1 self-review

**Spec coverage.** Every Plan-1-scoped spec section maps to a task: architecture and boundary → Task 1; diff parsing → Task 2; GitHub auth, reads, threads, checks, pending-review detection → Tasks 3–4; worktrees, `.gitattributes` → Task 5; deterministic rules → Task 6; subscription-only auth and the transport seam → Task 7; verdict cache → Task 8; LLM classification, chunking, orchestration, kept-counters → Task 9; anchor validation, demote-to-top-level, payload, submission → Task 10; CLI, `--model`/`--meat-model`/`--dry-run`/`--use-api-key`, degraded modes → Task 11.

**Deferred with intent.** These spec items belong to later plans and are not gaps in Plan 1: the whole TUI including the keymap, `!` submit screen, syntax highlighting, and `$EDITOR` handoff (Plan 2); triage-state persistence and head-SHA carry-over (Plan 2, where triage state first exists); the findings pass, adversarial verify, and chat (Plan 3); `~/.config/marrow/config.json` (Plan 2).

**Type consistency.** `CommandRunner` is defined once in `src/core/github/auth.ts` and reused by `git/repo.ts` and `git/worktree.ts`. `CachedVerdict` is defined in `meat/cache.ts` and consumed by `classify.ts` and `index.ts`. `Side` is defined in `review/types.ts` and used by `anchors.ts` and `payload.ts`. `OctokitLike` (reads, Task 3) and `ReviewSubmitter` (writes, Task 10) are deliberately separate narrow interfaces rather than one wide one.

**One known seam.** Task 7 Step 5 may surface a typecheck mismatch on `message.message.content` or `message.usage`, because those shapes come from the SDK rather than from this plan. The step says to read the exact shape from the installed `sdk.d.ts` and narrow correctly rather than widening to `any` — `src/core/agent/sdk.ts` is the only file permitted to know SDK shapes.
