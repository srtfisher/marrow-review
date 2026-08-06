# Arrow-key navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ↑/↓ walk the lines of a file and step straight into the neighbouring file at either end, instead of spending a keystroke on the invisible blank row between two files.

**Architecture:** The detail pane's cursor is a row index into `DetailRow[]`. Blank separator rows are currently valid cursor positions that draw no cursor mark and are labelled with the *following* file's path. A new pure helper `nearestStop` in `src/tui/rows.ts` says which rows the cursor may occupy; a single `landing()` wrapper in `src/tui/App.tsx` routes every cursor write through it. Blanks are relabelled to the file above them, and `]`/`[` stop at the ends of the diff instead of bouncing.

**Tech Stack:** TypeScript, React + Ink 7 (terminal UI), `bun test`.

## Global Constraints

- Every source file is `.ts`/`.tsx` with full type coverage. No `any`.
- Tests run with `bun test`. Typecheck with `bun run typecheck`. Module-boundary lint with `bun run lint:boundary`.
- **Baseline before any change: 650 tests pass, 0 fail, across 50 files.** No task may reduce the pass count.
- `src/tui/*` may not import from `src/cli/*`. Pure logic lives in `.ts` modules; `.tsx` files render.
- Comments in this codebase explain *why*, in prose, and frequently record the bug a rule exists to prevent. Match that. Do not add comments that restate the code.
- Commit after every task. Do not squash tasks together.

## Ground Truth: the bug, captured

Two files, `src/cache.ts` then `src/store.ts`, one hunk each. Row list:

```
 0  file-header   src/cache.ts
 1  hunk-header   src/cache.ts
 2  diff-line     src/cache.ts     const ttl = 0;
 3  diff-line     src/cache.ts     cache.set(key, value);
 4  blank         src/store.ts     ← the defect
 5  file-header   src/store.ts
 6  hunk-header   src/store.ts
 7  diff-line     src/store.ts     const rows = [];
 8  diff-line     src/store.ts     store.persist(rows);
```

Driving real `ESC [ B` presses through the Ink harness today:

```
--- after 4 DOWN ---              cursor on row 4, the blank
"  ✓ cache.ts  ▸  store.ts"       the file index says store.ts
"   ▍ src/cache.ts"
"        2 +cache.set(key, value);"
"   ▍ src/store.ts"               and there is no ▸ anywhere in the diff body

--- after 5 DOWN ---              cursor on row 5, the header
"  ✓ cache.ts  ▸  store.ts"
" ▸ ▍ src/store.ts"
```

After this plan, 4 DOWN lands on row 5 and prints `▸ ▍ src/store.ts`; row 4 is never a cursor position.

**Useful fact for writing tests:** Ink emits no ANSI colour into the test harness's fake stdout, so `app.frame()` is plain text. Assertions like `toContain('▸ ▍ src/store.ts')` work directly — no stripping helper is needed.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/tui/rows.ts` | Builds and queries the row list. Pure. | Add `nearestStop`. Relabel the blank separator. Stop `nextFileRow`/`prevFileRow` bouncing. |
| `src/tui/App.tsx` | Owns cursor state and dispatch. | Add `landing()`; route all five cursor writes through it; teach `markSeen` to ignore blanks. |
| `src/tui/units.ts` | Builds review units. Pure. | Delete four dead nav helpers. |
| `tests/tui/rows.test.ts` | Unit tests for the row layer. | Add `nearestStop` and blank-attribution tests; fix one mis-named test. |
| `tests/tui/app-input.test.tsx` | Drives the real key path through Ink. | Add the reported bug as a regression test; extend the index-click test. |
| `tests/tui/units.test.ts` | Unit tests for `units.ts`. | Delete the two describe blocks covering the deleted helpers. |

---

### Task 1: `nearestStop` — which rows the cursor may occupy

Pure helper, no consumers yet. Task 3 wires it in.

**Files:**
- Modify: `src/tui/rows.ts` (add after `unitStartRows`, around line 325, before `function seek`)
- Test: `tests/tui/rows.test.ts`

**Interfaces:**
- Consumes: `DetailRow` (already exported from `src/tui/rows.ts`)
- Produces: `export function nearestStop(rows: DetailRow[], index: number, prefer: 1 | -1): number`

- [ ] **Step 1: Write the failing tests**

Add this describe block to `tests/tui/rows.test.ts`, after the existing `describe('navigation', ...)` block. The file already has `rowsOf` and `file` helpers at the top — reuse them, do not redefine them.

