# Full-Screen Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 32-column sidebar with a full-screen search-first PR picker, keep a left review warm and returnable, confirm every `esc` out of a review, and give startup a launch screen plus a persistent one-row app chrome.

**Architecture:** All work is in `src/tui/**` plus `src/cli.tsx` wiring; `src/core` is untouched. New pure layout modules (`picker.ts`, `chrome.ts`) follow the house rule that the renderer and the scroll/hit math read the same functions. The `list` and `search` modes collapse into one `picker` mode whose printable keys are all search input. Spec: `docs/superpowers/specs/2026-08-06-fullscreen-picker-design.md` — read it before starting any task.

**Tech Stack:** TypeScript (strict + `noUncheckedIndexedAccess`), Ink 5, React, `bun:test`. ESM with explicit `.js` extensions on every relative import, including from `.ts` files.

## Global Constraints

- Run `bun test`, `bun run typecheck`, `bun run lint:boundary` before every commit. Every commit must pass all three.
- `noUncheckedIndexedAccess` is on: `arr[i]` is `T | undefined` in `src/`; handle it. In tests, `!` after a lookup is idiomatic.
- Never hit the network or a model in a test.
- Test names are sentences about behaviour ("the banner drops whole when three entries no longer fit"), not "should" statements.
- Comments say **why**, not what — record the judgement and what would break without it. No comments that restate code.
- No `┌─┐` boxes, no reverse-video selection, no emoji. Selection is `❯ ` in `theme.color.structure` plus bold. No row may Ink-wrap — everything truncates; the picker's two-row titles are *computed* rows, wrapped by the pure module.
- Colors come from `src/tui/theme.ts` ANSI slots, never hex.
- This work happens in an isolated worktree (another session is active in the main checkout). Branch: `fullscreen-picker` from `main`.

## File Structure

| File | Fate | Responsibility |
|---|---|---|
| `src/tui/wordmark.ts` | create | `WORDMARK`, `WORDMARK_COLS`, `TAGLINE` — shared by Launch and PrPicker |
| `src/tui/picker.ts` | create | Pure layout: title wrap, entry heights, banner fit, variable-height scroll/window, hit test, filter cycle |
| `src/tui/chrome.ts` | create | Pure: the chrome row's left/right segments fitted to a width |
| `src/tui/components/Launch.tsx` | create | Centered launch frame: banner + repo + a body slot (spinner / error / LoadingSteps) |
| `src/tui/components/PrPicker.tsx` | create | The full-screen picker: banner, filter line, entries, indicator |
| `src/tui/keymap.ts` | modify | `Mode` union: `list`/`search` → `picker`; drop `search`/`filter` actions; rewrite the `list` KEY_HELP group |
| `src/tui/hints.ts` | modify | `listHints()` → `pickerHints(warmPrNumber)` |
| `src/tui/App.tsx` | modify | Mode collapse, picker input handler, full-screen render, chrome, warm door, leave confirm |
| `src/cli.tsx` | modify | Render before the list fetch; `prs` tri-state; `listError`; retry |
| `src/tui/components/PrList.tsx`, `Welcome.tsx` | delete (Task 9) | Superseded |
| `src/tui/hittest.ts` | modify (Task 9) | Delete `hitList` + `ListGeometry` |
| `src/tui/theme.ts` | modify (Task 9) | Delete `layout.sidebarWidth` |

---

### Task 1: `wordmark.ts` and the `picker.ts` pure module

**Files:**
- Create: `src/tui/wordmark.ts`
- Create: `src/tui/picker.ts`
- Test: `tests/tui/picker.test.ts`
- Modify: `src/tui/components/Welcome.tsx` (import the wordmark from its new home so it is defined once)

**Interfaces:**
- Consumes: `PullRequestSummary`, `PullFilter` from `src/core/github/types.js`.
- Produces (later tasks call these exactly as written):

```ts
// wordmark.ts
export const WORDMARK: readonly string[];      // moved verbatim from Welcome.tsx:43-47
export const WORDMARK_COLS: number;            // max row length
export const TAGLINE: string;                  // 'a large diff, abridged to what carries meaning'

// picker.ts
export const MAX_TITLE_ROWS = 2;
export interface PickerEntry {
  pr: PullRequestSummary;
  titleLines: string[];   // 1..MAX_TITLE_ROWS; last line ends in '…' when the title was cut
  height: number;         // titleLines.length + 1 meta row + 1 trailing blank
}
export function wrapTitle(text: string, width: number, maxLines: number): string[];
export function buildEntries(prs: PullRequestSummary[], width: number): PickerEntry[];
export interface PickerLayout { banner: boolean; headerRows: number; entryRows: number }
export function layoutPicker(height: number, width: number): PickerLayout;
export function pickerScroll(heights: number[], viewRows: number, cursor: number, scrollTop: number): number;
export function pickerWindow(heights: number[], viewRows: number, scrollTop: number): { start: number; end: number };
export interface PickerGeometry { headerRows: number; heights: number[]; scrollTop: number; viewRows: number }
export function hitPicker(geometry: PickerGeometry, row: number): number | null;
export function nextFilter(filter: PullFilter): PullFilter;
```

- [ ] **Step 1: Create `src/tui/wordmark.ts`**

Move `WORDMARK` (with its full doc comment about the 6×31 bitmap — that comment is load-bearing history), `WORDMARK_COLS`, and `TAGLINE` out of `src/tui/components/Welcome.tsx` into the new file, exporting all three. Update `Welcome.tsx` to import them (`import { TAGLINE, WORDMARK, WORDMARK_COLS } from '../wordmark.js';`) and delete its local copies. Run `bun test tests/tui/ && bun run typecheck` — green, nothing behavioural changed.

- [ ] **Step 2: Write the failing tests**

