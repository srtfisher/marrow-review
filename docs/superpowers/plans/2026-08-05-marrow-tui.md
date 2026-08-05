# marrow TUI Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn marrow from a stdout dump into a navigable two-pane terminal app: browse a repo's pull requests, walk the meat-abridged diff, stage inline comments and suggestions, and submit one GitHub review.

**Architecture:** Ink 7 components under `src/tui/**`, consuming the pure `src/core/**` library built in Plan 1. The dependency-cruiser rule keeps core UI-free, so all UI state lives in the TUI layer. The single hardest piece — deciding which slice of a long line list is visible — is built first as a pure function with its own tests, and every scrolling view sits inside it.

**Tech Stack:** Ink 7.1.1, React 19.2+, TypeScript strict, `bun test`. Read `docs/superpowers/specs/2026-08-05-plan2-ink-research.md` before starting — it records Ink 7's real API, verified against the installed package.

**Spec:** `docs/superpowers/specs/2026-08-05-marrow-design.md`

## Global Constraints

- **Node 24, ESM.** All relative imports carry a `.js` extension even though sources are `.ts`/`.tsx`.
- **`src/core/**` must never import from `src/tui/**`, `ink`, or `react`.** Enforced by `bun run lint:boundary`, which must stay green. The TUI depends on core; never the reverse.
- **TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.** Indexed access yields `T | undefined`.
- **Tests import from `bun:test`.** No live network or model calls in tests.
- **React 19.2.0+ is a required peer of Ink 7** and must be a real dependency.
- **JSX:** `.tsx` files, `"jsx": "react-jsx"` in tsconfig.
- Exact versions: `ink@7.1.1`, `react@^19.2.0`, `@types/react@^19.2.18`, `ink-text-input@6.0.0`.
- Commit after every task, conventional-commit prefix.

## Deliberately out of scope for Plan 2

- **Syntax highlighting.** Diff `+`/`−` coloring is in; token-level language coloring is not. `cli-highlight` is pinned to a 2021 `highlight.js` and CJS `chalk`; `shiki` needs real work to emit ANSI. Doing it correctly also means highlighting whole files from the worktree and mapping onto diff lines. Deferred until the interaction model is proven.
- **AI findings, adversarial verify, chat pane.** Plan 3.
- **Cross-repo inbox**, replying to existing threads, editing submitted comments.

## Interfaces this plan consumes from Plan 1 (all committed and tested)

```ts
// src/core/meat/index.ts
computeMeat(opts): Promise<MeatResult>
MeatResult { summary: string; files: MeatFile[]; keptLines: number; totalLines: number;
             keptFiles: number; totalFiles: number }
MeatFile   { file: DiffFile; dropped: RuleVerdict | null; hunks: MeatHunk[] }
MeatHunk   { hunk: Hunk; keep: boolean; reason: string; source: 'rule'|'model'|'cache' }

// src/core/diff/types.ts
DiffFile { path; oldPath: string|null; status; similarity: number|null; hunks: Hunk[];
           additions: number; deletions: number }
Hunk     { header; section; oldStart; oldLines; newStart; newLines; lines: DiffLine[] }
DiffLine { kind: 'context'|'add'|'del'; text: string; oldLine: number|null;
           newLine: number|null; noNewlineAtEof: boolean }

// src/core/review/types.ts
Verdict = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
Side = 'LEFT' | 'RIGHT'
StagedComment { id; path; line; side: Side; startLine: number|null; body;
                suggestion: string|null }
ReviewDraft   { verdict: Verdict|null; body: string; comments: StagedComment[] }

// src/core/review/anchors.ts
findAnchorProblems(draft, files): AnchorProblem[]      // AnchorProblem { commentId, reason }
demoteUnanchorable(draft, files): { draft, demoted }

// src/core/review/payload.ts
buildReviewPayload(draft, files): ReviewPayload         // throws on bad anchor / null verdict
renderCommentBody(comment): string

// src/core/github/submit.ts   submitReview(octokit, owner, repo, n, payload)
// src/core/github/client.ts   GitHubClient.listPulls / .getPull
// src/core/github/graphql.ts  fetchPullContext(graphql, owner, repo, n)
// src/core/github/types.ts    PullRequestSummary, PullRequestDetail, ReviewThread, CheckRun, PullFilter
```

## File Structure

| File | Responsibility |
|---|---|
| `src/tui/viewport.ts` | Pure windowing math. No React. The most-tested file in this plan. |
| `src/tui/Viewport.tsx` | Thin component wrapping the math; every scrolling view sits inside it. |
| `src/tui/units.ts` | Flattens a `MeatResult` into the flat `ReviewUnit[]` the cursor walks. Pure. |
| `src/tui/keymap.ts` | Maps `(input, key, mode)` → a named `Action`. Pure and exhaustively tested. |
| `src/tui/theme.ts` | Colors in one place. |
| `src/tui/components/DiffLines.tsx` | Renders hunk lines with add/del/context coloring. |
| `src/tui/components/PrList.tsx` | Left pane. |
| `src/tui/components/Detail.tsx` | Right pane: header, summary, files, hunks. |
| `src/tui/components/StatusBar.tsx` | Bottom line. |
| `src/tui/components/CommentEditor.tsx` | Inline body entry + `$EDITOR` handoff. |
| `src/tui/components/SubmitScreen.tsx` | Verdict pick, staged-comment review, confirm. |
| `src/tui/components/Help.tsx` | `?` overlay generated from the keymap. |
| `src/tui/App.tsx` | Top-level state machine and layout. |
| `src/tui/editor.ts` | `$EDITOR` spawn with Ink raw-mode suspend/resume. |
| `src/core/store/review.ts` | Resume persistence. Core, not TUI — it is pure I/O over plain data. |
| `src/cli.ts` | Modified: launches the TUI unless `--dry-run`. |

---

### Task 1: Dependencies, JSX config, and a rendering shell

**Files:**
- Modify: `package.json`, `tsconfig.json`
- Create: `src/tui/theme.ts`, `src/tui/App.tsx`, `tests/tui/shell.test.tsx`

**Interfaces:**
- Consumes: nothing from Plan 1 yet.
- Produces: `theme` object; `<App/>` accepting `{ repoLabel: string }`; a green `bun run lint:boundary` proving core still has no React/Ink edge.

- [ ] **Step 1: Write the failing test**

`tests/tui/shell.test.tsx`:

```tsx
import { test, expect } from 'bun:test';
import { renderToString } from 'ink';
import { App } from '../../src/tui/App.js';

test('renders the repo label in the shell', () => {
  const out = renderToString(<App repoLabel="srtfisher/marrow" />);
  expect(out).toContain('srtfisher/marrow');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/tui/shell.test.tsx`
Expected: FAIL — cannot resolve `ink` or `../../src/tui/App.js`.

- [ ] **Step 3: Install and configure**

```bash
bun add ink@7.1.1 react@^19.2.0
bun add -d @types/react@^19.2.18
```

Add to `tsconfig.json` `compilerOptions`: `"jsx": "react-jsx"`. Leave every other flag alone.

- [ ] **Step 4: Write the theme and shell**

`src/tui/theme.ts`:

```ts
export const theme = {
  add: 'green',
  del: 'red',
  context: 'gray',
  dropped: 'gray',
  heading: 'cyan',
  accent: 'yellow',
  danger: 'red',
  muted: 'gray',
} as const;
```

`src/tui/App.tsx`:

```tsx
import { Box, Text } from 'ink';
import { theme } from './theme.js';

export interface AppProps {
  repoLabel: string;
}

export function App({ repoLabel }: AppProps) {
  return (
    <Box flexDirection="column">
      <Text color={theme.heading}>{repoLabel}</Text>
    </Box>
  );
}
```

- [ ] **Step 5: Verify**

Run: `bun test tests/tui/shell.test.tsx && bun run typecheck && bun run lint:boundary`
Expected: test PASS; typecheck clean; **boundary clean** — this is the important assertion, since React and Ink are now installed and core must still not reach them.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock tsconfig.json src/tui tests/tui
git commit -m "feat(tui): add Ink and React with a rendering shell"
```

---

### Task 2: Viewport windowing math

The one piece of genuinely novel logic in this plan. Pure, so it gets tested hard.

**Files:**
- Create: `src/tui/viewport.ts`, `src/tui/Viewport.tsx`
- Test: `tests/tui/viewport.test.ts`

**Interfaces:**
- Produces:
  - `interface Window { start: number; end: number }` — `end` exclusive
  - `function computeWindow(total: number, height: number, cursor: number, scrollTop: number, margin?: number): Window`
  - `function nextScrollTop(total: number, height: number, cursor: number, scrollTop: number, margin?: number): number`
  - `<Viewport items={ReactNode[]} height={number} cursor={number} scrollTop={number} />`

**Design note for the implementer:** `scrollTop` is state owned by the caller, not derived. `nextScrollTop` computes the minimal scroll adjustment that keeps the cursor at least `margin` rows from the top and bottom edges, so scrolling only happens when the cursor would otherwise leave the visible area — the cursor does not sit pinned to the middle.

- [ ] **Step 1: Write the failing tests**

`tests/tui/viewport.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import { computeWindow, nextScrollTop } from '../../src/tui/viewport.js';