```ts
describe('nearestStop', () => {
  // a.ts: 0 header, 1 hunk-header, 2-4 lines. 5 blank. b.ts: 6 header, 7 hunk-header, 8-10 lines.
  const rows = rowsOf([file('a.ts', 1, 3), file('b.ts', 1, 3)]);

  test('leaves a row that is already a place alone', () => {
    expect(nearestStop(rows, 4, 1)).toBe(4);
    expect(nearestStop(rows, 4, -1)).toBe(4);
  });

  test('going down off a file lands on the next file, not the gap', () => {
    expect(rows[5]!.kind).toBe('blank');
    expect(nearestStop(rows, 5, 1)).toBe(6);
    expect(rows[6]!.kind).toBe('file-header');
  });

  test('coming back up lands on the previous file last line, not the gap', () => {
    expect(nearestStop(rows, 5, -1)).toBe(4);
    expect(rows[4]!.kind).toBe('diff-line');
  });

  test('falls back the other way when the preferred direction runs out', () => {
    // A list that ends on the blank: there is nothing below it to land on.
    const truncated = rows.slice(0, 6);
    expect(nearestStop(truncated, 5, 1)).toBe(4);
  });

  test('gives back the index it was handed when nothing is a place', () => {
    const allBlank: DetailRow[] = [{ kind: 'blank', unit: 0, path: 'a.ts' }];
    expect(nearestStop(allBlank, 0, 1)).toBe(0);
    expect(nearestStop([], 3, 1)).toBe(3);
  });
});
```

Add `nearestStop` to the import list at the top of the file (line 3-6). The `DetailRow` type is already imported there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/tui/rows.test.ts`
Expected: FAIL — `nearestStop is not a function` / TypeScript cannot resolve the import.

- [ ] **Step 3: Write the implementation**

In `src/tui/rows.ts`, immediately after `unitStartRows` (ends around line 325) and before `function seek`:

```ts
/**
 * The nearest row the cursor may come to rest on, searching `prefer` first.
 *
 * Blank separators are scenery. They draw no cursor mark, so a cursor parked on
 * one is a cursor the reviewer cannot see — and the file index reads its current
 * file from the row under the cursor, so stepping onto the blank between two
 * files moved the marker at the top of the pane to a file the body was not
 * showing while the marker in the body vanished. One keystroke, spent on a row
 * that is not a place, twice: once to leave the file and once to arrive.
 *
 * The direction of travel is searched first because the two ends are not
 * symmetric under a fixed direction: going down off a file's last line has to
 * reach the *next* header, and coming back up off that header has to reach the
 * previous file's last line. It falls back to the opposite direction, and then
 * to `index` itself, so no caller can be handed a row that does not exist.
 */