Create `tests/tui/picker.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import {
  buildEntries, hitPicker, layoutPicker, nextFilter, pickerScroll, pickerWindow, wrapTitle,
} from '../../src/tui/picker.js';
import type { PullRequestSummary } from '../../src/core/github/types.js';

function summary(number: number, title: string): PullRequestSummary {
  return {
    number, title, author: 'octocat', state: 'open', isDraft: false,
    headSha: 'abc', baseRef: 'main', headRef: 'feat/x',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

describe('wrapTitle', () => {
  test('a title that fits stays on one line', () => {
    expect(wrapTitle('Short title', 40, 2)).toEqual(['Short title']);
  });

  test('breaks at a word boundary, never mid-word', () => {
    expect(wrapTitle('Resolve settings pages from packages', 20, 2))
      .toEqual(['Resolve settings', 'pages from packages']);
  });

  test('a third row truncates the second with an ellipsis', () => {
    const lines = wrapTitle('one two three four five six seven eight nine ten', 12, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(lines[1]!.length).toBeLessThanOrEqual(12);
  });

  test('a single word longer than the width hard-breaks rather than overflowing', () => {
    const lines = wrapTitle('supercalifragilisticexpialidocious', 10, 2);
    expect(lines[0]!.length).toBeLessThanOrEqual(10);
  });
});

describe('buildEntries', () => {
  test('a one-line title makes a 3-row entry; a two-line title makes 4', () => {
    const short = buildEntries([summary(1, 'Tiny')], 80)[0]!;
    expect(short.height).toBe(3);
    const long = buildEntries(
      [summary(2, 'A very long pull request title that cannot possibly fit on one row here')],
      40,
    )[0]!;
    expect(long.titleLines).toHaveLength(2);
    expect(long.height).toBe(4);
  });

  test('the first title line carries the number, and a draft its marker', () => {
    const entries = buildEntries(
      [{ ...summary(7, 'Something'), isDraft: true }], 80,
    );
    expect(entries[0]!.titleLines[0]).toBe('#7 [draft] Something');
  });
});

describe('layoutPicker', () => {
  // Banner block 5 rows (3 wordmark + tagline + blank), filter block 2
  // (input + blank), indicator 1 — so 8 rows of chrome with the banner up.
  test('a tall wide terminal shows the banner', () => {
    const layout = layoutPicker(30, 80);
    expect(layout.banner).toBe(true);
    expect(layout.headerRows).toBe(7);
    expect(layout.entryRows).toBe(30 - 7 - 1);
  });

  test('the banner drops whole when three minimum entries no longer fit beside it', () => {
    // 3 entries × 3 rows = 9; with banner the chrome is 8, so height 16 fails.
    const layout = layoutPicker(16, 80);
    expect(layout.banner).toBe(false);
    expect(layout.headerRows).toBe(2);
  });

  test('a terminal too narrow for the wordmark drops the banner regardless of height', () => {
    expect(layoutPicker(40, 30).banner).toBe(false);
  });
});

describe('pickerScroll and pickerWindow', () => {
  const heights = [3, 4, 3, 4, 3, 3];

  test('the window fills greedily and stops before overflowing', () => {
    expect(pickerWindow(heights, 10, 0)).toEqual({ start: 0, end: 3 });
  });

  test('at least one entry shows even when taller than the viewport', () => {
    expect(pickerWindow([5], 3, 0)).toEqual({ start: 0, end: 1 });
  });

  test('moving the cursor above the window pulls the window up', () => {
    expect(pickerScroll(heights, 10, 1, 3)).toBe(1);
  });

  test('moving the cursor below the window scrolls just far enough to show it whole', () => {
    // Cursor on entry 3 (4 rows): entries 1..3 sum to 11 > 10, 2..3 sum to 7.
    expect(pickerScroll(heights, 10, 3, 0)).toBe(2);
  });
});

describe('hitPicker', () => {
  const geometry = { headerRows: 7, heights: [3, 4, 3], scrollTop: 0, viewRows: 12 };

  test('a click on a title or meta row resolves to that entry', () => {
    expect(hitPicker(geometry, 7)).toBe(0);  // entry 0 title
    expect(hitPicker(geometry, 8)).toBe(0);  // entry 0 meta
    expect(hitPicker(geometry, 10)).toBe(1); // entry 1 first title row
  });

  test('a click on the blank separator resolves to no entry', () => {
    expect(hitPicker(geometry, 9)).toBe(null);  // entry 0 trailing blank
  });

  test('a click in the header or past the last entry is not a hit', () => {
    expect(hitPicker(geometry, 3)).toBe(null);
    expect(hitPicker(geometry, 18)).toBe(null);
  });

  test('a click respects the scroll offset', () => {
    expect(hitPicker({ ...geometry, scrollTop: 1 }, 7)).toBe(1);
  });
});

describe('nextFilter', () => {
  test('cycles open → review-requested → all → open', () => {
    expect(nextFilter('open')).toBe('review-requested');
    expect(nextFilter('review-requested')).toBe('all');
    expect(nextFilter('all')).toBe('open');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test tests/tui/picker.test.ts`
Expected: FAIL — module `src/tui/picker.js` not found.

- [ ] **Step 4: Implement `src/tui/picker.ts`**

```ts
import type { PullFilter, PullRequestSummary } from '../core/github/types.js';
import { WORDMARK, WORDMARK_COLS } from './wordmark.js';

/**
 * Two rows, then the ellipsis. Unreadable titles were the complaint that
 * killed the sidebar; unbounded ones would make the list unscannable in the
 * other direction — a title that needs three rows is a title being read, not
 * chosen from.
 */
export const MAX_TITLE_ROWS = 2;

/** Marker column (2) plus the continuation indent the renderer uses. */
const TITLE_INDENT = 6;

/** Banner block: the three wordmark rows, the tagline, a blank under them. */
const BANNER_ROWS = WORDMARK.length + 2;
/** The filter input line and the blank row under it. */
const FILTER_ROWS = 2;
/** The position indicator's row, reserved whether or not it shows —
 *  a row that arrives unbudgeted pushes the status bar off the screen. */
const INDICATOR_ROWS = 1;
/** The banner earns its five rows only while the list stays the point. */
const MIN_ENTRIES_BESIDE_BANNER = 3;
const MIN_ENTRY_ROWS = 3;

export interface PickerEntry {
  pr: PullRequestSummary;
  /** 1..MAX_TITLE_ROWS rendered rows; the last ends in '…' when cut. */
  titleLines: string[];
  /** titleLines plus the meta row plus the trailing blank. */
  height: number;
}

/**
 * Greedy word wrap into at most `maxLines` rows of `width` cells. The wrap is
 * computed here, not left to Ink: the row budget, the scroll math, and the hit
 * test all count these rows, and Ink wrapping on its own would break all three.
 */
export function wrapTitle(text: string, width: number, maxLines: number): string[] {
  const w = Math.max(1, width);
  const lines: string[] = [];
  let rest = text.trim();

  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= w) {
      lines.push(rest);
      rest = '';
      break;
    }
    // Last allotted line and still more text: cut to fit with the ellipsis.
    if (lines.length === maxLines - 1) {
      lines.push(`${rest.slice(0, w - 1).trimEnd()}…`);
      rest = '';
      break;
    }
    const slice = rest.slice(0, w + 1);
    const breakAt = slice.lastIndexOf(' ');
    // No space to break on: a single word longer than the width hard-breaks
    // rather than overflowing the row.
    const cut = breakAt > 0 ? breakAt : w;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  return lines.length > 0 ? lines : [''];
}

export function buildEntries(prs: PullRequestSummary[], width: number): PickerEntry[] {
  const titleWidth = Math.max(1, width - TITLE_INDENT);
  return prs.map((pr) => {
    const text = `#${pr.number} ${pr.isDraft ? '[draft] ' : ''}${pr.title}`;
    const titleLines = wrapTitle(text, titleWidth, MAX_TITLE_ROWS);
    return { pr, titleLines, height: titleLines.length + 2 };
  });
}

export interface PickerLayout {
  banner: boolean;
  /** Rows above the first entry: banner block if shown, then the filter block. */
  headerRows: number;
  /** Rows the entries may draw in. */
  entryRows: number;
}

export function layoutPicker(height: number, width: number): PickerLayout {
  const wide = width >= WORDMARK_COLS + 2;
  const withBanner = height - BANNER_ROWS - FILTER_ROWS - INDICATOR_ROWS;
  const banner = wide && withBanner >= MIN_ENTRIES_BESIDE_BANNER * MIN_ENTRY_ROWS;
  const headerRows = (banner ? BANNER_ROWS : 0) + FILTER_ROWS;
  return { banner, headerRows, entryRows: Math.max(0, height - headerRows - INDICATOR_ROWS) };
}

/**
 * The first entry shown, adjusted so the cursor's entry is fully visible.
 * Entries are 3 or 4 rows tall, so this walks heights instead of dividing —
 * the fixed-height shortcut is exactly how the renderer and the scroll math
 * would come to disagree by a row.
 */