describe('computeWindow', () => {
  test('shows everything when content fits', () => {
    expect(computeWindow(5, 10, 0, 0)).toEqual({ start: 0, end: 5 });
  });

  test('shows exactly height rows when content overflows', () => {
    const w = computeWindow(100, 10, 0, 0);
    expect(w.end - w.start).toBe(10);
  });

  test('never scrolls past the end', () => {
    const w = computeWindow(100, 10, 99, 500);
    expect(w.end).toBe(100);
    expect(w.start).toBe(90);
  });

  test('clamps a negative scrollTop', () => {
    expect(computeWindow(100, 10, 0, -5)).toEqual({ start: 0, end: 10 });
  });

  test('handles zero height without inverting', () => {
    const w = computeWindow(100, 0, 0, 0);
    expect(w.end).toBeGreaterThanOrEqual(w.start);
  });

  test('handles empty content', () => {
    expect(computeWindow(0, 10, 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('nextScrollTop', () => {
  test('does not scroll while the cursor is comfortably inside', () => {
    expect(nextScrollTop(100, 20, 10, 0, 3)).toBe(0);
  });

  test('scrolls down just enough when the cursor nears the bottom', () => {
    // height 20, margin 3 => cursor must stay <= scrollTop + 16
    expect(nextScrollTop(100, 20, 17, 0, 3)).toBe(1);
  });

  test('scrolls up just enough when the cursor nears the top', () => {
    expect(nextScrollTop(100, 20, 50, 49, 3)).toBe(47);
  });

  test('never returns a negative scrollTop', () => {
    expect(nextScrollTop(100, 20, 0, 0, 3)).toBe(0);
  });

  test('never scrolls past the last full page', () => {
    expect(nextScrollTop(100, 20, 99, 0, 3)).toBe(80);
  });

  test('returns 0 when content fits entirely', () => {
    expect(nextScrollTop(5, 20, 4, 0, 3)).toBe(0);
  });

  test('a jump to the top pulls scrollTop back to 0', () => {
    expect(nextScrollTop(100, 20, 0, 80, 3)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/tui/viewport.test.ts`
Expected: FAIL — cannot resolve `viewport.js`.

- [ ] **Step 3: Implement the math**

`src/tui/viewport.ts`:

```ts
export interface Window {
  start: number;
  /** Exclusive. */
  end: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Largest valid scrollTop: the offset that puts the last row at the bottom. */
function maxScrollTop(total: number, height: number): number {
  return Math.max(0, total - height);
}

export function computeWindow(
  total: number,
  height: number,
  _cursor: number,
  scrollTop: number,
): Window {
  const usableHeight = Math.max(0, height);
  const start = clamp(scrollTop, 0, maxScrollTop(total, usableHeight));
  const end = Math.min(total, start + usableHeight);
  return { start, end };
}

/**
 * Minimal scroll adjustment keeping the cursor at least `margin` rows from both
 * edges. Returns the current scrollTop unchanged when no adjustment is needed,
 * so the view stays still while the cursor moves within the comfortable band.
 */
export function nextScrollTop(
  total: number,
  height: number,
  cursor: number,
  scrollTop: number,
  margin = 3,
): number {
  const usableHeight = Math.max(0, height);
  const limit = maxScrollTop(total, usableHeight);
  if (limit === 0) return 0;

  // A margin cannot exceed what the height can accommodate on both sides.
  const effectiveMargin = Math.min(margin, Math.max(0, Math.floor((usableHeight - 1) / 2)));

  let next = clamp(scrollTop, 0, limit);
  const topBound = next + effectiveMargin;
  const bottomBound = next + usableHeight - 1 - effectiveMargin;

  if (cursor < topBound) next = cursor - effectiveMargin;
  else if (cursor > bottomBound) next = cursor - usableHeight + 1 + effectiveMargin;

  return clamp(next, 0, limit);
}
```

- [ ] **Step 4: Write the component**

`src/tui/Viewport.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Box } from 'ink';
import { computeWindow } from './viewport.js';

export interface ViewportProps {
  items: ReactNode[];
  height: number;
  cursor: number;
  scrollTop: number;
}

/** Renders only the visible slice. Keeps large diffs from re-rendering wholesale. */
export function Viewport({ items, height, cursor, scrollTop }: ViewportProps) {
  const { start, end } = computeWindow(items.length, height, cursor, scrollTop);
  return (
    <Box flexDirection="column">
      {items.slice(start, end).map((item, i) => (
        <Box key={start + i}>{item}</Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 5: Verify**

Run: `bun test tests/tui/viewport.test.ts && bun run typecheck`
Expected: 13 tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/tui/viewport.ts src/tui/Viewport.tsx tests/tui/viewport.test.ts
git commit -m "feat(tui): add viewport windowing math and component"
```

---

### Task 3: Review units — the flat list the cursor walks

**Files:**
- Create: `src/tui/units.ts`
- Test: `tests/tui/units.test.ts`

**Interfaces:**
- Consumes: `MeatResult`, `MeatFile`, `MeatHunk` from `src/core/meat/index.js`; `DiffFile`, `Hunk` from `src/core/diff/types.js`.
- Produces:
  - `type ReviewUnit = { kind: 'file-header'; file: MeatFile; index: number } | { kind: 'hunk'; file: MeatFile; hunk: MeatHunk; index: number } | { kind: 'dropped-summary'; file: MeatFile; count: number; index: number }`
  - `interface UnitOptions { expandedFiles: ReadonlySet<string>; foldedFiles: ReadonlySet<string> }`
  - `function buildUnits(result: MeatResult, options: UnitOptions): ReviewUnit[]`
  - `function nextFileIndex(units: ReviewUnit[], from: number): number`
  - `function prevFileIndex(units: ReviewUnit[], from: number): number`

**Design note:** dropped hunks are not omitted from the model — they collapse into a single `dropped-summary` unit per file, which becomes real hunk units when that file is in `expandedFiles` (the `z` key). This is what makes "nothing is hidden" true structurally rather than by convention.

- [ ] **Step 1: Write the failing tests**

`tests/tui/units.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import { buildUnits, nextFileIndex, prevFileIndex } from '../../src/tui/units.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import type { DiffFile, Hunk } from '../../src/core/diff/types.js';

function hunk(text: string): Hunk {
  return {
    header: `@@ ${text} @@`,
    section: '',
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: [{ kind: 'add', text, oldLine: null, newLine: 1, noNewlineAtEof: false }],
  };
}

function diffFile(path: string): DiffFile {
  return {
    path, oldPath: null, status: 'modified', similarity: null,
    hunks: [], additions: 1, deletions: 0,
  };
}

function meatFile(path: string, keeps: number, drops: number): MeatFile {
  return {
    file: diffFile(path),
    dropped: null,
    hunks: [
      ...Array.from({ length: keeps }, (_, i) => ({
        hunk: hunk(`keep${i}`), keep: true, reason: 'logic', source: 'model' as const,
      })),
      ...Array.from({ length: drops }, (_, i) => ({
        hunk: hunk(`drop${i}`), keep: false, reason: 'imports-only', source: 'rule' as const,
      })),
    ],
  };
}

function result(files: MeatFile[]): MeatResult {
  return {
    summary: 's', files,
    keptLines: 0, totalLines: 0, keptFiles: 0, totalFiles: files.length,
  };
}

const none = { expandedFiles: new Set<string>(), foldedFiles: new Set<string>() };

describe('buildUnits', () => {
  test('emits a header then kept hunks then one dropped summary', () => {
    const units = buildUnits(result([meatFile('a.ts', 2, 3)]), none);
    expect(units.map((u) => u.kind)).toEqual([
      'file-header', 'hunk', 'hunk', 'dropped-summary',
    ]);
    const summary = units[3]!;
    expect(summary.kind === 'dropped-summary' && summary.count).toBe(3);
  });

  test('omits the dropped summary when nothing was dropped', () => {
    const units = buildUnits(result([meatFile('a.ts', 2, 0)]), none);
    expect(units.map((u) => u.kind)).toEqual(['file-header', 'hunk', 'hunk']);
  });

  test('expanding a file turns dropped hunks into real units', () => {
    const opts = { expandedFiles: new Set(['a.ts']), foldedFiles: new Set<string>() };
    const units = buildUnits(result([meatFile('a.ts', 1, 2)]), opts);
    expect(units.map((u) => u.kind)).toEqual(['file-header', 'hunk', 'hunk', 'hunk']);
  });

  test('a folded file shows only its header', () => {
    const opts = { expandedFiles: new Set<string>(), foldedFiles: new Set(['a.ts']) };
    const units = buildUnits(result([meatFile('a.ts', 2, 1)]), opts);
    expect(units.map((u) => u.kind)).toEqual(['file-header']);
  });

  test('a rule-dropped whole file still gets a header so it is never invisible', () => {
    const dropped: MeatFile = {
      file: diffFile('pnpm-lock.yaml'),
      dropped: { drop: true, rule: 'lockfile' },
      hunks: [],
    };
    const units = buildUnits(result([dropped]), none);
    expect(units).toHaveLength(1);
    expect(units[0]!.kind).toBe('file-header');
  });

  test('assigns sequential indexes across files', () => {
    const units = buildUnits(result([meatFile('a.ts', 1, 0), meatFile('b.ts', 1, 0)]), none);
    expect(units.map((u) => u.index)).toEqual([0, 1, 2, 3]);
  });
});

describe('file navigation', () => {
  const units = buildUnits(
    result([meatFile('a.ts', 2, 0), meatFile('b.ts', 2, 0), meatFile('c.ts', 1, 0)]),
    none,
  );
  // indexes: 0 hdr(a) 1 hunk 2 hunk 3 hdr(b) 4 hunk 5 hunk 6 hdr(c) 7 hunk

  test('nextFileIndex jumps to the following header', () => {
    expect(nextFileIndex(units, 1)).toBe(3);
    expect(nextFileIndex(units, 3)).toBe(6);
  });

  test('nextFileIndex stays put at the last file', () => {
    expect(nextFileIndex(units, 7)).toBe(6);
  });

  test('prevFileIndex jumps to the preceding header', () => {
    expect(prevFileIndex(units, 5)).toBe(3);
    expect(prevFileIndex(units, 3)).toBe(0);
  });

  test('prevFileIndex stays put at the first file', () => {
    expect(prevFileIndex(units, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/tui/units.test.ts`
Expected: FAIL — cannot resolve `units.js`.

- [ ] **Step 3: Implement**

`src/tui/units.ts`:

```ts
import type { MeatFile, MeatHunk, MeatResult } from '../core/meat/index.js';

export type ReviewUnit =
  | { kind: 'file-header'; file: MeatFile; index: number }
  | { kind: 'hunk'; file: MeatFile; hunk: MeatHunk; index: number }
  | { kind: 'dropped-summary'; file: MeatFile; count: number; index: number };

export interface UnitOptions {
  /** Paths whose dropped hunks are currently revealed (the `z` key). */
  expandedFiles: ReadonlySet<string>;
  /** Paths collapsed to just their header (the Space key). */
  foldedFiles: ReadonlySet<string>;
}

export function buildUnits(result: MeatResult, options: UnitOptions): ReviewUnit[] {
  const units: ReviewUnit[] = [];
  let index = 0;

  for (const file of result.files) {
    const path = file.file.path;
    units.push({ kind: 'file-header', file, index: index++ });

    if (options.foldedFiles.has(path)) continue;

    const expanded = options.expandedFiles.has(path);
    const kept = file.hunks.filter((h) => h.keep);
    const dropped = file.hunks.filter((h) => !h.keep);

    const shown = expanded ? file.hunks : kept;
    for (const hunk of shown) {
      units.push({ kind: 'hunk', file, hunk, index: index++ });
    }

    if (!expanded && dropped.length > 0) {
      units.push({
        kind: 'dropped-summary', file, count: dropped.length, index: index++,
      });
    }
  }

  return units;
}

export function nextFileIndex(units: ReviewUnit[], from: number): number {
  for (let i = from + 1; i < units.length; i += 1) {
    if (units[i]!.kind === 'file-header') return i;
  }
  // Already in the last file: fall back to that file's own header.
  return prevFileIndex(units, from);
}

export function prevFileIndex(units: ReviewUnit[], from: number): number {
  for (let i = from - 1; i >= 0; i -= 1) {
    if (units[i]!.kind === 'file-header') return i;
  }
  return 0;
}
```

- [ ] **Step 4: Verify**

Run: `bun test tests/tui/units.test.ts && bun run typecheck`
Expected: 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/units.ts tests/tui/units.test.ts
git commit -m "feat(tui): model the diff as a flat list of navigable review units"
```

---

### Task 4: Keymap

**Files:**
- Create: `src/tui/keymap.ts`
- Test: `tests/tui/keymap.test.ts`

**Interfaces:**
- Produces:
  - `type Mode = 'list' | 'detail' | 'comment' | 'submit' | 'help'`
  - `type Action = { type: 'move'; delta: number } | { type: 'half-page'; dir: -1|1 } | { type: 'file'; dir: -1|1 } | { type: 'open' } | { type: 'back' } | { type: 'toggle-dropped' } | { type: 'toggle-dropped-all' } | { type: 'toggle-fold' } | { type: 'toggle-full-diff' } | { type: 'toggle-threads' } | { type: 'open-browser' } | { type: 'comment' } | { type: 'suggest' } | { type: 'submit-screen' } | { type: 'filter'; filter: PullFilter } | { type: 'help' } | { type: 'quit' } | { type: 'refresh' } | null`
  - `function resolveAction(input: string, key: KeyLike, mode: Mode): Action`
  - `interface KeyLike { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean; ctrl?: boolean; pageUp?: boolean; pageDown?: boolean }`
  - `const KEY_HELP: ReadonlyArray<{ keys: string; description: string; modes: Mode[] }>`

**Design note:** `resolveAction` is pure so the whole keymap is testable without rendering. `KeyLike` is a structural subset of Ink's `Key`, which keeps this file free of an Ink import and lets `src/tui/keymap.ts` be unit-tested directly. The `?` help overlay is generated from `KEY_HELP`, so help can never drift from the bindings.

- [ ] **Step 1: Write the failing tests**

`tests/tui/keymap.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import { resolveAction, KEY_HELP } from '../../src/tui/keymap.js';

const noKey = {};

describe('detail mode', () => {
  test('j and k move the cursor', () => {
    expect(resolveAction('j', noKey, 'detail')).toEqual({ type: 'move', delta: 1 });
    expect(resolveAction('k', noKey, 'detail')).toEqual({ type: 'move', delta: -1 });
  });

  test('arrow keys mirror j and k', () => {
    expect(resolveAction('', { downArrow: true }, 'detail')).toEqual({ type: 'move', delta: 1 });
    expect(resolveAction('', { upArrow: true }, 'detail')).toEqual({ type: 'move', delta: -1 });
  });

  test('ctrl-d and ctrl-u are half-page moves', () => {
    expect(resolveAction('d', { ctrl: true }, 'detail')).toEqual({ type: 'half-page', dir: 1 });
    expect(resolveAction('u', { ctrl: true }, 'detail')).toEqual({ type: 'half-page', dir: -1 });
  });

  test('plain d toggles the full diff and is not confused with ctrl-d', () => {
    expect(resolveAction('d', noKey, 'detail')).toEqual({ type: 'toggle-full-diff' });
  });

  test('bracket keys move by file', () => {
    expect(resolveAction(']', noKey, 'detail')).toEqual({ type: 'file', dir: 1 });
    expect(resolveAction('[', noKey, 'detail')).toEqual({ type: 'file', dir: -1 });
  });

  test('z and Z reveal dropped hunks', () => {
    expect(resolveAction('z', noKey, 'detail')).toEqual({ type: 'toggle-dropped' });
    expect(resolveAction('Z', noKey, 'detail')).toEqual({ type: 'toggle-dropped-all' });
  });

  test('C authors a comment and S a suggestion', () => {
    expect(resolveAction('C', noKey, 'detail')).toEqual({ type: 'comment' });
    expect(resolveAction('S', noKey, 'detail')).toEqual({ type: 'suggest' });
  });

  test('bang opens the submit screen', () => {
    expect(resolveAction('!', noKey, 'detail')).toEqual({ type: 'submit-screen' });
  });

  test('no single letter maps to submit, so approve cannot be hit by accident', () => {
    for (const ch of 'aAxXmMsScC') {
      const action = resolveAction(ch, noKey, 'detail');
      expect(action?.type).not.toBe('submit-screen');
    }
  });
});

describe('list mode', () => {
  test('enter opens the selected PR', () => {
    expect(resolveAction('', { return: true }, 'list')).toEqual({ type: 'open' });
  });

  test('digits pick a filter', () => {
    expect(resolveAction('1', noKey, 'list')).toEqual({ type: 'filter', filter: 'open' });
    expect(resolveAction('2', noKey, 'list')).toEqual({ type: 'filter', filter: 'review-requested' });
    expect(resolveAction('3', noKey, 'list')).toEqual({ type: 'filter', filter: 'all' });
  });

  test('detail-only keys do nothing in list mode', () => {
    expect(resolveAction('z', noKey, 'list')).toBeNull();
    expect(resolveAction('!', noKey, 'list')).toBeNull();
  });
});

describe('comment mode', () => {
  test('escape backs out and ordinary characters are not actions', () => {
    expect(resolveAction('', { escape: true }, 'comment')).toEqual({ type: 'back' });
    expect(resolveAction('j', noKey, 'comment')).toBeNull();
    expect(resolveAction('!', noKey, 'comment')).toBeNull();
  });
});

describe('global keys', () => {
  test('question mark and q work from detail', () => {
    expect(resolveAction('?', noKey, 'detail')).toEqual({ type: 'help' });
    expect(resolveAction('q', noKey, 'detail')).toEqual({ type: 'quit' });
  });

  test('typing keys are inert in comment mode even if global elsewhere', () => {
    expect(resolveAction('q', noKey, 'comment')).toBeNull();
    expect(resolveAction('?', noKey, 'comment')).toBeNull();
  });
});

describe('KEY_HELP', () => {
  test('documents every binding the resolver answers to in detail mode', () => {
    const documented = KEY_HELP.filter((e) => e.modes.includes('detail'));
    expect(documented.length).toBeGreaterThan(8);
    for (const entry of documented) {
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/tui/keymap.test.ts`
Expected: FAIL — cannot resolve `keymap.js`.

- [ ] **Step 3: Implement**

`src/tui/keymap.ts`:

```ts
import type { PullFilter } from '../core/github/types.js';

export type Mode = 'list' | 'detail' | 'comment' | 'submit' | 'help';

export type Action =
  | { type: 'move'; delta: number }
  | { type: 'half-page'; dir: -1 | 1 }
  | { type: 'file'; dir: -1 | 1 }
  | { type: 'open' }
  | { type: 'back' }
  | { type: 'toggle-dropped' }
  | { type: 'toggle-dropped-all' }
  | { type: 'toggle-fold' }
  | { type: 'toggle-full-diff' }
  | { type: 'toggle-threads' }
  | { type: 'open-browser' }
  | { type: 'comment' }
  | { type: 'suggest' }
  | { type: 'submit-screen' }
  | { type: 'filter'; filter: PullFilter }
  | { type: 'help' }
  | { type: 'quit' }
  | { type: 'refresh' }
  | null;

/** Structural subset of Ink's Key, so this module needs no Ink import. */
export interface KeyLike {
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
}

export const KEY_HELP: ReadonlyArray<{ keys: string; description: string; modes: Mode[] }> = [
  { keys: 'j / k', description: 'move down / up', modes: ['list', 'detail'] },
  { keys: 'ctrl-d / ctrl-u', description: 'half page down / up', modes: ['detail'] },
  { keys: '] / [', description: 'next / previous file', modes: ['detail'] },
  { keys: 'space', description: 'fold or unfold this file', modes: ['detail'] },
  { keys: 'z / Z', description: 'reveal dropped hunks in this file / everywhere', modes: ['detail'] },
  { keys: 'd', description: 'toggle full diff vs meat', modes: ['detail'] },
  { keys: 't', description: 'toggle existing review threads', modes: ['detail'] },
  { keys: 'o', description: 'open this hunk on github.com', modes: ['detail'] },
  { keys: 'C', description: 'comment on this line', modes: ['detail'] },
  { keys: 'S', description: 'suggest a change on this line', modes: ['detail'] },
  { keys: '!', description: 'open the submit screen', modes: ['detail'] },
  { keys: 'enter', description: 'open the selected pull request', modes: ['list'] },
  { keys: '1 / 2 / 3', description: 'filter: open / needs my review / all', modes: ['list'] },
  { keys: 'R', description: 'refetch from GitHub', modes: ['list', 'detail'] },
  { keys: '?', description: 'this help', modes: ['list', 'detail'] },
  { keys: 'q', description: 'quit', modes: ['list', 'detail'] },
  { keys: 'esc', description: 'back', modes: ['comment', 'submit', 'help'] },
];

const FILTERS: Record<string, PullFilter> = {
  '1': 'open',
  '2': 'review-requested',
  '3': 'all',
};

export function resolveAction(input: string, key: KeyLike, mode: Mode): Action {
  // Text-entry modes swallow everything except an explicit escape, so a stray
  // '!' or 'q' while typing a comment can never trigger a command.
  if (mode === 'comment') {
    return key.escape ? { type: 'back' } : null;
  }

  if (key.escape) return { type: 'back' };

  if (mode === 'help' || mode === 'submit') {
    // Submit-screen internals are handled by the screen itself; only global
    // navigation is resolved here.
    return null;
  }

  if (key.upArrow) return { type: 'move', delta: -1 };
  if (key.downArrow) return { type: 'move', delta: 1 };

  if (key.ctrl && input === 'd') return { type: 'half-page', dir: 1 };
  if (key.ctrl && input === 'u') return { type: 'half-page', dir: -1 };

  if (input === 'j') return { type: 'move', delta: 1 };
  if (input === 'k') return { type: 'move', delta: -1 };
  if (input === '?') return { type: 'help' };
  if (input === 'q') return { type: 'quit' };
  if (input === 'R') return { type: 'refresh' };

  if (mode === 'list') {
    if (key.return) return { type: 'open' };
    const filter = FILTERS[input];
    if (filter) return { type: 'filter', filter };
    return null;
  }

  // mode === 'detail'
  if (input === ']') return { type: 'file', dir: 1 };
  if (input === '[') return { type: 'file', dir: -1 };
  if (input === ' ') return { type: 'toggle-fold' };
  if (input === 'z') return { type: 'toggle-dropped' };
  if (input === 'Z') return { type: 'toggle-dropped-all' };
  if (input === 'd') return { type: 'toggle-full-diff' };
  if (input === 't') return { type: 'toggle-threads' };
  if (input === 'o') return { type: 'open-browser' };
  if (input === 'C') return { type: 'comment' };
  if (input === 'S') return { type: 'suggest' };
  if (input === '!') return { type: 'submit-screen' };

  return null;
}
```

- [ ] **Step 4: Verify**

Run: `bun test tests/tui/keymap.test.ts && bun run typecheck`
Expected: 15 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/keymap.ts tests/tui/keymap.test.ts
git commit -m "feat(tui): add pure keymap with generated help and mode isolation"
```

---

### Task 5: Diff line rendering

**Files:**
- Create: `src/tui/components/DiffLines.tsx`
- Test: `tests/tui/difflines.test.tsx`

**Interfaces:**
- Consumes: `Hunk`, `DiffLine` from `src/core/diff/types.js`; `theme`.
- Produces: `<DiffLines hunk={Hunk} gutterWidth={number} />`, `function formatGutter(line: DiffLine, width: number): string`.

- [ ] **Step 1: Write the failing tests**

`tests/tui/difflines.test.tsx`:

```tsx
import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { DiffLines, formatGutter } from '../../src/tui/components/DiffLines.js';
import type { DiffLine, Hunk } from '../../src/core/diff/types.js';

const line = (kind: DiffLine['kind'], text: string, oldLine: number | null, newLine: number | null): DiffLine =>
  ({ kind, text, oldLine, newLine, noNewlineAtEof: false });

const hunk: Hunk = {
  header: '@@ -10,2 +10,3 @@ boot()',
  section: 'boot()',
  oldStart: 10, oldLines: 2, newStart: 10, newLines: 3,
  lines: [
    line('context', 'const a = 1;', 10, 10),
    line('del', 'old();', 11, null),
    line('add', 'fresh();', null, 11),
  ],
};

describe('formatGutter', () => {
  test('shows both numbers for a context line', () => {
    expect(formatGutter(line('context', 'x', 10, 12), 4)).toBe('  10   12');
  });

  test('blanks the new column for a deletion', () => {
    expect(formatGutter(line('del', 'x', 11, null), 4)).toBe('  11     ');
  });

  test('blanks the old column for an addition', () => {
    expect(formatGutter(line('add', 'x', null, 11), 4)).toBe('       11');
  });
});

describe('DiffLines', () => {
  test('renders every line of the hunk with its marker', () => {
    const out = renderToString(<DiffLines hunk={hunk} gutterWidth={4} />);
    expect(out).toContain('const a = 1;');
    expect(out).toContain('-old();');
    expect(out).toContain('+fresh();');
  });

  test('renders the hunk header', () => {
    const out = renderToString(<DiffLines hunk={hunk} gutterWidth={4} />);
    expect(out).toContain('@@ -10,2 +10,3 @@');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/tui/difflines.test.tsx`
Expected: FAIL — cannot resolve `DiffLines.js`.

- [ ] **Step 3: Implement**

`src/tui/components/DiffLines.tsx`:

```tsx
import { Box, Text } from 'ink';
import type { DiffLine, Hunk } from '../../core/diff/types.js';
import { theme } from '../theme.js';

function pad(value: number | null, width: number): string {
  return value === null ? ' '.repeat(width) : String(value).padStart(width, ' ');
}

/** Two right-aligned line-number columns: old, then new. */
export function formatGutter(line: DiffLine, width: number): string {
  return `${pad(line.oldLine, width + 2)} ${pad(line.newLine, width + 2)}`;
}

function marker(line: DiffLine): string {
  if (line.kind === 'add') return '+';
  if (line.kind === 'del') return '-';
  return ' ';
}

function colorFor(line: DiffLine): string {
  if (line.kind === 'add') return theme.add;
  if (line.kind === 'del') return theme.del;
  return theme.context;
}

export interface DiffLinesProps {
  hunk: Hunk;
  gutterWidth: number;
}

export function DiffLines({ hunk, gutterWidth }: DiffLinesProps) {
  return (
    <Box flexDirection="column">
      <Text color={theme.muted}>{hunk.header}</Text>
      {hunk.lines.map((line, i) => (
        <Text key={i} color={colorFor(line)}>
          {formatGutter(line, gutterWidth)} {marker(line)}
          {line.text}
        </Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 4: Verify**

Run: `bun test tests/tui/difflines.test.tsx && bun run typecheck && bun run lint:boundary`
Expected: 5 tests PASS; boundary still clean.

- [ ] **Step 5: Commit**

```bash
git add src/tui/components/DiffLines.tsx tests/tui/difflines.test.tsx
git commit -m "feat(tui): render diff lines with gutters and add/del coloring"
```

---

### Task 6: Review draft state and persistence

**Files:**
- Create: `src/core/store/review.ts`
- Test: `tests/core/store/review.test.ts`

**Interfaces:**
- Consumes: `ReviewDraft`, `StagedComment` from `src/core/review/types.js`.
- Produces:
  - `interface PersistedReview { version: 1; owner: string; repo: string; number: number; headSha: string; draft: ReviewDraft; updatedAt: string }`
  - `function stateKey(owner, repo, number, headSha): string`
  - `class ReviewStore { constructor(rootDir?: string); load(owner, repo, number, headSha): Promise<PersistedReview | null>; save(record: PersistedReview): Promise<void>; findPreviousHead(owner, repo, number, currentSha): Promise<PersistedReview | null>; clear(owner, repo, number, headSha): Promise<void> }`
  - `function carryOver(previous: ReviewDraft, files: DiffFile[]): { carried: StagedComment[]; orphaned: StagedComment[] }`

**Design note:** `carryOver` is the mid-review-new-commits path from the spec. A staged comment survives when its `(path, side, line)` still resolves to a line present in the new diff; otherwise it is reported orphaned so the user can re-place or drop it. Nothing is silently discarded.

- [ ] **Step 1: Write the failing tests**

`tests/core/store/review.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReviewStore, carryOver, stateKey } from '../../../src/core/store/review.js';
import { parseUnifiedDiff } from '../../../src/core/diff/parse.js';
import type { ReviewDraft, StagedComment } from '../../../src/core/review/types.js';

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,4 @@ boot()
 const c = load();
-start(c);
+const s = start(c);
+s.on('error', fail);
 return c;
`;

const files = parseUnifiedDiff(DIFF);

function comment(over: Partial<StagedComment> = {}): StagedComment {
  return {
    id: 'c1', path: 'src/app.ts', line: 12, side: 'RIGHT',
    startLine: null, body: 'Look at this.', suggestion: null, ...over,
  };
}

function draft(comments: StagedComment[]): ReviewDraft {
  return { verdict: null, body: 'wip', comments };
}

describe('stateKey', () => {
  test('is stable and includes the head sha', () => {
    const a = stateKey('o', 'r', 42, 'abc123');
    expect(a).toBe(stateKey('o', 'r', 42, 'abc123'));
    expect(a).not.toBe(stateKey('o', 'r', 42, 'def456'));
  });
});

describe('ReviewStore', () => {
  test('round-trips a draft', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-store-'));
    try {
      const store = new ReviewStore(dir);
      expect(await store.load('o', 'r', 42, 'sha1')).toBeNull();

      await store.save({
        version: 1, owner: 'o', repo: 'r', number: 42, headSha: 'sha1',
        draft: draft([comment()]), updatedAt: '2026-08-05T00:00:00Z',
      });

      const loaded = await store.load('o', 'r', 42, 'sha1');
      expect(loaded?.draft.comments).toHaveLength(1);
      expect(loaded?.draft.body).toBe('wip');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a different head sha is a different record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-store-'));
    try {
      const store = new ReviewStore(dir);
      await store.save({
        version: 1, owner: 'o', repo: 'r', number: 42, headSha: 'sha1',
        draft: draft([comment()]), updatedAt: 'now',
      });
      expect(await store.load('o', 'r', 42, 'sha2')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('findPreviousHead locates a draft from an earlier sha', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-store-'));
    try {
      const store = new ReviewStore(dir);
      await store.save({
        version: 1, owner: 'o', repo: 'r', number: 42, headSha: 'old',
        draft: draft([comment()]), updatedAt: 'now',
      });
      const found = await store.findPreviousHead('o', 'r', 42, 'new');
      expect(found?.headSha).toBe('old');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a corrupt record loads as null rather than throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-store-'));
    try {
      const store = new ReviewStore(dir);
      await store.save({
        version: 1, owner: 'o', repo: 'r', number: 42, headSha: 'sha1',
        draft: draft([]), updatedAt: 'now',
      });
      await Bun.write(join(dir, `${stateKey('o', 'r', 42, 'sha1')}.json`), '{broken');
      expect(await store.load('o', 'r', 42, 'sha1')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('carryOver', () => {
  test('keeps a comment whose anchor still exists', () => {
    const { carried, orphaned } = carryOver(draft([comment({ line: 12 })]), files);
    expect(carried).toHaveLength(1);
    expect(orphaned).toHaveLength(0);
  });

  test('orphans a comment whose anchor is gone', () => {
    const { carried, orphaned } = carryOver(draft([comment({ line: 900 })]), files);
    expect(carried).toHaveLength(0);
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]!.body).toBe('Look at this.');
  });

  test('orphans a comment whose file left the diff', () => {
    const { orphaned } = carryOver(draft([comment({ path: 'gone.ts' })]), files);
    expect(orphaned).toHaveLength(1);
  });

  test('partitions a mixed set without losing any comment', () => {
    const d = draft([
      comment({ id: 'ok', line: 12 }),
      comment({ id: 'gone', line: 900 }),
    ]);
    const { carried, orphaned } = carryOver(d, files);
    expect(carried.map((c) => c.id)).toEqual(['ok']);
    expect(orphaned.map((c) => c.id)).toEqual(['gone']);
    expect(carried.length + orphaned.length).toBe(d.comments.length);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/core/store/review.test.ts`
Expected: FAIL — cannot resolve `store/review.js`.

- [ ] **Step 3: Implement**

`src/core/store/review.ts`:

```ts
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DiffFile } from '../diff/types.js';
import { findAnchorProblems } from '../review/anchors.js';
import type { ReviewDraft, StagedComment } from '../review/types.js';

export interface PersistedReview {
  version: 1;
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  draft: ReviewDraft;
  updatedAt: string;
}

export function stateRoot(): string {
  return join(homedir(), '.local', 'state', 'marrow', 'reviews');
}

export function stateKey(
  owner: string,
  repo: string,
  number: number,
  headSha: string,
): string {
  return `${owner}-${repo}-${number}-${headSha}`.replace(/\//g, '__');
}

/** Prefix identifying every persisted head for one pull request. */
function prPrefix(owner: string, repo: string, number: number): string {
  return `${owner}-${repo}-${number}-`.replace(/\//g, '__');
}

export class ReviewStore {
  constructor(private readonly rootDir: string = stateRoot()) {}

  private pathFor(key: string): string {
    return join(this.rootDir, `${key}.json`);
  }

  async load(
    owner: string,
    repo: string,
    number: number,
    headSha: string,
  ): Promise<PersistedReview | null> {
    try {
      const raw = await readFile(this.pathFor(stateKey(owner, repo, number, headSha)), 'utf8');
      const parsed = JSON.parse(raw) as PersistedReview;
      return parsed.version === 1 ? parsed : null;
    } catch {
      // Missing or corrupt: losing a draft is bad, but throwing here would make
      // the PR unopenable. Report nothing found and let the user start fresh.
      return null;
    }
  }

  async save(record: PersistedReview): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const target = this.pathFor(stateKey(record.owner, record.repo, record.number, record.headSha));
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(record), 'utf8');
    await rename(tmp, target);
  }

  /** Most recent saved draft for this PR at a DIFFERENT head sha. */
  async findPreviousHead(
    owner: string,
    repo: string,
    number: number,
    currentSha: string,
  ): Promise<PersistedReview | null> {
    let entries: string[];
    try {
      entries = await readdir(this.rootDir);
    } catch {
      return null;
    }

    const prefix = prPrefix(owner, repo, number);
    const current = `${stateKey(owner, repo, number, currentSha)}.json`;

    const candidates: PersistedReview[] = [];
    for (const entry of entries) {
      if (!entry.startsWith(prefix) || entry === current) continue;
      try {
        const parsed = JSON.parse(
          await readFile(join(this.rootDir, entry), 'utf8'),
        ) as PersistedReview;
        if (parsed.version === 1) candidates.push(parsed);
      } catch {
        // Skip unreadable records rather than failing the lookup.
      }
    }

    candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return candidates[0] ?? null;
  }

  async clear(owner: string, repo: string, number: number, headSha: string): Promise<void> {
    await rm(this.pathFor(stateKey(owner, repo, number, headSha)), { force: true });
  }
}

/**
 * Splits a previous draft's comments into those whose anchors still resolve
 * against the new diff and those that no longer do. Orphans are returned rather
 * than dropped so the user can re-place or discard them deliberately.
 */
export function carryOver(
  previous: ReviewDraft,
  files: DiffFile[],
): { carried: StagedComment[]; orphaned: StagedComment[] } {
  const problems = findAnchorProblems(previous, files);
  const bad = new Set(problems.map((p) => p.commentId));
  return {
    carried: previous.comments.filter((c) => !bad.has(c.id)),
    orphaned: previous.comments.filter((c) => bad.has(c.id)),
  };
}
```

- [ ] **Step 4: Verify**

Run: `bun test tests/core/store/review.test.ts && bun run typecheck && bun run lint:boundary`
Expected: 9 tests PASS; boundary clean (this file lives in core and must stay UI-free).

- [ ] **Step 5: Commit**

```bash
git add src/core/store tests/core/store
git commit -m "feat: persist review drafts and carry them across new commits"
```

---

### Task 7: PR list pane

**Files:**
- Create: `src/tui/components/PrList.tsx`
- Test: `tests/tui/prlist.test.tsx`

**Interfaces:**
- Consumes: `PullRequestSummary`, `PullFilter`; `Viewport`; `theme`.
- Produces: `<PrList prs={PullRequestSummary[]} cursor={number} scrollTop={number} height={number} filter={PullFilter} width={number} />`, `function filterLabel(filter: PullFilter): string`.

- [ ] **Step 1: Write the failing tests**

`tests/tui/prlist.test.tsx`:

```tsx
import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { PrList, filterLabel } from '../../src/tui/components/PrList.js';
import type { PullRequestSummary } from '../../src/core/github/types.js';

function pr(number: number, title: string, over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number, title, author: 'srtfisher', state: 'open', isDraft: false,
    headSha: 'abc', baseRef: 'main', headRef: 'feat/x',
    updatedAt: '2026-08-01T00:00:00Z', additions: 10, deletions: 2, changedFiles: 3,
    ...over,
  };
}

describe('filterLabel', () => {
  test('names each filter', () => {
    expect(filterLabel('open')).toBe('Open');
    expect(filterLabel('review-requested')).toBe('Needs my review');
    expect(filterLabel('all')).toBe('All');
  });
});

describe('PrList', () => {
  const prs = [pr(42, 'Fix rendering'), pr(43, 'Add caching')];

  test('renders numbers, titles, and authors', () => {
    const out = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={10} filter="open" width={40} />,
    );
    expect(out).toContain('#42');
    expect(out).toContain('Fix rendering');
    expect(out).toContain('srtfisher');
  });

  test('shows the active filter and the count', () => {
    const out = renderToString(
      <PrList prs={prs} cursor={0} scrollTop={0} height={10} filter="all" width={40} />,
    );
    expect(out).toContain('All');
    expect(out).toContain('2');
  });

  test('marks a draft pull request', () => {
    const out = renderToString(
      <PrList prs={[pr(44, 'WIP', { isDraft: true })]} cursor={0} scrollTop={0} height={10} filter="open" width={40} />,
    );
    expect(out.toLowerCase()).toContain('draft');
  });

  test('renders an explicit empty state rather than a blank pane', () => {
    const out = renderToString(
      <PrList prs={[]} cursor={0} scrollTop={0} height={10} filter="open" width={40} />,
    );
    expect(out.toLowerCase()).toContain('no pull requests');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/tui/prlist.test.tsx`
Expected: FAIL — cannot resolve `PrList.js`.

- [ ] **Step 3: Implement**

`src/tui/components/PrList.tsx`:

```tsx
import { Box, Text } from 'ink';
import type { PullFilter, PullRequestSummary } from '../../core/github/types.js';
import { Viewport } from '../Viewport.js';
import { theme } from '../theme.js';

export function filterLabel(filter: PullFilter): string {
  if (filter === 'open') return 'Open';
  if (filter === 'review-requested') return 'Needs my review';
  return 'All';
}

export interface PrListProps {
  prs: PullRequestSummary[];
  cursor: number;
  scrollTop: number;
  height: number;
  filter: PullFilter;
  width: number;
}

export function PrList({ prs, cursor, scrollTop, height, filter, width }: PrListProps) {
  if (prs.length === 0) {
    return (
      <Box flexDirection="column" width={width}>
        <Text color={theme.accent}>{filterLabel(filter)} · 0</Text>
        <Text color={theme.muted}>No pull requests.</Text>
      </Box>
    );
  }

  const items = prs.map((pr, i) => {
    const selected = i === cursor;
    return (
      <Text key={pr.number} inverse={selected} wrap="truncate">
        {`#${pr.number} ${pr.isDraft ? '[draft] ' : ''}${pr.title} — ${pr.author}`}
      </Text>
    );
  });

  return (
    <Box flexDirection="column" width={width}>
      <Text color={theme.accent}>
        {filterLabel(filter)} · {prs.length}
      </Text>
      <Viewport items={items} height={Math.max(0, height - 1)} cursor={cursor} scrollTop={scrollTop} />
    </Box>
  );
}
```

- [ ] **Step 4: Verify**

Run: `bun test tests/tui/prlist.test.tsx && bun run typecheck`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/components/PrList.tsx tests/tui/prlist.test.tsx
git commit -m "feat(tui): add the pull-request list pane"
```

---

### Task 8: Detail pane and status bar

**Files:**
- Create: `src/tui/components/Detail.tsx`, `src/tui/components/StatusBar.tsx`
- Test: `tests/tui/detail.test.tsx`

**Interfaces:**
- Consumes: `MeatResult`, `ReviewUnit`, `buildUnits`, `DiffLines`, `Viewport`, `PullRequestDetail`, `CheckRun`, `ReviewThread`.
- Produces:
  - `<Detail pr={PullRequestDetail} meat={MeatResult} units={ReviewUnit[]} cursor={number} scrollTop={number} height={number} checks={CheckRun[]} threads={ReviewThread[]} showThreads={boolean} />`
  - `<StatusBar repoLabel={string} prNumber={number} meat={MeatResult} stagedCount={number} model={string} worktreeOk={boolean} />`

- [ ] **Step 1: Write the failing tests**

`tests/tui/detail.test.tsx`:

```tsx
import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { Detail } from '../../src/tui/components/Detail.js';
import { StatusBar } from '../../src/tui/components/StatusBar.js';
import { buildUnits } from '../../src/tui/units.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import type { PullRequestDetail } from '../../src/core/github/types.js';

const pr: PullRequestDetail = {
  number: 42, title: 'Fix rendering', author: 'hazadus', state: 'open', isDraft: false,
  headSha: 'abc', baseRef: 'main', headRef: 'fix/render',
  updatedAt: '2026-08-01T00:00:00Z', additions: 106, deletions: 0, changedFiles: 3,
  body: 'Body text.', diff: '', viewerIsAuthor: false,
};

const meatFile: MeatFile = {
  file: {
    path: 'src/app.ts', oldPath: null, status: 'modified', similarity: null,
    hunks: [], additions: 1, deletions: 0,
  },
  dropped: null,
  hunks: [{
    hunk: {
      header: '@@ -1,1 +1,2 @@', section: '', oldStart: 1, oldLines: 1, newStart: 1, newLines: 2,
      lines: [{ kind: 'add', text: 'const x = 1;', oldLine: null, newLine: 1, noNewlineAtEof: false }],
    },
    keep: true, reason: 'introduces a new constant', source: 'model',
  }],
};

const meat: MeatResult = {
  summary: 'Adds a constant.', files: [meatFile],
  keptLines: 1, totalLines: 2, keptFiles: 1, totalFiles: 2,
};

const units = buildUnits(meat, { expandedFiles: new Set(), foldedFiles: new Set() });

describe('Detail', () => {
  test('shows the title, number, author, and branches', () => {
    const out = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={30}
        checks={[]} threads={[]} showThreads={false} />,
    );
    expect(out).toContain('Fix rendering');
    expect(out).toContain('#42');
    expect(out).toContain('hazadus');
    expect(out).toContain('main');
    expect(out).toContain('fix/render');
  });

  test('shows the meat summary and the kept counter', () => {
    const out = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={30}
        checks={[]} threads={[]} showThreads={false} />,
    );
    expect(out).toContain('Adds a constant.');
    expect(out).toContain('kept 1/2');
  });

  test('surfaces a failing check', () => {
    const out = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={30}
        checks={[{ name: 'unit-tests', status: 'completed', conclusion: 'failure', detailsUrl: null, output: null }]}
        threads={[]} showThreads={false} />,
    );
    expect(out).toContain('unit-tests');
  });

  test('hides threads until asked, then shows them', () => {
    const threads = [{
      path: 'src/app.ts', line: 1, isResolved: false, isOutdated: false,
      comments: [{ author: 'tqbf', body: 'Is this safe?', createdAt: 'now' }],
    }];
    const hidden = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={30}
        checks={[]} threads={threads} showThreads={false} />,
    );
    expect(hidden).not.toContain('Is this safe?');

    const shown = renderToString(
      <Detail pr={pr} meat={meat} units={units} cursor={0} scrollTop={0} height={30}
        checks={[]} threads={threads} showThreads />,
    );
    expect(shown).toContain('Is this safe?');
  });
});

describe('StatusBar', () => {
  test('shows repo, PR, counter, staged count, and model', () => {
    const out = renderToString(
      <StatusBar repoLabel="srtfisher/marrow" prNumber={42} meat={meat}
        stagedCount={3} model="opus" worktreeOk />,
    );
    expect(out).toContain('srtfisher/marrow');
    expect(out).toContain('#42');
    expect(out).toContain('kept 1/2');
    expect(out).toContain('3');
    expect(out).toContain('opus');
  });

  test('flags a missing worktree so degraded mode is visible', () => {
    const out = renderToString(
      <StatusBar repoLabel="r" prNumber={1} meat={meat} stagedCount={0} model="opus" worktreeOk={false} />,
    );
    expect(out.toLowerCase()).toContain('diff-only');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/tui/detail.test.tsx`
Expected: FAIL — cannot resolve `Detail.js`.

- [ ] **Step 3: Implement `StatusBar`**

`src/tui/components/StatusBar.tsx`:

```tsx
import { Text } from 'ink';
import type { MeatResult } from '../../core/meat/index.js';
import { theme } from '../theme.js';

export interface StatusBarProps {
  repoLabel: string;
  prNumber: number;
  meat: MeatResult;
  stagedCount: number;
  model: string;
  worktreeOk: boolean;
}

export function StatusBar({
  repoLabel, prNumber, meat, stagedCount, model, worktreeOk,
}: StatusBarProps) {
  const parts = [
    `${repoLabel}#${prNumber}`,
    `kept ${meat.keptLines}/${meat.totalLines}`,
    `${stagedCount} staged`,
    model,
    worktreeOk ? 'worktree ok' : 'diff-only',
  ];
  return <Text color={theme.muted}>{parts.join(' · ')}</Text>;
}
```

- [ ] **Step 4: Implement `Detail`**

`src/tui/components/Detail.tsx`:

```tsx
import { Box, Text } from 'ink';
import type { CheckRun, PullRequestDetail, ReviewThread } from '../../core/github/types.js';
import type { MeatResult } from '../../core/meat/index.js';
import type { ReviewUnit } from '../units.js';
import { DiffLines } from './DiffLines.js';
import { Viewport } from '../Viewport.js';
import { theme } from '../theme.js';

export interface DetailProps {
  pr: PullRequestDetail;
  meat: MeatResult;
  units: ReviewUnit[];
  cursor: number;
  scrollTop: number;
  height: number;
  checks: CheckRun[];
  threads: ReviewThread[];
  showThreads: boolean;
}

function renderUnit(unit: ReviewUnit, selected: boolean, threads: ReviewThread[], showThreads: boolean) {
  if (unit.kind === 'file-header') {
    const dropped = unit.file.dropped;
    return (
      <Text key={unit.index} inverse={selected} color={theme.heading}>
        {`── ${unit.file.file.path}${dropped ? `  (dropped: ${dropped.rule})` : ''}`}
      </Text>
    );
  }

  if (unit.kind === 'dropped-summary') {
    return (
      <Text key={unit.index} inverse={selected} color={theme.dropped}>
        {`   ${unit.count} hunk(s) dropped — press z to reveal`}
      </Text>
    );
  }

  const matching = showThreads
    ? threads.filter((t) => t.path === unit.file.file.path)
    : [];

  return (
    <Box key={unit.index} flexDirection="column">
      <Text inverse={selected} color={theme.muted}>
        {`   ${unit.hunk.hunk.header}  [${unit.hunk.reason}]`}
      </Text>
      <DiffLines hunk={unit.hunk.hunk} gutterWidth={4} />
      {matching.map((thread, i) =>
        thread.comments.map((c, j) => (
          <Text key={`${i}-${j}`} color={theme.accent}>
            {`   💬 ${c.author}: ${c.body}`}
          </Text>
        )),
      )}
    </Box>
  );
}

export function Detail({
  pr, meat, units, cursor, scrollTop, height, checks, threads, showThreads,
}: DetailProps) {
  const failing = checks.filter((c) => c.conclusion === 'failure');
  const items = units.map((u) => renderUnit(u, u.index === cursor, threads, showThreads));

  return (
    <Box flexDirection="column">
      <Text color={theme.heading}>
        {pr.title} <Text color={theme.muted}>#{pr.number}</Text>
      </Text>
      <Text color={theme.muted}>
        {pr.author} · {pr.baseRef} ← {pr.headRef}
      </Text>
      {failing.length > 0 && (
        <Text color={theme.danger}>failing: {failing.map((c) => c.name).join(', ')}</Text>
      )}
      {meat.summary.length > 0 && <Text>{meat.summary}</Text>}
      <Text color={theme.accent}>
        {`kept ${meat.keptLines}/${meat.totalLines} lines in ${meat.keptFiles}/${meat.totalFiles} files`}
      </Text>
      <Viewport items={items} height={Math.max(0, height - 5)} cursor={cursor} scrollTop={scrollTop} />
    </Box>
  );
}
```

- [ ] **Step 5: Verify**

Run: `bun test tests/tui/detail.test.tsx && bun run typecheck && bun run lint:boundary`
Expected: 6 tests PASS; boundary clean.

- [ ] **Step 6: Commit**

```bash
git add src/tui/components/Detail.tsx src/tui/components/StatusBar.tsx tests/tui/detail.test.tsx
git commit -m "feat(tui): add the detail pane and status bar"
```

---

### Task 9: `$EDITOR` handoff and the comment editor

**Files:**
- Create: `src/tui/editor.ts`, `src/tui/components/CommentEditor.tsx`
- Test: `tests/tui/editor.test.ts`

**Interfaces:**
- Produces:
  - `function resolveEditor(env: NodeJS.ProcessEnv): string`
  - `interface EditorRunner { (command: string, args: string[]): Promise<number> }`
  - `function editInEditor(initial: string, opts: { env?: NodeJS.ProcessEnv; run?: EditorRunner; tmpDir?: string }): Promise<string>`
  - `<CommentEditor initial={string} onSubmit={(body: string) => void} onCancel={() => void} isSuggestion={boolean} />`

**Design note:** `editInEditor` writes the body to a temp file, hands it to the editor with inherited stdio, and reads it back. The Ink raw-mode suspend/resume is the caller's job via `useStdin().setRawMode` — keeping it out of this function is what makes the function testable with a fake runner.

- [ ] **Step 1: Write the failing tests**

`tests/tui/editor.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editInEditor, resolveEditor } from '../../src/tui/editor.js';

describe('resolveEditor', () => {
  test('prefers VISUAL over EDITOR', () => {
    expect(resolveEditor({ VISUAL: 'code -w', EDITOR: 'vim' })).toBe('code -w');
  });

  test('falls back to EDITOR, then to vi', () => {
    expect(resolveEditor({ EDITOR: 'nano' })).toBe('nano');
    expect(resolveEditor({})).toBe('vi');
  });
});

describe('editInEditor', () => {
  test('round-trips content the editor rewrote', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-ed-'));
    try {
      const run = async (_cmd: string, args: string[]) => {
        const file = args[args.length - 1]!;
        await Bun.write(file, 'edited body\n');
        return 0;
      };
      const out = await editInEditor('initial', { env: { EDITOR: 'fake' }, run, tmpDir: dir });
      expect(out).toBe('edited body');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('passes the initial content into the temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-ed-'));
    try {
      let seen = '';
      const run = async (_cmd: string, args: string[]) => {
        seen = await readFile(args[args.length - 1]!, 'utf8');
        return 0;
      };
      await editInEditor('seed text', { env: { EDITOR: 'fake' }, run, tmpDir: dir });
      expect(seen).toBe('seed text');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a non-zero editor exit preserves the original body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-ed-'));
    try {
      const run = async (_cmd: string, args: string[]) => {
        await Bun.write(args[args.length - 1]!, 'garbage');
        return 1;
      };
      const out = await editInEditor('keep me', { env: { EDITOR: 'fake' }, run, tmpDir: dir });
      expect(out).toBe('keep me');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('splits a multi-word editor command into command and args', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-ed-'));
    try {
      let cmd = '';
      let args: string[] = [];
      const run = async (c: string, a: string[]) => {
        cmd = c; args = a;
        await Bun.write(a[a.length - 1]!, 'x');
        return 0;
      };
      await editInEditor('', { env: { VISUAL: 'code -w' }, run, tmpDir: dir });
      expect(cmd).toBe('code');
      expect(args[0]).toBe('-w');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/tui/editor.test.ts`
Expected: FAIL — cannot resolve `editor.js`.

- [ ] **Step 3: Implement the editor handoff**

`src/tui/editor.ts`:

```ts
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function resolveEditor(env: NodeJS.ProcessEnv): string {
  return env.VISUAL?.trim() || env.EDITOR?.trim() || 'vi';
}

export interface EditorRunner {
  (command: string, args: string[]): Promise<number>;
}

const defaultRunner: EditorRunner = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });

export interface EditOptions {
  env?: NodeJS.ProcessEnv;
  run?: EditorRunner;
  tmpDir?: string;
}

/**
 * Opens `initial` in the user's editor and returns what they saved.
 *
 * A non-zero exit is treated as "cancelled": the original text is returned
 * untouched rather than whatever half-written state the file was left in.
 * Raw-mode suspend/resume belongs to the Ink caller, not here — keeping it out
 * is what lets this be tested with a fake runner.
 */
export async function editInEditor(
  initial: string,
  opts: EditOptions = {},
): Promise<string> {
  const env = opts.env ?? process.env;
  const run = opts.run ?? defaultRunner;
  const dir = opts.tmpDir ?? (await mkdtemp(join(tmpdir(), 'marrow-')));
  const file = join(dir, 'COMMENT_EDITMSG.md');

  await writeFile(file, initial, 'utf8');

  const [command, ...args] = resolveEditor(env).split(/\s+/);
  const code = await run(command ?? 'vi', [...args, file]);

  if (code !== 0) {
    if (!opts.tmpDir) await rm(dir, { recursive: true, force: true });
    return initial;
  }

  const edited = (await readFile(file, 'utf8')).replace(/\n+$/, '');
  if (!opts.tmpDir) await rm(dir, { recursive: true, force: true });
  return edited;
}
```

- [ ] **Step 4: Implement the inline editor component**

`src/tui/components/CommentEditor.tsx`:

```tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from '../theme.js';

export interface CommentEditorProps {
  initial: string;
  isSuggestion: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

export function CommentEditor({ initial, isSuggestion, onSubmit, onCancel }: CommentEditorProps) {
  const [value, setValue] = useState(initial);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column">
      <Text color={theme.accent}>
        {isSuggestion ? 'Suggestion' : 'Comment'} — enter to save, esc to cancel
      </Text>
      <TextInput value={value} onChange={setValue} onSubmit={() => onSubmit(value)} />
    </Box>
  );
}
```

Add the dependency: `bun add ink-text-input@6.0.0`

- [ ] **Step 5: Verify**

Run: `bun test tests/tui/editor.test.ts && bun run typecheck`
Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/tui/editor.ts src/tui/components/CommentEditor.tsx tests/tui/editor.test.ts
git commit -m "feat(tui): add \$EDITOR handoff and the inline comment editor"
```

---

### Task 10: Submit screen

**Files:**
- Create: `src/tui/components/SubmitScreen.tsx`
- Test: `tests/tui/submit.test.tsx`

**Interfaces:**
- Consumes: `ReviewDraft`, `Verdict`, `findAnchorProblems`, `demoteUnanchorable`, `DiffFile`.
- Produces: `<SubmitScreen draft={ReviewDraft} files={DiffFile[]} viewerIsAuthor={boolean} selected={Verdict} onSelect={(v: Verdict) => void} onConfirm={() => void} onCancel={() => void} />`

**Design note:** approval is disabled when the viewer is the PR author, because GitHub rejects it — the screen states the reason rather than letting the user discover it at submit time. Unanchorable comments are shown as a count with an explanation that they will be moved into the review body.

- [ ] **Step 1: Write the failing tests**

`tests/tui/submit.test.tsx`:

```tsx
import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { SubmitScreen } from '../../src/tui/components/SubmitScreen.js';
import { parseUnifiedDiff } from '../../src/core/diff/parse.js';
import type { ReviewDraft, StagedComment } from '../../src/core/review/types.js';

const files = parseUnifiedDiff(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 keep
+added
`);

function comment(over: Partial<StagedComment> = {}): StagedComment {
  return {
    id: 'c1', path: 'a.ts', line: 2, side: 'RIGHT', startLine: null,
    body: 'note', suggestion: null, ...over,
  };
}

const draft = (comments: StagedComment[]): ReviewDraft =>
  ({ verdict: 'COMMENT', body: 'Overall fine.', comments });

const noop = () => {};

describe('SubmitScreen', () => {
  test('lists the three verdicts and the staged comment count', () => {
    const out = renderToString(
      <SubmitScreen draft={draft([comment()])} files={files} viewerIsAuthor={false}
        selected="COMMENT" onSelect={noop} onConfirm={noop} onCancel={noop} />,
    );
    expect(out.toLowerCase()).toContain('approve');
    expect(out.toLowerCase()).toContain('request changes');
    expect(out.toLowerCase()).toContain('comment');
    expect(out).toContain('1');
  });

  test('disables approve with a reason when the viewer is the author', () => {
    const out = renderToString(
      <SubmitScreen draft={draft([])} files={files} viewerIsAuthor
        selected="COMMENT" onSelect={noop} onConfirm={noop} onCancel={noop} />,
    );
    expect(out.toLowerCase()).toContain('cannot approve your own');
  });

  test('warns that unanchorable comments move into the body', () => {
    const out = renderToString(
      <SubmitScreen draft={draft([comment({ id: 'bad', line: 999 })])} files={files}
        viewerIsAuthor={false} selected="COMMENT" onSelect={noop} onConfirm={noop} onCancel={noop} />,
    );
    expect(out.toLowerCase()).toContain('review body');
  });

  test('shows the review body text', () => {
    const out = renderToString(
      <SubmitScreen draft={draft([])} files={files} viewerIsAuthor={false}
        selected="APPROVE" onSelect={noop} onConfirm={noop} onCancel={noop} />,
    );
    expect(out).toContain('Overall fine.');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/tui/submit.test.tsx`
Expected: FAIL — cannot resolve `SubmitScreen.js`.

- [ ] **Step 3: Implement**

`src/tui/components/SubmitScreen.tsx`:

```tsx
import { Box, Text } from 'ink';
import type { DiffFile } from '../../core/diff/types.js';
import { findAnchorProblems } from '../../core/review/anchors.js';
import type { ReviewDraft, Verdict } from '../../core/review/types.js';
import { theme } from '../theme.js';

export interface SubmitScreenProps {
  draft: ReviewDraft;
  files: DiffFile[];
  viewerIsAuthor: boolean;
  selected: Verdict;
  onSelect: (verdict: Verdict) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const LABELS: Array<{ verdict: Verdict; label: string }> = [
  { verdict: 'APPROVE', label: 'Approve' },
  { verdict: 'REQUEST_CHANGES', label: 'Request changes' },
  { verdict: 'COMMENT', label: 'Comment' },
];

export function SubmitScreen({
  draft, files, viewerIsAuthor, selected,
}: SubmitScreenProps) {
  const problems = findAnchorProblems(draft, files);

  return (
    <Box flexDirection="column">
      <Text color={theme.heading}>Submit review</Text>

      {LABELS.map(({ verdict, label }) => {
        const blocked = verdict === 'APPROVE' && viewerIsAuthor;
        return (
          <Text key={verdict} inverse={verdict === selected} color={blocked ? theme.muted : undefined}>
            {`  ${label}${blocked ? '  (GitHub does not let you approve your own pull request)' : ''}`}
          </Text>
        );
      })}

      <Text> </Text>
      <Text color={theme.accent}>{draft.comments.length} inline comment(s)</Text>

      {problems.length > 0 && (
        <Text color={theme.danger}>
          {`${problems.length} comment(s) cannot anchor to the diff and will be moved into the review body.`}
        </Text>
      )}

      {draft.body.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted}>Review body:</Text>
          <Text>{draft.body}</Text>
        </Box>
      )}

      <Text color={theme.muted}>enter to submit · esc to go back</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Verify**

Run: `bun test tests/tui/submit.test.tsx && bun run typecheck && bun run lint:boundary`
Expected: 4 tests PASS; boundary clean.

- [ ] **Step 5: Commit**

```bash
git add src/tui/components/SubmitScreen.tsx tests/tui/submit.test.tsx
git commit -m "feat(tui): add the submit screen with author and anchor guards"
```

---

### Task 11: Wire the app together and launch it from the CLI

**Files:**
- Modify: `src/tui/App.tsx`, `src/cli.ts`
- Create: `src/tui/components/Help.tsx`
- Test: `tests/tui/app.test.tsx`

**Interfaces:**
- Produces: `<App {...AppProps}/>` driving mode, cursor, scroll, folds, and staged comments; `<Help/>` generated from `KEY_HELP`; `marrow` with no `--dry-run` renders the TUI.

- [ ] **Step 1: Write the failing tests**

`tests/tui/app.test.tsx`:

```tsx
import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { Help } from '../../src/tui/components/Help.js';
import { KEY_HELP } from '../../src/tui/keymap.js';

describe('Help', () => {
  test('documents every keymap entry', () => {
    const out = renderToString(<Help />);
    for (const entry of KEY_HELP) {
      expect(out).toContain(entry.keys);
    }
  });

  test('cannot drift from the keymap because it is generated from it', () => {
    const out = renderToString(<Help />);
    expect(out).toContain('open the submit screen');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/tui/app.test.tsx`
Expected: FAIL — cannot resolve `Help.js`.

- [ ] **Step 3: Implement Help**

`src/tui/components/Help.tsx`:

```tsx
import { Box, Text } from 'ink';
import { KEY_HELP } from '../keymap.js';
import { theme } from '../theme.js';

export function Help() {
  const width = Math.max(...KEY_HELP.map((e) => e.keys.length));
  return (
    <Box flexDirection="column">
      <Text color={theme.heading}>Keys</Text>
      {KEY_HELP.map((entry) => (
        <Text key={entry.keys}>
          {`  ${entry.keys.padEnd(width, ' ')}  `}
          <Text color={theme.muted}>{entry.description}</Text>
        </Text>
      ))}
      <Text color={theme.muted}>esc to close</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Rewrite `App.tsx` as the state machine**

Replace `src/tui/App.tsx` entirely. It owns: `mode`, `cursor`, `scrollTop`, `expandedFiles`, `foldedFiles`, `showThreads`, `draft`, and the selected verdict. It calls `resolveAction` from `useInput`, applies the returned `Action`, and recomputes `scrollTop` with `nextScrollTop` after any cursor move.

```tsx
import { useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import type { CheckRun, PullRequestDetail, PullRequestSummary, ReviewThread } from '../core/github/types.js';
import type { MeatResult } from '../core/meat/index.js';
import type { ReviewDraft, Verdict } from '../core/review/types.js';
import { buildUnits, nextFileIndex, prevFileIndex } from './units.js';
import { nextScrollTop } from './viewport.js';
import { resolveAction, type Mode } from './keymap.js';
import { Detail } from './components/Detail.js';
import { PrList } from './components/PrList.js';
import { StatusBar } from './components/StatusBar.js';
import { SubmitScreen } from './components/SubmitScreen.js';
import { Help } from './components/Help.js';
import { theme } from './theme.js';

export interface AppProps {
  repoLabel: string;
  prs: PullRequestSummary[];
  pr: PullRequestDetail | null;
  meat: MeatResult | null;
  checks: CheckRun[];
  threads: ReviewThread[];
  model: string;
  worktreeOk: boolean;
  onOpenPr: (number: number) => void;
  onSubmit: (draft: ReviewDraft, verdict: Verdict) => void;
}

export function App(props: AppProps) {
  const { exit } = useApp();
  const size = useWindowSize();
  const [mode, setMode] = useState<Mode>(props.pr ? 'detail' : 'list');
  const [cursor, setCursor] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [expandedFiles, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [foldedFiles, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [showThreads, setShowThreads] = useState(false);
  const [draft, setDraft] = useState<ReviewDraft>({ verdict: null, body: '', comments: [] });
  const [verdict, setVerdict] = useState<Verdict>('COMMENT');

  const units = useMemo(
    () => (props.meat ? buildUnits(props.meat, { expandedFiles, foldedFiles }) : []),
    [props.meat, expandedFiles, foldedFiles],
  );

  const bodyHeight = Math.max(1, size.height - 2);
  const total = mode === 'list' ? props.prs.length : units.length;

  function moveTo(next: number) {
    const clamped = Math.min(Math.max(next, 0), Math.max(0, total - 1));
    setCursor(clamped);
    setScrollTop((prev) => nextScrollTop(total, bodyHeight, clamped, prev));
  }

  function currentPath(): string | null {
    const unit = units[cursor];
    return unit ? unit.file.file.path : null;
  }

  function toggleIn(set: ReadonlySet<string>, path: string): ReadonlySet<string> {
    const next = new Set(set);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  }

  useInput((input, key) => {
    const action = resolveAction(input, key, mode);
    if (!action) return;

    switch (action.type) {
      case 'move': return moveTo(cursor + action.delta);
      case 'half-page': return moveTo(cursor + action.dir * Math.floor(bodyHeight / 2));
      case 'file':
        return moveTo(
          action.dir === 1 ? nextFileIndex(units, cursor) : prevFileIndex(units, cursor),
        );
      case 'open': {
        const selected = props.prs[cursor];
        if (selected) props.onOpenPr(selected.number);
        return;
      }
      case 'toggle-fold': {
        const path = currentPath();
        if (path) setFolded((s) => toggleIn(s, path));
        return;
      }
      case 'toggle-dropped': {
        const path = currentPath();
        if (path) setExpanded((s) => toggleIn(s, path));
        return;
      }
      case 'toggle-dropped-all': {
        const all = props.meat?.files.map((f) => f.file.path) ?? [];
        setExpanded((s) => (s.size === all.length ? new Set() : new Set(all)));
        return;
      }
      case 'toggle-threads': return setShowThreads((v) => !v);
      case 'submit-screen': return setMode('submit');
      case 'help': return setMode('help');
      case 'back': return setMode(props.pr ? 'detail' : 'list');
      case 'quit': return exit();
      default: return;
    }
  });

  if (mode === 'help') return <Help />;

  if (mode === 'submit' && props.pr && props.meat) {
    return (
      <SubmitScreen
        draft={draft}
        files={props.meat.files.map((f) => f.file)}
        viewerIsAuthor={props.pr.viewerIsAuthor}
        selected={verdict}
        onSelect={setVerdict}
        onConfirm={() => props.onSubmit(draft, verdict)}
        onCancel={() => setMode('detail')}
      />
    );
  }

  return (
    <Box flexDirection="column" height={size.height}>
      <Box flexGrow={1}>
        <PrList
          prs={props.prs}
          cursor={mode === 'list' ? cursor : -1}
          scrollTop={mode === 'list' ? scrollTop : 0}
          height={bodyHeight}
          filter="open"
          width={34}
        />
        <Box flexDirection="column" flexGrow={1} marginLeft={1}>
          {props.pr && props.meat ? (
            <Detail
              pr={props.pr}
              meat={props.meat}
              units={units}
              cursor={cursor}
              scrollTop={scrollTop}
              height={bodyHeight}
              checks={props.checks}
              threads={props.threads}
              showThreads={showThreads}
            />
          ) : (
            <Text color={theme.muted}>Select a pull request and press enter.</Text>
          )}
        </Box>
      </Box>
      {props.pr && props.meat && (
        <StatusBar
          repoLabel={props.repoLabel}
          prNumber={props.pr.number}
          meat={props.meat}
          stagedCount={draft.comments.length}
          model={props.model}
          worktreeOk={props.worktreeOk}
        />
      )}
    </Box>
  );
}
```

- [ ] **Step 5: Launch the TUI from the CLI**

In `src/cli.ts`, keep the existing `--dry-run` and `--help` paths exactly as they are. When neither is set, `render(<App … />)` from `ink` instead of writing to stdout, passing the data already fetched. Keep every stderr degraded-mode note.

`src/cli.ts` must be renamed to `src/cli.tsx` for JSX, and `package.json`'s `bin` still points at `dist/cli.js` (tsc emits `.js` from `.tsx`).

- [ ] **Step 6: Verify**

Run: `bun test && bun run typecheck && bun run lint:boundary && bun run build`
Expected: all tests PASS; boundary clean; build emits `dist/cli.js`.

- [ ] **Step 7: Smoke-test interactively**

From a clone with a `github.com` origin and at least one open PR:

```bash
node dist/cli.js            # two-pane list renders; j/k moves; enter opens; ? shows help; q quits
node dist/cli.js --dry-run 42   # unchanged stdout behavior
```

Confirm: the list renders and scrolls, `?` lists every binding, `q` exits cleanly and restores the terminal, and `--dry-run` still prints text.

- [ ] **Step 8: Commit**

```bash
git add src/tui src/cli.tsx tests/tui package.json
git rm src/cli.ts
git commit -m "feat(tui): wire the two-pane app and launch it from the CLI"
```

---

## Plan 2 self-review

**Spec coverage.** Two-pane layout → Tasks 7, 8, 11. Viewport → Task 2. Review units and the single-cursor model → Task 3. Keymap including `!`-for-submit → Task 4. Diff rendering → Task 5. Resume and new-commit carry-over → Task 6. `$EDITOR` → Task 9. Submit with author and anchor guards → Task 10. Status bar → Task 8. Help overlay → Task 11.

**Deferred with intent, not overlooked.** Syntax highlighting (stated at the top with reasons). AI findings, verify, and chat — Plan 3. Cross-repo inbox, thread replies, editing submitted comments — out of scope per the spec. `--filter review-requested` still resolves to `open` until the inbox work lands; the list pane labels it "Needs my review" but the query is unchanged, which is a known and recorded gap.

**Type consistency.** `Mode` and `Action` are defined once in `keymap.ts` and consumed by `App.tsx`. `ReviewUnit` is defined in `units.ts` and consumed by `Detail.tsx` and `App.tsx`. `theme` is the only source of colors. `KeyLike` is a structural subset of Ink's `Key`, so `keymap.ts` stays Ink-free and directly unit-testable.

**Known risk.** Task 11 is the largest task and the only one whose verification is partly interactive; if it proves too big in practice, the natural split is Help + `App` state machine as one task and the `cli.tsx` wiring as another.