export function nearestStop(rows: DetailRow[], index: number, prefer: 1 | -1): number {
  const isPlace = (at: number) => rows[at] !== undefined && rows[at]!.kind !== 'blank';
  if (isPlace(index)) return index;

  for (const dir of [prefer, -prefer] as const) {
    for (let i = index + dir; i >= 0 && i < rows.length; i += dir) {
      if (isPlace(i)) return i;
    }
  }
  return index;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/tui/rows.test.ts`
Expected: PASS, all tests in the file.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/tui/rows.ts tests/tui/rows.test.ts
git commit -m "tui: say which rows the cursor may come to rest on"
```

---

### Task 2: A blank separator reports the file above it

The blank currently carries the *upcoming* file's path, which is why the index marker moves a keystroke early and why clicking a cell in the file index parks the cursor on an invisible row. Relabelling it forces one dependent fix to `markSeen`, in the same task because the change regresses auto-checking without it.

**Files:**
- Modify: `src/tui/rows.ts:188-190` (inside `buildRows`)
- Modify: `src/tui/App.tsx:551-557` (`markSeen`)
- Test: `tests/tui/rows.test.ts`, `tests/tui/app-input.test.tsx:1249`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: no new exports. Behavioural contract later tasks rely on: for a blank row `r`, `r.path` is the path of the file *preceding* it, and `r.unit` is that file's unit index.

- [ ] **Step 1: Write the failing tests**

Add to `tests/tui/rows.test.ts`, inside the existing `describe('buildRows', ...)` block, next to the test named `'carries the path on every row, including the blanks'`:

```ts
  test('the blank between two files belongs to the file above it', () => {
    // The file index reads its current file from the row under the cursor, and
    // an index click resolves a path to the first row carrying it. Labelling
    // the gap with the file it introduces made both point at a row that shows
    // nothing.
    const rows = rowsOf([file('a.ts', 1, 3), file('b.ts', 1, 3)]);
    const blank = rows.findIndex((r) => r.kind === 'blank');
    expect(rows[blank]!.path).toBe('a.ts');
    expect(rows[blank + 1]!.kind).toBe('file-header');
    expect(rows[blank + 1]!.path).toBe('b.ts');
  });

  test('an index click resolves a file to its header, not to the gap above it', () => {
    const rows = rowsOf([file('a.ts', 1, 3), file('b.ts', 1, 3)]);
    expect(rows[rows.findIndex((r) => r.path === 'b.ts')]!.kind).toBe('file-header');
  });
```

Then extend the existing test at `tests/tui/app-input.test.tsx:1249` (`'a click on the file index jumps to that file'`). Replace its two closing assertions with three:

```ts
    const after = app.frame();
    // The view moved off the first file and onto the second — and landed on its
    // header, not on the blank above it, which draws no cursor at all.
    expect(after).toContain('▸ ▍ src/cache.ts');
    expect(after).not.toContain('line 0');
```

Then add a new top-level describe to `tests/tui/app-input.test.tsx`, at the end of the file. It must come after `twoFileMeat` (defined around line 496), and it belongs outside `describe('the mouse', ...)` — it is a keyboard test:

```ts
describe('reading a file through checks it off', () => {
  const DOWN = `${ESC}[B`;

  test('a file earns its check when the cursor reaches its last line', async () => {
    // `markSeen` finds a file's last row to decide it has been read. The blank
    // after a file now carries that file's path, and the cursor cannot land on
    // one — so the last row has to be the last row that is a place.
    const app = mount({ pr: detail, meat: twoFileMeat });
    await delay(60);
    expect(app.frame()).not.toContain('✓ cache.ts');

    for (let i = 0; i < 3; i += 1) await app.press(DOWN);
    expect(app.frame()).toContain('▸✓ cache.ts');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/tui/rows.test.ts tests/tui/app-input.test.tsx`
Expected: FAIL on `'the blank between two files belongs to the file above it'` (receives `'b.ts'`), on `'an index click resolves a file to its header'` (receives `'blank'`), and on the index-click test (frame contains `   ▍ src/cache.ts`, not `▸ ▍ src/cache.ts`).
The `'a file earns its check'` test **passes** at this point — it guards the regression the next step would otherwise introduce.

- [ ] **Step 3: Relabel the blank**

In `src/tui/rows.ts`, inside `buildRows`, replace line 190:

```ts
    if (leadsWithBlank(units, index)) rows.push({ kind: 'blank', unit: index, path });
```

with:

```ts
    // Attributed to the file *above* it, not the one it introduces. The gap
    // renders after that file's content, so it is the file the reviewer sees
    // around it — and both the file index's marker and an index click resolve
    // through a row's path, so the other choice pointed them at a row that
    // draws nothing.
    if (leadsWithBlank(units, index)) {
      rows.push({ kind: 'blank', unit: index - 1, path: units[index - 1]!.file.file.path });
    }
```

`leadsWithBlank` returns `false` for `index === 0`, so `units[index - 1]` is always defined here.

- [ ] **Step 4: Run the tests to see the regression the next step fixes**

Run: `bun test tests/tui/rows.test.ts tests/tui/app-input.test.tsx`
Expected: the three failing tests from Step 2 now PASS. `'a file earns its check when the cursor reaches its last line'` now FAILS — `findLastIndex` finds the trailing blank, so no file is ever marked read.

- [ ] **Step 5: Teach `markSeen` to ignore blanks**

In `src/tui/App.tsx`, replace the body of `markSeen` (line 551-557):

```ts
  function markSeen(row: number) {
    const path = pathAtRow(detailRowList, row);
    if (path === null) return;
    // The last row that is a *place*. The gap after a file carries that file's
    // path and the cursor can never land on it, so counting it would mean no
    // file ever earned its check again.
    const lastRowOfPath = detailRowList.findLastIndex(
      (r) => r.path === path && r.kind !== 'blank',
    );
    if (row < lastRowOfPath) return;
    setReviewed((s) => (s.has(path) ? s : new Set(s).add(path)));
  }
```

Leave the doc comment above `markSeen` (line 545-550) untouched.

- [ ] **Step 6: Run the full suite**

Run: `bun test`
Expected: PASS, no fewer than 650 + 3 tests, 0 fail.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/tui/rows.ts src/tui/App.tsx tests/tui/rows.test.ts tests/tui/app-input.test.tsx
git commit -m "tui: hand the gap between two files to the file above it"
```

---

### Task 3: Every cursor write lands on a place

The payoff. One wrapper, five call sites.

**Files:**
- Modify: `src/tui/App.tsx` — import line 25-26, new `landing()` beside `moveRows` (~line 538), and five call sites: 528, 539, 881, 912, 924
- Test: `tests/tui/app-input.test.tsx`

**Interfaces:**
- Consumes: `nearestStop(rows: DetailRow[], index: number, prefer: 1 | -1): number` from Task 1; the blank-attribution contract from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Add to `tests/tui/app-input.test.tsx` as a new top-level describe, after the `describe('reading a file through checks it off', ...)` block added in Task 2:

```ts
/**
 * The reported bug. Pressing down off the end of a file moved the marker in the
 * file index to the next file while the marker in the diff disappeared, because
 * the cursor was sitting on the blank separator — which draws no cursor. The
 * reviewer read that as "it changed the file and jumped me to the top", and the
 * next press as "back down in the tree listing".
 */
describe('the arrows cross a file boundary in one press', () => {
  const DOWN = `${ESC}[B`;
  const UP = `${ESC}[A`;

  test('down off a file last line lands on the next file header', async () => {
    const app = mount({ pr: detail, meat: twoFileMeat });
    await delay(60);

    // 0 header, 1 hunk-header, 2-3 lines. The fourth press leaves the file.
    for (let i = 0; i < 3; i += 1) await app.press(DOWN);
    expect(app.frame()).toMatch(/▸\s+2 \+cache\.set\(key, value\);/);

    await app.press(DOWN);
    expect(app.frame()).toContain('▸ ▍ src/store.ts');
  });

  test('up off a file header lands on the previous file last line', async () => {
    const app = mount({ pr: detail, meat: twoFileMeat });
    await delay(60);

    for (let i = 0; i < 4; i += 1) await app.press(DOWN);
    expect(app.frame()).toContain('▸ ▍ src/store.ts');

    await app.press(UP);
    expect(app.frame()).toMatch(/▸\s+2 \+cache\.set\(key, value\);/);
    expect(app.frame()).not.toContain('▸ ▍ src/store.ts');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/tui/app-input.test.tsx`
Expected: FAIL. Both tests fail on the `'▸ ▍ src/store.ts'` assertion — after four presses the cursor is on the blank, so the frame carries `   ▍ src/store.ts` and no `▸` anywhere in the diff body.

- [ ] **Step 3: Add `landing()` and route `moveRows` through it**

In `src/tui/App.tsx`, add `nearestStop` to the import from `./rows.js` (the multi-line import at lines 25-26; keep the list alphabetised — it goes between `hunkAtRow` and `nextFileRow`).

Then replace `moveRows` (lines 538-543) with:

```ts
  /**
   * Where a cursor aimed at `row` actually comes to rest.
   *
   * Every write to the row cursor goes through here — keys, wheel, click — so
   * that "a blank separator is not a place" is stated once. There are five
   * writers, and enforcing a rule at five sites is how one of them gets missed.
   */
  function landing(row: number, prefer: 1 | -1): number {
    return nearestStop(detailRowList, clampCursor(row, detailRowList.length), prefer);
  }

  function moveRows(next: number) {
    // The direction of travel, so that stepping off the bottom of a file
    // reaches the next one and stepping off the top reaches the previous one.
    const rested = landing(next, next >= cursor ? 1 : -1);
    setRowCursor(rested);
    setRowScroll((prev) => nextScrollTop(detailRowList.length, detailRows, rested, prev));
    markSeen(rested);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/tui/app-input.test.tsx`
Expected: PASS, both new tests.

- [ ] **Step 5: Route the remaining four writers**

`landing` is a function declaration inside the component, so it is hoisted — the effect below may call it despite appearing earlier in the file.

In `src/tui/App.tsx`, the row-count effect at lines 526-530:

```ts
  useEffect(() => {
    // Prefers upward: this exists to pull a cursor left past the end of a
    // shrunken list back into it.
    const rested = landing(rowCursor, -1);
    setRowCursor(rested);
    setRowScroll((prev) => nextScrollTop(detailRowList.length, detailRows, rested, prev));
  }, [detailRowList.length]);
```

The wheel handler at lines 877-883:

```ts
      const next = scrollBy(
        detailRowList.length, detailRows, cursor, rowScroll, wheel * WHEEL_ROWS,
      );
      setRowScroll(next.scrollTop);
      // `scrollBy` drags the cursor to the nearest row in the new window, which
      // can be a blank. Push it on the way the wheel is already going.
      const rested = landing(next.cursor, wheel);
      setRowCursor(rested);
      markSeen(rested);
      return true;
```

`wheel` is already declared as `-1 | 1` at line 839, so it types as `prefer` directly.

The double-click branch at lines 909-916:

```ts
        const now = { row: hit.index, at: Date.now() };
        if (isDoubleClick(lastClick.current, now)) {
          lastClick.current = null;
          const rested = landing(hit.index, 1);
          setRowCursor(rested);
          markSeen(rested);
          startComment(false, { from: rested, to: rested });
          return true;
        }
```

The single click at lines 922-926 — keep the existing comment about not recentring, it still holds:

```ts
      // Not `moveRows`: the row is already on screen, so recentring the view
      // under the reviewer's own click would be the pane moving for no reason.
      const rested = landing(hit.index, 1);
      setRowCursor(rested);
      markSeen(rested);
      return true;
```

Leave `setRowCursor(0)` at line 428 alone: row 0 of a non-empty diff is always a file header, and an empty diff has no row to land on.

- [ ] **Step 6: Run the full suite**

Run: `bun test`
Expected: PASS, 0 fail.

Run: `bun run typecheck && bun run lint:boundary`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/tui/App.tsx tests/tui/app-input.test.tsx
git commit -m "tui: arrows walk the diff, not the gaps between files"
```

---

### Task 4: `]` and `[` stop at the ends, and the dead nav helpers go

**Files:**
- Modify: `src/tui/rows.ts:342-350` (`nextFileRow`, `prevFileRow`)
- Modify: `src/tui/units.ts:81-113` (delete four functions)
- Test: `tests/tui/rows.test.ts:152` (fix a mis-named test), `tests/tui/app-input.test.tsx`, `tests/tui/units.test.ts:146-204` (delete two describe blocks)

**Interfaces:**
- Consumes: nothing from Tasks 1-3.
- Produces: `nextFileRow(rows, from)` and `prevFileRow(rows, from)` return `from` unchanged when no file header remains in that direction.

- [ ] **Step 1: Write the failing tests**

In `tests/tui/rows.test.ts`, the existing test at line 152 is named `'] on the last file stays in it rather than wrapping to the top'` but asserts the cursor moves to `'b.ts'` — the *previous* file. Replace it entirely:

```ts
  test('] on the last file stays put rather than walking backwards', () => {
    // It used to fall back to the previous header, so ] at the end of the diff
    // went backwards and the next press went forwards — ping-ponging between
    // the last two files. `n` and `p` already hold still; so does this.
    const last = rows.map((r) => r.kind).lastIndexOf('file-header');
    expect(nextFileRow(rows, last)).toBe(last);
  });

  test('[ on the first file stays put rather than snapping to row zero', () => {
    const first = rows.findIndex((r) => r.kind === 'file-header');
    expect(prevFileRow(rows, first)).toBe(first);
    // From inside the first file it still reaches that file's own header.
    expect(prevFileRow(rows, first + 2)).toBe(first);
  });

  test('p walks back through the findings', () => {
    // Inherited from units.test.ts, which owned the only two-finding backward
    // walk until Step 5 deletes its copy of this navigation. The `describe`'s
    // shared `rows` carries one finding, which cannot show a walk.
    const two = rowsOf(
      [file('a.ts', 1, 5), file('b.ts', 1, 5)],
      [finding, { ...finding, id: 'f2', path: 'b.ts' }],
    );
    const first = nextFindingRow(two, 0);
    const second = nextFindingRow(two, first);
    expect(findingAtRow(two, first)?.id).toBe('f1');
    expect(findingAtRow(two, second)?.id).toBe('f2');
    expect(prevFindingRow(two, second)).toBe(first);
  });
```

`finding` is the module-level `VerifiedFinding` at `tests/tui/rows.test.ts:109`; `line: 2` falls inside the hunk `file()` builds for either path.

Add to `tests/tui/app-input.test.tsx`, inside the `describe('the arrows cross a file boundary in one press', ...)` block from Task 3:

```ts
  test('] on the last file leaves the cursor where it is', async () => {
    const app = mount({ pr: detail, meat: twoFileMeat });
    await delay(60);

    for (let i = 0; i < 4; i += 1) await app.press(DOWN);
    expect(app.frame()).toContain('▸ ▍ src/store.ts');

    await app.press(']');
    expect(app.frame()).toContain('▸ ▍ src/store.ts');
    expect(app.frame()).not.toContain('▸ ▍ src/cache.ts');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/tui/rows.test.ts tests/tui/app-input.test.tsx`
Expected: FAIL on all three — `nextFileRow` returns the previous header's index, and `]` moves the cursor back to `src/cache.ts`.

- [ ] **Step 3: Stop the bounce**

In `src/tui/rows.ts`, replace lines 342-350:

```ts
/** Next/previous file header. Falls back to this file's own header at the end,
 *  matching how `]` has always behaved. */
export function nextFileRow(rows: DetailRow[], from: number): number {
  return seek(rows, from, 1, isFileHeader) ?? prevFileRow(rows, from);
}

export function prevFileRow(rows: DetailRow[], from: number): number {
  return seek(rows, from, -1, isFileHeader) ?? 0;
}
```

with:

```ts
/**
 * Next/previous file header, holding still at the ends of the diff.
 *
 * `nextFileRow` used to fall back to the *previous* header when there was no
 * next one, so `]` at the end of the diff walked backwards and the press after
 * it walked forwards, ping-ponging between the last two files. That is the same
 * rule `nextFindingRow` argues for below, and for the same reason: a key that
 * teleports the cursor somewhere the reviewer did not ask for reads as broken.
 */
export function nextFileRow(rows: DetailRow[], from: number): number {
  return seek(rows, from, 1, isFileHeader) ?? from;
}

export function prevFileRow(rows: DetailRow[], from: number): number {
  return seek(rows, from, -1, isFileHeader) ?? from;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/tui/rows.test.ts tests/tui/app-input.test.tsx`
Expected: PASS.

- [ ] **Step 5: Delete the superseded unit-index navigation**

Nothing in `src/` calls these four; the row-based versions in `rows.ts` replaced them, and `nextFileIndex` still carries the bouncing fallback Step 3 just removed. Leaving a second, differently-behaved "next file" in the tree is how this fix gets undone.

In `src/tui/units.ts`, delete lines 81-113 — the whole run from `export function nextFileIndex` through the end of `prevFindingIndex`, including the doc comment above `nextFindingIndex`. The file ends after `buildUnits`.

In `tests/tui/units.test.ts`, delete `describe('file navigation', ...)` (lines 146-171) and `describe('finding navigation', ...)` (lines 173-204). Then replace the import at lines 2-4 with:

```ts
import { buildUnits } from '../../src/tui/units.js';
```

`buildUnits` is the only symbol the file still takes from `units.js`. Every other import stays: the `finding()` helper and the `initTriage` / `TriagedFinding` / `VerifiedFinding` / `MeatFile` / `MeatResult` / `DiffFile` / `Hunk` types are all still used by the describes that remain.

- [ ] **Step 6: Run the full suite**

Run: `bun test`
Expected: PASS, 0 fail. The count drops by the 7 deleted tests and rises by the ones added across Tasks 1-4.

Run: `bun run typecheck && bun run lint:boundary`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/tui/rows.ts src/tui/units.ts tests/tui/rows.test.ts tests/tui/units.test.ts tests/tui/app-input.test.tsx
git commit -m "tui: ] and [ hold still at the ends instead of ping-ponging"
```

---

## Deliberately not tested at the integration level

The wheel path (`App.tsx:881`) is covered by `nearestStop`'s unit tests plus the shared `landing()` funnel, not by its own Ink test. Landing the wheel on a blank needs a fixture tall enough to scroll *and* multi-file, and the resulting test would assert against a scroll offset that any change to the header's height would move. The unit tests pin the behaviour; the funnel is what guarantees the wheel uses it.

## Manual verification

After Task 4, run the real tool against a multi-file pull request and confirm, on the reviewer's own report:

1. Hold ↓ from the top of a file. It steps line by line, and at the file's last line one further press puts `▸` on the next file's header — the `▸` in the file index at the top moves in the same press, never before it.
2. ↑ from a file header puts `▸` back on the previous file's last line in one press.
3. `]` on the last file in the diff does nothing at all.
4. Clicking a cell in the file index puts `▸` on that file's header.