export function pickerScroll(
  heights: number[], viewRows: number, cursor: number, scrollTop: number,
): number {
  const last = heights.length - 1;
  let top = Math.min(Math.max(0, scrollTop), Math.max(0, last));
  const at = Math.min(Math.max(0, cursor), Math.max(0, last));

  if (at < top) return at;
  let used = 0;
  for (let i = at; i >= top; i -= 1) used += heights[i] ?? 0;
  while (used > viewRows && top < at) {
    used -= heights[top] ?? 0;
    top += 1;
  }
  return top;
}

/** Entries [start, end) that fit in `viewRows` from `scrollTop`. */
export function pickerWindow(
  heights: number[], viewRows: number, scrollTop: number,
): { start: number; end: number } {
  const start = Math.min(Math.max(0, scrollTop), Math.max(0, heights.length - 1));
  let used = 0;
  let end = start;
  while (end < heights.length) {
    used += heights[end] ?? 0;
    // At least one entry always shows; a viewport shorter than one entry
    // clips rather than blanking the list entirely.
    if (used > viewRows && end > start) break;
    end += 1;
    if (used >= viewRows) break;
  }
  return { start, end: Math.max(end, start + (heights.length > 0 ? 1 : 0)) };
}

export interface PickerGeometry {
  headerRows: number;
  heights: number[];
  scrollTop: number;
  viewRows: number;
}

/**
 * The entry a click landed on, or null for chrome. The trailing blank of each
 * entry is a separator, not the entry — clicking the air between two pull
 * requests must not aim at either of them.
 */
export function hitPicker(geometry: PickerGeometry, row: number): number | null {
  const { headerRows, heights, scrollTop, viewRows } = geometry;
  if (row < headerRows) return null;

  const { start, end } = pickerWindow(heights, viewRows, scrollTop);
  let offset = row - headerRows;
  if (offset >= viewRows) return null;

  for (let i = start; i < end; i += 1) {
    const height = heights[i] ?? 0;
    if (offset < height) return offset < height - 1 ? i : null;
    offset -= height;
  }
  return null;
}

export function nextFilter(filter: PullFilter): PullFilter {
  if (filter === 'open') return 'review-requested';
  if (filter === 'review-requested') return 'all';
  return 'open';
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test tests/tui/picker.test.ts && bun test tests/tui/ && bun run typecheck && bun run lint:boundary`
Expected: PASS across the board (existing Welcome tests still green after the wordmark move).

- [ ] **Step 6: Commit**

```bash
git add src/tui/wordmark.ts src/tui/picker.ts src/tui/components/Welcome.tsx tests/tui/picker.test.ts
git commit -m "tui: pure layout for the full-screen picker"
```

---

### Task 2: `chrome.ts` — the app chrome row's arithmetic

**Files:**
- Create: `src/tui/chrome.ts`
- Test: `tests/tui/chrome.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ChromeLine { left: string; right: string }
export function chromeLine(opts: {
  repoLabel: string;
  filter: PullFilter;
  /** The warm review's number, or null. Pass null on the review screen itself. */
  warm: number | null;
  width: number;
}): ChromeLine;
export function chromeFilterLabel(filter: PullFilter): string; // 'open' | 'needs my review' | 'all'
```

`left` is `marrow · <repoLabel> · <filterLabel>`; `right` is `reviewing #N` or `''`. Both fit `width` with at least one cell between them: the right segment is dropped first, then the repo label truncates with `…`; the word `marrow` is never cut.

- [ ] **Step 1: Write the failing tests**

Create `tests/tui/chrome.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import { chromeFilterLabel, chromeLine } from '../../src/tui/chrome.js';

describe('chromeLine', () => {
  test('a wide terminal carries both segments', () => {
    const line = chromeLine({ repoLabel: 'octocat/webapp', filter: 'open', warm: 546, width: 80 });
    expect(line.left).toBe('marrow · octocat/webapp · open');
    expect(line.right).toBe('reviewing #546');
  });

  test('no warm review means no right segment', () => {
    const line = chromeLine({ repoLabel: 'octocat/webapp', filter: 'all', warm: null, width: 80 });
    expect(line.right).toBe('');
  });

  test('the right segment is the first thing dropped when the width runs out', () => {
    const line = chromeLine({ repoLabel: 'octocat/webapp', filter: 'open', warm: 546, width: 32 });
    expect(line.right).toBe('');
    expect(line.left).toBe('marrow · octocat/webapp · open');
  });

  test('the repo label truncates before the app name is touched', () => {
    const line = chromeLine({
      repoLabel: 'some-enormous-org/a-repository-with-a-very-long-name',
      filter: 'open', warm: null, width: 30,
    });
    expect(line.left.startsWith('marrow · ')).toBe(true);
    expect(line.left).toContain('…');
    expect(line.left.length).toBeLessThanOrEqual(30);
  });

  test('the filter is named in its own terms', () => {
    expect(chromeFilterLabel('review-requested')).toBe('needs my review');
    expect(
      chromeLine({ repoLabel: 'o/r', filter: 'review-requested', warm: null, width: 80 }).left,
    ).toBe('marrow · o/r · needs my review');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/tui/chrome.test.ts` — FAIL, module not found.

- [ ] **Step 3: Implement `src/tui/chrome.ts`**

```ts
import type { PullFilter } from '../core/github/types.js';

/** Lowercase: the chrome row is ambient state, not a heading. */
export function chromeFilterLabel(filter: PullFilter): string {
  if (filter === 'review-requested') return 'needs my review';
  if (filter === 'all') return 'all';
  return 'open';
}

export interface ChromeLine { left: string; right: string }

/**
 * The one row that frames every settled screen: app, repository, filter on
 * the left; the warm review on the right. Fitting degrades in the order of
 * what a reviewer can most spare — the reminder first, the repository's name
 * second, the app's name never: an unlabelled full-screen program is exactly
 * the "stray text" the design system exists to prevent.
 */
export function chromeLine(opts: {
  repoLabel: string;
  filter: PullFilter;
  warm: number | null;
  width: number;
}): ChromeLine {
  const { repoLabel, filter, warm, width } = opts;
  const filterLabel = chromeFilterLabel(filter);
  const left = `marrow · ${repoLabel} · ${filterLabel}`;
  const right = warm === null ? '' : `reviewing #${warm}`;

  if (right !== '' && left.length + 1 + right.length <= width) return { left, right };
  if (left.length <= width) return { left, right: '' };

  const fixed = `marrow · `.length + ` · ${filterLabel}`.length;
  const room = Math.max(1, width - fixed);
  const cut = `${repoLabel.slice(0, Math.max(0, room - 1))}…`;
  return { left: `marrow · ${cut} · ${filterLabel}`, right: '' };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/tui/chrome.test.ts && bun run typecheck` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/chrome.ts tests/tui/chrome.test.ts
git commit -m "tui: chrome-row segments fitted to a width"
```

---

### Task 3: `Launch.tsx` — the centered launch frame

**Files:**
- Create: `src/tui/components/Launch.tsx`
- Test: `tests/tui/launch.test.tsx`

**Interfaces:**
- Consumes: `WORDMARK`, `TAGLINE` from `src/tui/wordmark.js`; `LoadingSteps` and `LoadProgress` from existing modules; `theme`.
- Produces:

```ts
export type LaunchBody =
  | { kind: 'spinner'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'steps'; progress: LoadProgress };
export interface LaunchProps {
  repoLabel: string;
  width: number;
  height: number;
  body: LaunchBody;
  /** Frozen clock forwarded to LoadingSteps in tests. */
  now?: number;
}
export function Launch(props: LaunchProps): JSX.Element;
```

Layout, centered vertically and horizontally as a block: wordmark rows (`tier.primary`), tagline (`tier.tertiary`), blank, `repoLabel` (`tier.tertiary`), blank, then the body. The error body renders `message` in `theme.color.danger` bold, with `r retry · q quit` beneath in `tier.muted`. When `height < 14` the wordmark and tagline are replaced by the single word `marrow` (`tier.primary`) — the frame never clips a glyph. Use ink-testing-library-style rendering as the existing component tests do (look at `tests/tui/loadingsteps.test.tsx` or the nearest existing component test for the harness pattern and mirror it).

- [ ] **Step 1: Write failing tests** (`tests/tui/launch.test.tsx`)

```tsx
import { test, expect, describe } from 'bun:test';
import { render } from 'ink-testing-library';
import { Launch } from '../../src/tui/components/Launch.js';
import { loadSteps, startStep } from '../../src/tui/progress.js';

describe('Launch', () => {
  test('the fetch state shows the wordmark, the repository, and the spinner label', () => {
    const { lastFrame } = render(
      <Launch
        repoLabel="octocat/webapp" width={80} height={24}
        body={{ kind: 'spinner', label: 'fetching open pull requests…' }}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('█▄ ▄█');
    expect(frame).toContain('a large diff, abridged to what carries meaning');
    expect(frame).toContain('octocat/webapp');
    expect(frame).toContain('fetching open pull requests…');
  });

  test('a failed fetch names the error and the two keys out of it', () => {
    const { lastFrame } = render(
      <Launch
        repoLabel="octocat/webapp" width={80} height={24}
        body={{ kind: 'error', message: 'Could not list pull requests: boom' }}
      />,
    );
    expect(lastFrame()).toContain('Could not list pull requests: boom');
    expect(lastFrame()).toContain('r retry · q quit');
  });

  test('a direct open hosts the loading steps in the frame', () => {
    const progress = { prNumber: 42, steps: startStep(loadSteps(), 'pull', 0) };
    const { lastFrame } = render(
      <Launch
        repoLabel="octocat/webapp" width={80} height={24}
        body={{ kind: 'steps', progress }} now={0}
      />,
    );
    expect(lastFrame()).toContain('Loading #42');
  });

  test('a short terminal types the wordmark instead of drawing it', () => {
    const { lastFrame } = render(
      <Launch
        repoLabel="octocat/webapp" width={80} height={10}
        body={{ kind: 'spinner', label: 'fetching open pull requests…' }}
      />,
    );
    expect(lastFrame()).not.toContain('█▄ ▄█');
    expect(lastFrame()).toContain('marrow');
  });
});
```

Check `src/tui/progress.ts` for the exact `loadSteps`/`startStep` signatures (`startStep(steps, STEP.pull, now)` — import `STEP` if the string id is not accepted) and adjust the third test's construction to match. If the repo does not already depend on `ink-testing-library`, mirror whatever harness the existing component tests (e.g. `tests/tui/welcome.test.tsx`) actually use instead.

- [ ] **Step 2: Run to verify failure** — `bun test tests/tui/launch.test.tsx` fails on the missing module.

- [ ] **Step 3: Implement `src/tui/components/Launch.tsx`**

```tsx
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { LoadProgress } from '../progress.js';
import { TAGLINE, WORDMARK } from '../wordmark.js';
import { LoadingSteps } from './LoadingSteps.js';
import { theme } from '../theme.js';

export type LaunchBody =
  | { kind: 'spinner'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'steps'; progress: LoadProgress };

export interface LaunchProps {
  repoLabel: string;
  width: number;
  height: number;
  body: LaunchBody;
  now?: number;
}

/** Wordmark + tagline + blank + repo + blank + at least four body rows. */
const FULL_ROWS = 14;

/**
 * What running `marrow` shows before there is anything to pick from: the app
 * visibly starts, then loads. Errors land in this same frame rather than as
 * text dumped under the prompt — the alternate screen is already up, and a
 * reviewer mid-launch should be told what failed where they are looking.
 */
export function Launch({ repoLabel, width, height, body, now }: LaunchProps) {
  const art = height >= FULL_ROWS;

  return (
    <Box
      flexDirection="column"
      height={height}
      width={width}
      justifyContent="center"
      alignItems="center"
    >
      {art ? (
        WORDMARK.map((line, i) => (
          <Text key={i} {...theme.tier.primary} wrap="truncate">{line}</Text>
        ))
      ) : (
        <Text {...theme.tier.primary}>marrow</Text>
      )}
      {art && <Text {...theme.tier.tertiary} wrap="truncate">{TAGLINE}</Text>}
      <Text> </Text>
      <Text {...theme.tier.tertiary} wrap="truncate">{repoLabel}</Text>
      <Text> </Text>
      {body.kind === 'spinner' && (
        <Text {...theme.tier.tertiary} wrap="truncate">
          <Text color={theme.color.structure}><Spinner type="dots" />{'  '}</Text>
          {body.label}
        </Text>
      )}
      {body.kind === 'error' && (
        <Box flexDirection="column" alignItems="center">
          <Text color={theme.color.danger} bold wrap="truncate">{body.message}</Text>
          <Text {...theme.tier.muted}>r retry · q quit</Text>
        </Box>
      )}
      {body.kind === 'steps' && <LoadingSteps progress={body.progress} now={now} />}
    </Box>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `bun test tests/tui/launch.test.tsx && bun run typecheck` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/components/Launch.tsx tests/tui/launch.test.tsx
git commit -m "tui: centered launch frame with spinner, error, and steps bodies"
```

---

### Task 4: `PrPicker.tsx` — the full-screen picker component

**Files:**
- Create: `src/tui/components/PrPicker.tsx`
- Test: `tests/tui/prpicker.test.tsx`

**Interfaces:**
- Consumes: `buildEntries`, `layoutPicker`, `pickerWindow` from `src/tui/picker.js`; `WORDMARK`, `TAGLINE` from `wordmark.js`; `relativeTime` from `src/core/render/time.js`; `LoadingSteps`.
- Produces:

```ts
export interface PrPickerProps {
  /** Already filtered by the query — App filters once, this renders. */
  prs: PullRequestSummary[];
  /** The unfiltered count, for `N of M`. */
  total: number;
  query: string;
  cursor: number;
  /** Entry index of the first visible entry (from pickerScroll). */
  scrollTop: number;
  height: number;
  width: number;
  warmPrNumber: number | null;
  /** A PR being opened from the picker: steps replace the entry region. */
  progress?: LoadProgress | null;
  now?: number;
}
export function PrPicker(props: PrPickerProps): JSX.Element;
```

Render, top to bottom (all inside a `paddingX={1}` column of `width`/`height`):
1. When `layoutPicker(height, width - 2).banner`: the three `WORDMARK` rows (`tier.primary`), `TAGLINE` (`tier.tertiary`), one blank row.
2. The filter line: `filter › ` in `theme.color.structure`, the query in `tier.secondary`, a `▏` caret in `structure`; right-aligned on the same row, in `tier.muted`: `${prs.length} of ${total}` when the query narrows, else `${total}`. Pad the middle with spaces to `width - 2`; truncate the query from the *front* if it alone would overflow (the end being typed is the part that must stay visible).
3. One blank row.
4. If `progress` is set: `<LoadingSteps progress={progress} now={now} />` and nothing else below.
5. Else entries from `pickerWindow(heights, layout.entryRows, scrollTop)`: per entry, the first title row prefixed `❯ ` (`structure`) + bold when `cursor === index`, `'  '` otherwise; continuation title rows indented six spaces; the meta row `    author · relativeTime` in `tier.muted`, with ` · ● reviewing` appended in `theme.color.pending` when `pr.number === warmPrNumber`; one blank row. Every `<Text>` gets `wrap="truncate"`.
6. Empty states, centered in the entry region: `prs.length === 0 && total === 0` → `No pull requests.`; `prs.length === 0 && total > 0` → `No match for "query".` — both `tier.muted`.
7. When the list overflows `entryRows`: the indicator row `  ${start + 1}–${end} of ${prs.length}` in `tier.muted`.

- [ ] **Step 1: Write failing tests** (`tests/tui/prpicker.test.tsx`, same render harness as Task 3)

```tsx
import { test, expect, describe } from 'bun:test';
import { render } from 'ink-testing-library';
import { PrPicker } from '../../src/tui/components/PrPicker.js';
import type { PullRequestSummary } from '../../src/core/github/types.js';

function summary(number: number, title: string, author = 'octocat'): PullRequestSummary {
  return {
    number, title, author, state: 'open', isDraft: false,
    headSha: 'abc', baseRef: 'main', headRef: 'feat/x',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}
const prs = [summary(41, 'Alpha rendering'), summary(42, 'Beta caching', 'hubot')];

function mount(over: Partial<Parameters<typeof PrPicker>[0]> = {}) {
  return render(
    <PrPicker
      prs={prs} total={2} query="" cursor={0} scrollTop={0}
      height={30} width={80} warmPrNumber={null}
      {...over}
    />,
  );
}

describe('PrPicker', () => {
  test('a tall terminal leads with the banner and the filter line', () => {
    const frame = mount().lastFrame()!;
    expect(frame).toContain('█▄ ▄█');
    expect(frame).toContain('filter ›');
  });

  test('full titles are readable — the selected entry wears the marker and its number', () => {
    const frame = mount().lastFrame()!;
    expect(frame).toContain('❯ #41 Alpha rendering');
    expect(frame).toContain('#42 Beta caching');
  });

  test('a narrowing query shows N of M', () => {
    const frame = mount({ prs: [prs[0]!], query: 'alpha' }).lastFrame()!;
    expect(frame).toContain('1 of 2');
  });

  test('the warm entry says so', () => {
    const frame = mount({ warmPrNumber: 42 }).lastFrame()!;
    expect(frame).toContain('● reviewing');
  });

  test('an empty repository and an empty match read differently', () => {
    expect(mount({ prs: [], total: 0 }).lastFrame()).toContain('No pull requests.');
    expect(mount({ prs: [], total: 2, query: 'zzz' }).lastFrame())
      .toContain('No match for "zzz".');
  });

  test('opening a pull request replaces the entries with the loading steps', () => {
    const { loadSteps } = require('../../src/tui/progress.js');
    const frame = mount({
      progress: { prNumber: 41, steps: loadSteps() }, now: 0,
    } as never).lastFrame()!;
    expect(frame).toContain('Loading #41');
    expect(frame).not.toContain('❯ #41');
  });
});
```

(Use a proper static `import` for `loadSteps` — the `require` above is shorthand in this plan, not a pattern to copy.)

- [ ] **Step 2: Run to verify failure** — module not found.

- [ ] **Step 3: Implement the component** per the render contract above. Derive every row count from `layoutPicker`/`buildEntries`/`pickerWindow` — no arithmetic of its own. The entries' `<Box flexDirection="column">` children slice `[window.start, window.end)`.

- [ ] **Step 4: Run to verify pass** — `bun test tests/tui/prpicker.test.tsx && bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/tui/components/PrPicker.tsx tests/tui/prpicker.test.tsx
git commit -m "tui: full-screen picker component"
```

---

### Task 5: The `picker` mode — keymap, hints, and App's input model

The `list` and `search` modes merge into `picker`; every printable key becomes filter input. **The old sidebar keeps rendering in this task** (visuals swap in Task 6) — the deliverable is the input model, compiling and tested at every commit.

**Files:**
- Modify: `src/tui/keymap.ts`, `src/tui/hints.ts`, `src/tui/App.tsx`
- Test: `tests/tui/keymap.test.ts`, `tests/tui/hints.test.ts`, `tests/tui/app-input.test.tsx`

**Interfaces:**
- Produces: `Mode = 'picker' | 'detail' | 'comment' | 'submit' | 'help' | 'chat'`; `Action` loses `{ type: 'search' }` and `{ type: 'filter'; filter }` and `{ type: 'open' }`; `pickerHints(warmPrNumber: number | null): Hint[]` replaces `listHints()`.
- Consumes: `nextFilter` from `picker.js` (Task 1).

- [ ] **Step 1: keymap.ts** — make these changes:
  - `Mode`: replace `'list'` and `'search'` with `'picker'`.
  - Delete the `open`, `search`, and `filter` action variants and the `FILTERS` table (the picker's inline handler owns all three now).
  - In `resolveAction`, the text-entry guard becomes `mode === 'comment' || mode === 'picker' || mode === 'chat'` — the picker swallows everything except escape for the same reason the composer does: printable keys are data.
  - Delete the `if (mode === 'list')` block.
  - `KEY_HELP`: retag every `modes: ['list', …]` entry (`j / k`, `wheel`, `R`, `?`, `q` lose the tag; drop `'search'` from the esc entry) and rewrite the `list` group to the picker's reality:

```ts
{ keys: 'type', description: 'filter by title, author, or number', modes: ['picker'], group: 'list' },
{ keys: '↑ / ↓', description: 'move · also ctrl-p / ctrl-n', modes: ['picker'], group: 'list' },
{ keys: 'enter', description: 'review the selected pull request', modes: ['picker'], group: 'list' },
{ keys: 'tab', description: 'filter: open / needs my review / all', modes: ['picker'], group: 'list' },
{ keys: 'ctrl-r', description: 'refetch from GitHub', modes: ['picker'], group: 'list' },
{ keys: 'esc', description: 'clear the query, else back to the review', modes: ['picker'], group: 'list' },
```

- [ ] **Step 2: hints.ts** — replace `listHints()`:

```ts
export function pickerHints(warmPrNumber: number | null): Hint[] {
  const hints: Hint[] = [
    { keys: '↑↓', label: 'move' },
    { keys: '⏎', label: 'review this one', short: 'review' },
    { keys: '⇥', label: 'filter' },
    { keys: 'ctrl-r', label: 'refresh' },
  ];
  hints.push(
    warmPrNumber === null
      ? { keys: 'esc', label: 'quit' }
      : { keys: 'esc', label: `back to #${warmPrNumber}`, short: 'back' },
  );
  return hints;
}
```

(No `?` hint: the picker has no help binding — `?` is filter text, and this bar is the complete key list. `fitHints` keeps the *last* hint under pressure, which is now `esc` — the way out. That is the right survivor here.)

- [ ] **Step 3: App.tsx** — the input-model rewiring. All references first: initial mode `useState<Mode>(props.pr ? 'detail' : 'picker')`; `underlay` initial `'picker'`; `browsing = mode === 'picker'`; every `mode === 'list' || mode === 'search'` becomes `mode === 'picker'`; `setMode('list')` becomes `setMode('picker')`. Then:
  - Delete the `if (mode === 'search')` inline handler and add, in its place (after the confirmQuit block, before the submit block):

```tsx
if (mode === 'picker') {
  if (key.escape) {
    if (query.length > 0) return applyQuery('');
    if (props.pr && props.meat) return setMode('detail');
    if (hasUnsubmittedWork) return setConfirmQuit(true);
    return exit();
  }
  if (key.return) {
    const selected = visiblePrs[prCursor];
    if (!selected) return;
    // Returning to the warm review is a mode switch, not a reload: openPr
    // would refetch, re-run the meat pass, and lose the reviewer's place.
    if (selected.number === props.pr?.number && props.meat) return setMode('detail');
    return props.onOpenPr(selected.number);
  }
  if (key.upArrow || (key.ctrl && input === 'p')) return moveList(prCursor - 1);
  if (key.downArrow || (key.ctrl && input === 'n')) return moveList(prCursor + 1);
  if (key.tab) return props.onFilter?.(nextFilter(props.filter));
  if (key.ctrl && input === 'r') return props.onRefresh?.();
  if (key.backspace || key.delete) return applyQuery(query.slice(0, -1));
  if (key.ctrl || key.meta || input.length === 0) return;
  return applyQuery(query + input);
}
```

  - Import `nextFilter` from `./picker.js`. `useInput`'s `key` includes `tab`; extend the local key typing if needed.
  - In the action switch: delete the `open`, `filter`, and `search` cases; in `back`, `if (mode === 'detail') return setMode('picker');` and delete the trailing `if (query.length > 0)` branch (the picker handler owns the query now).
  - `halfPage`/`move`: the `mode === 'list'` branches become `mode === 'picker'` (dead in practice — the picker handler returns before `resolveAction` — but they must still compile; leave them pointing at `moveList`).
  - `handleMouse`: the list branch's guard becomes `mode === 'picker'`; `hitList`'s `top` argument becomes `listHeaderRows(query.length > 0)`.
  - Render: `PrList` props `cursor={mode === 'picker' ? prCursor : -1}`, `searching={query.length > 0}`; `listRows = visibleEntryCount(bodyHeight, query.length > 0)`; hint bar `listHints()` → `pickerHints(props.pr && props.meat ? props.pr.number : null)`; import updated.
  - The `warm` idea appears twice already — add one derived value near `reviewing` and use it in both places: `const warmPr = props.pr !== null && props.meat !== null ? props.pr.number : null;`

- [ ] **Step 4: Update the existing tests that encode the old model.** In `tests/tui/keymap.test.ts` and `tests/tui/hints.test.ts`, rewrite `list`/`search`-mode expectations to the table above. In `tests/tui/app-input.test.tsx`: tests that press `/` to search, `1`/`2`/`3` to filter, or `j`/`k` in the list must be rewritten to the new model. Then add the new flows:

```tsx
describe('the picker is search-first', () => {
  test('typing narrows the list and backspace restores it', async () => {
    const h = mount();
    await h.press('beta');
    expect(h.frame()).toContain('#42');
    expect(h.frame()).not.toContain('#41');
    await h.press('\x7f\x7f\x7f\x7f'); // four backspaces
    expect(h.frame()).toContain('#41');
  });

  test('digits are query text, not filter switches', async () => {
    let filtered: string | null = null;
    const h = mount({ onFilter: (f) => { filtered = f; } });
    await h.press('42');
    expect(filtered).toBe(null);
    expect(h.frame()).toContain('#42');
    expect(h.frame()).not.toContain('#41');
  });

  test('tab cycles the server-side filter', async () => {
    let filtered: string | null = null;
    const h = mount({ onFilter: (f) => { filtered = f; } });
    await h.press('\t');
    expect(filtered).toBe('review-requested');
  });

  test('ctrl-r refetches while r merely types', async () => {
    let refreshed = 0;
    const h = mount({ onRefresh: () => { refreshed += 1; } });
    await h.press('r');
    expect(refreshed).toBe(0);
    await h.press('\x12'); // ctrl-r
    expect(refreshed).toBe(1);
  });

  test('esc clears the query before it means anything else', async () => {
    const h = mount();
    await h.press('beta');
    await h.press('\x1b');
    expect(h.frame()).toContain('#41');
  });
});
```

(Match the existing file's `press` encoding conventions — it already sends escape and control bytes; copy its idioms.)

- [ ] **Step 5: Run everything** — `bun test && bun run typecheck && bun run lint:boundary`. Expect and fix fallout in any other test that mentions the removed modes.

- [ ] **Step 6: Commit**

```bash
git add -A src/tui tests/tui
git commit -m "tui: one search-first picker mode replaces list and search"
```

---

### Task 6: Full-screen render — PrPicker, Launch, and the chrome row

**Files:**
- Modify: `src/tui/App.tsx`
- Test: `tests/tui/app-input.test.tsx`

**Interfaces:**
- Consumes: `PrPicker`, `Launch`, `chromeLine`, `buildEntries`, `layoutPicker`, `pickerScroll`, `hitPicker`.
- Produces: `AppProps.prs: PullRequestSummary[] | null` and `AppProps.listError?: string | null` (Task 8 wires the CLI to them).

- [ ] **Step 1: Prop change.** `prs: PullRequestSummary[] | null` — `null` means the initial fetch is in flight; add `listError?: string | null`. `visiblePrs` becomes `filterPrs(props.prs ?? [], query)`.

- [ ] **Step 2: Geometry.** `bodyHeight = Math.max(1, rows - 4)` (chrome row + its rule + the bottom hrule + status bar). `detailWidth = Math.max(1, columns - 2)` unconditionally; `paneLeft = 1` unconditionally; delete the `reviewing ? … :` width branches and the stale sidebar comments beside them. Replace the `listRows`/`visibleEntryCount` pair with:

```tsx
const pickerBodyHeight = Math.max(0, bodyHeight - noteRows);
const pickerEntries = useMemo(
  () => buildEntries(visiblePrs, detailWidth),
  [visiblePrs, detailWidth],
);
const pickerLayout = layoutPicker(pickerBodyHeight, detailWidth);
const entryHeights = pickerEntries.map((e) => e.height);
```

`moveList` becomes:

```tsx
function moveList(next: number) {
  const clamped = clampCursor(next, visiblePrs.length);
  setListCursor(clamped);
  setListScroll((prev) => pickerScroll(entryHeights, pickerLayout.entryRows, clamped, prev));
}
```

and `applyQuery`'s scroll line follows suit (`pickerScroll(…, clamped, 0)` over the *narrowed* list's heights — build them locally from `filterPrs(props.prs ?? [], next)`).

- [ ] **Step 3: The chrome row.** One shared element:

```tsx
const chrome = chromeLine({
  repoLabel: props.repoLabel,
  filter: props.filter,
  // Named on every screen except the review itself, where the title block
  // two rows down already says it — twice on one screen is noise.
  warm: mode === 'picker' || mode === 'help' || mode === 'submit' || mode === 'chat'
    ? warmPr
    : null,
  width: Math.max(1, columns - 2),
});
const chromeRow = (
  <Box flexDirection="column">
    <Box paddingX={1} justifyContent="space-between">
      <Text {...theme.tier.tertiary} wrap="truncate">{chrome.left}</Text>
      {chrome.right !== '' && <Text color={theme.color.structure}>{chrome.right}</Text>}
    </Box>
    <Text {...theme.tier.muted}>{theme.glyph.hrule.repeat(Math.max(1, columns))}</Text>
  </Box>
);
```

Wrap the `help`, `submit`, and `chat` early returns in `<Box flexDirection="column" height={rows}>{chromeRow}…</Box>` and hand them `rows - 2` as their height (`<Help width={columns} height={rows - 2} …>`); `moveHelp` and `halfPage`'s help branch must use the same `rows - 2` for `layoutHelp`/`helpBodyRows` — introduce `const overlayHeight = rows - 2;` and use it in all three places so the renderer and the scroll math cannot split. Add `{chromeRow}` as the first child of the main return's column, above the body `<Box flexGrow={1}>`.

- [ ] **Step 4: The launch frame.** Before the main return (after the chat early return):

```tsx
if (mode === 'picker' && props.prs === null) {
  return (
    <Launch
      repoLabel={props.repoLabel}
      width={columns}
      height={rows}
      body={props.progress
        ? { kind: 'steps', progress: props.progress }
        : props.listError
          ? { kind: 'error', message: props.listError }
          : { kind: 'spinner', label: 'fetching open pull requests…' }}
    />
  );
}
```

And at the very top of the picker branch in `useInput` (before the escape handling), the launch frame's two keys:

```tsx
if (props.prs === null) {
  if (input === 'q') return exit();
  if (input === 'r' && props.listError) return props.onRefresh?.();
  return;
}
```

- [ ] **Step 5: The body swap.** In the main return, delete the `!reviewing && (<PrList …/> + rule)` block and the `Welcome` fallback branch entirely (with their imports). The body becomes: when `mode === 'picker'`, render

```tsx
<PrPicker
  prs={visiblePrs}
  total={props.prs?.length ?? 0}
  query={query}
  cursor={prCursor}
  scrollTop={listScroll}
  height={pickerBodyHeight}
  width={detailWidth}
  warmPrNumber={warmPr}
  progress={props.progress ?? null}
/>
```

followed by the existing `notes`; otherwise the existing Detail/LoadingSteps/status chain (the `LoadingSteps` branch still fires for a direct `marrow 42` open once the list has loaded; keep it).

- [ ] **Step 6: Mouse.** Replace the picker branch of `handleMouse`: wheel still `moveList(prCursor ± 1)`; a left press resolves through

```tsx
const hit = hitPicker({
  headerRows: pickerLayout.headerRows + 2, // + chrome row and its rule
  heights: entryHeights,
  scrollTop: listScroll,
  viewRows: pickerLayout.entryRows,
}, report.row);
```

(the picker is full-width, so no column bounds), keeping the aim-then-open two-click behaviour, with the warm short-circuit: a second click on the warm PR's entry sets `mode('detail')` instead of `onOpenPr`. Remove the `hitList`/`listHeaderRows`/`ROWS_PER_ENTRY` imports.

- [ ] **Step 7: Tests.** Rewrite the frame-shaped assertions in `app-input.test.tsx` that expected the sidebar (`mount()` with default props now needs nothing new — `prs` stays the array). Add:

```tsx
describe('the app frames every screen', () => {
  test('the picker is full screen with the chrome row on top', async () => {
    const h = mount();
    expect(h.frame()).toContain('marrow · octocat/marrow · open');
    expect(h.frame()).toContain('filter ›');
    expect(h.frame()).toContain('❯ #41 Alpha rendering');
  });

  test('a null list renders the launch frame', async () => {
    const h = mount({ prs: null });
    expect(h.frame()).toContain('fetching open pull requests…');
    expect(h.frame()).not.toContain('filter ›');
  });

  test('a list error offers retry, and r takes it', async () => {
    let refreshed = 0;
    const h = mount({ prs: null, listError: 'boom', onRefresh: () => { refreshed += 1; } });
    expect(h.frame()).toContain('r retry · q quit');
    await h.press('r');
    expect(refreshed).toBe(1);
  });

  test('the chrome names the warm review from the picker', async () => {
    const h = mountWithOpenPr();       // use the file's existing helper that
    await h.press('\x1b');             // mounts with pr+meat loaded
    // (after Task 7 this esc will confirm first — update then)
    expect(h.frame()).toContain('reviewing #42');
  });
});
```

- [ ] **Step 8: Run everything** — `bun test && bun run typecheck && bun run lint:boundary`. Substantial existing-test fallout is expected (frames changed shape); fix assertions to the new frames, never by weakening what they test.

- [ ] **Step 9: Commit**

```bash
git add -A src/tui tests/tui
git commit -m "tui: full-screen picker, launch frame, and the chrome row"
```

---

### Task 7: The warm review keeps its place

Most of this landed as the `enter`/`esc` short-circuits in Task 5. This task pins the behaviour with regression tests — the state-preservation claim is the feature.

**Files:**
- Test: `tests/tui/app-input.test.tsx`

- [ ] **Step 1: Write the tests** (using the file's existing pr+meat mounting helper and key idioms):

```tsx
describe('the warm review', () => {
  test('enter on the warm pull request returns to it without re-opening', async () => {
    let opened: number[] = [];
    const h = mountWithOpenPr({ onOpenPr: (n) => opened.push(n) });
    await h.press('\x1b');                  // leave to the picker
    await h.press('\r');                    // enter on the (still-selected) warm PR
    expect(opened).toEqual([]);             // no refetch, no meat re-run
    expect(h.frame()).toContain('kept');    // the detail header's gauge line
  });

  test('a round trip to the picker keeps the cursor, scroll, and reviewed marks', async () => {
    const h = mountWithOpenPr();
    await h.press('jjjj');                  // walk into the diff
    const before = h.frame();
    await h.press('\x1b');                  // out to the picker
    expect(h.frame()).toContain('filter ›');
    await h.press('\x1b');                  // straight back in
    expect(h.frame()).toBe(before);
  });

  test('enter on a different pull request replaces the warm one', async () => {
    let opened: number[] = [];
    const h = mountWithOpenPr({ onOpenPr: (n) => opened.push(n) });
    await h.press('\x1b');
    await h.press('\x1b[B');                // ↓ to another entry
    await h.press('\r');
    expect(opened.length).toBe(1);
  });
});
```

(When Task 8 lands first in your ordering — it does not; it lands after — no confirm exists yet, so a bare `esc` leaves directly. If executing out of order, insert the confirm's `\r` after each leave.)

- [ ] **Step 2: Run** — `bun test tests/tui/app-input.test.tsx`. The first and third should already pass from Task 5's handler; the round-trip test is the one that can catch a state reset. If it fails, find which state the picker trip cleared — nothing outside the `openNumber` effect (`App.tsx`, the `useEffect` keyed on it) may reset review state.

- [ ] **Step 3: Commit**

```bash
git add tests/tui/app-input.test.tsx
git commit -m "tests: a warm review survives the round trip to the picker"
```

---

### Task 8: Every esc out of a review asks first

**Files:**
- Modify: `src/tui/App.tsx`, `src/tui/keymap.ts` (KEY_HELP wording only)
- Test: `tests/tui/app-input.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
describe('leaving the review asks', () => {
  test('esc from the review confirms before the picker appears', async () => {
    const h = mountWithOpenPr();
    await h.press('\x1b');
    expect(h.frame()).toContain('leave this review?');
    expect(h.frame()).not.toContain('filter ›');
    await h.press('\r');
    expect(h.frame()).toContain('filter ›');
  });

  test('esc at the question stays in the review', async () => {
    const h = mountWithOpenPr();
    await h.press('\x1b\x1b');
    expect(h.frame()).not.toContain('leave this review?');
    expect(h.frame()).toContain('kept');
  });

  test('a stray key at the question does nothing', async () => {
    const h = mountWithOpenPr();
    await h.press('\x1bx');
    expect(h.frame()).toContain('leave this review?');
  });

  test('esc clears a selection before it means leave', async () => {
    const h = mountWithOpenPr();
    await h.press('V');
    await h.press('\x1b');
    expect(h.frame()).not.toContain('leave this review?');
  });

  test('q still routes to the quit confirm, not the leave confirm', async () => {
    const h = mountWithOpenPr();
    await h.press('c');                    // stage a comment so quit has work to guard
    await h.press('hello');
    await h.press('\x04');                 // ctrl-d saves
    await h.press('q');
    expect(h.frame()).toContain('unsubmitted comment');
    expect(h.frame()).not.toContain('leave this review?');
  });
});
```

Also update Task 7's round-trip tests to answer the new question (`\x1b` then `\r`).

- [ ] **Step 2: Run to verify failure** — the first test fails: esc lands straight in the picker.

- [ ] **Step 3: Implement.** In `App.tsx`:
  - `const [confirmLeave, setConfirmLeave] = useState(false);` reset alongside `confirmQuit` in the `openNumber` effect.
  - In `useInput`, extend the mouse suppression: `if (!confirmQuit && !confirmLeave) handleMouse(mouse);`.
  - Directly after the `confirmQuit` block:

```tsx
// Leaving is cheap — the review stays warm and the draft is on disk — but
// esc is also the most reflexive key in the app, and the screen it swaps
// away is the reviewer's place in a diff. One question, every time.
if (confirmLeave) {
  if (key.return) {
    setConfirmLeave(false);
    return setMode('picker');
  }
  if (key.escape) return setConfirmLeave(false);
  return;
}
```

  - In the action switch's `back` case: `if (mode === 'detail') return setConfirmLeave(true);` (the selection-clearing branch above it stays first).
  - Render: the status-row conditional becomes `confirmQuit ? … : confirmLeave ? … : <HintBar …>` with:

```tsx
<Text color={theme.color.pending} wrap="truncate">
  {'leave this review? it stays warm — esc returns to it · ⏎ leave · esc stay'}
</Text>
```

  - `KEY_HELP`: the detail-mode esc behaviour is worth a row — add `{ keys: 'esc', description: 'back to the pull-request list', modes: ['detail'], group: 'list' }`.

- [ ] **Step 4: Run** — `bun test && bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add -A src/tui tests/tui
git commit -m "tui: leaving a review asks, and the answer is one key"
```

---

### Task 9: The CLI starts the app, then loads

**Files:**
- Modify: `src/cli.tsx`

- [ ] **Step 1: Rework `runTui`** (`src/cli.tsx:195-443`):
  - `let prs: PullRequestSummary[] | null = null;` and `let listError: string | null = null;` — delete the blocking `await client.listPulls(…)` at the top.
  - Pass `prs={prs}` and `listError={listError}` through `view()`.
  - New loader, used by startup and refresh both:

```ts
async function loadList(): Promise<void> {
  listError = null;
  try {
    prs = await client.listPulls(repo.owner, repo.repo, filter);
  } catch (error) {
    // With a list already on screen this is a status note; with none it is
    // the launch frame's error state — the reviewer keeps whichever they had.
    if (prs === null) listError = `Could not list pull requests: ${message(error)}`;
    else {
      status = `Could not refresh: ${message(error)}`;
      statusTone = 'danger';
    }
  }
  draw();
}
```

  - `refresh()` becomes `return loadList();` (keep the signature); `changeFilter` unchanged (it already funnels through `refresh`).
  - After `const instance = render(view());`: `void loadList();` — the screen is up before GitHub answers, which is the entire point.
  - The direct-open call `if (args.prNumber !== null) void openPr(args.prNumber);` stays exactly where it is.

- [ ] **Step 2: Verify by behaviour.** `runTui` has no unit-test seam and the plan does not add one; the App-level tests from Task 6 already cover both `prs === null` render states. Manually smoke it if a TTY is available: `bun run build` then run the binary in a repo — the wordmark and spinner must paint before the list arrives. Otherwise rely on: `bun test && bun run typecheck && bun run lint:boundary && bun run build`.

- [ ] **Step 3: Commit**

```bash
git add src/cli.tsx
git commit -m "cli: enter the screen first, fetch the list second"
```

---

### Task 10: Delete what the picker replaced

**Files:**
- Delete: `src/tui/components/PrList.tsx`, `src/tui/components/Welcome.tsx`, `tests/tui/prlist.test.tsx`, and Welcome's test file (check `ls tests/tui/` for its exact name)
- Modify: `src/tui/hittest.ts` (delete `hitList` and `ListGeometry`), `tests/tui/hittest.test.ts` (delete its `hitList` cases), `src/tui/theme.ts` (delete `layout.sidebarWidth`)

- [ ] **Step 1: Confirm nothing imports them** — `grep -rn "PrList\|Welcome\|hitList\|sidebarWidth" src/ tests/` must show only the files being deleted (Tasks 5–6 removed the App imports; if anything else surfaces, fix it here, don't leave a re-export).
- [ ] **Step 2: Delete**, run `bun test && bun run typecheck && bun run lint:boundary && bun run build` — all green.
- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "tui: retire the sidebar, its welcome panel, and their arithmetic"
```

---

### Task 11: Documentation

**Files:**
- Modify: `.interface-design/system.md`, `README.md`

- [ ] **Step 1: Append a revision to `.interface-design/system.md`** (append, never rewrite history — the file is successive revisions after real use). Cover, in its voice: the sidebar's retirement (32 columns truncated every title of consequence, offered no way back into an open review, and split a screen that had no second occupant once `Welcome` existed only to fill the gap); the search-first picker (typing is the interface; movement keys are what a live input leaves free); the amendment to **no row may ever wrap** (picker titles get up to two *computed* rows from `picker.ts` — the rule's target was Ink wrapping breaking row math, and that target stands); the chrome row (sanctioned rule below a header; right segment drops first); the launch frame (render first, fetch second); and the leave confirm (status-row takeover, `pending` — nothing is destroyed). Add to **Rejected defaults**: *a sidebar for a list that is the only thing on screen*. Update the **States** table rows for the picker (`selected`, `empty list`, `no match`, launch loading, launch error, leave confirm).
- [ ] **Step 2: Update `README.md`**: the "What it looks like" first figure becomes the picker (banner, filter line, full-width entries — keep it honest to the real frame); the prose around it ("Pick something to review", "The sidebar gets out of the way…" → the picker/review language); the Keys table: `/` and `1 2 3` rows replaced by `type` to filter and `tab`; add `ctrl-r`; note `esc` semantics (clear query / back to review / leave-review confirm). Mention the launch screen in one sentence where startup is described.
- [ ] **Step 3: Final gates** — `bun test && bun run typecheck && bun run lint:boundary && bun run build`.
- [ ] **Step 4: Commit**

```bash
git add .interface-design/system.md README.md
git commit -m "docs: the picker is the app now"
```
