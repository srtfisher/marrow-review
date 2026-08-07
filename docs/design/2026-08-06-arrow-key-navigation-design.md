# marrow — ↑/↓ that walk the diff

**Date:** 2026-08-06
**Status:** approved design, ready for implementation planning
**Size:** small — one afternoon
**Depends on:** nothing.

## Why

The reviewer's report: *"I hit the down arrow and it changed the file. It jumped me to
the top, and then I hit it again and I was back down in the tree listing."* The thing
that jumped was the `▸` in the file index at the top of the detail pane.

It reproduces on any diff with more than one file. Walking the row list of a five-file
change shaped like the reported one:

```
 12 diff-line        packages/x/routes/webhooks.php   ← last line of the file you're reading
 13 blank            packages/x/SKILL.md              ← ↓ lands here
 14 file-header      packages/x/SKILL.md              ← ↓ again lands here
```

Row 13 is the separator between two files. Two flaws meet on it:

1. **It belongs to the wrong file.** `leadsWithBlank` (`src/tui/rows.ts:163`) emits the
   blank *before* a file header, and `buildRows` (`src/tui/rows.ts:190`) stamps it with
   the upcoming unit's path. The instant the cursor steps onto it, `Detail.tsx:318`
   (`rows[cursor]?.path`) reports the next file and the `▸` in the top grid moves to a
   different cell.
2. **It draws no cursor.** `renderRow`'s blank case (`src/tui/components/Detail.tsx:79`)
   returns `<Text> </Text>` — no `cursorMark`. So the `▸` in the diff body vanishes.

One keypress therefore moves the marker at the top of the pane to a different file while
the marker in the body disappears. That is the "it changed the file and jumped me to the
top." The following press puts the body cursor back, on the new file's header — "back
down in the tree listing." A keystroke was spent on a row that is not a place.

The same blank breaks two other routes to the cursor:

- **Clicking a cell in the top grid.** `App.tsx:932` resolves a path to
  `findIndex(r => r.path === path)`, which finds the *blank* before that file's header,
  not the header. Clicking a file in the index parks the cursor on an invisible row.
- **The wheel.** `scrollBy` drags the cursor to the nearest visible row
  (`src/tui/viewport.ts:76`), which can be a blank.

Separately, and noticed while reading the same file: `nextFileRow`
(`src/tui/rows.ts:344`) falls back to `prevFileRow` when there is no next file, so `]`
at the end of the diff walks *backwards*, and pressing it again walks forwards —
ping-ponging between the last two files forever. `nextFindingRow`, twelve lines below,
already argues in its own comment for the opposite rule and follows it.

## What the reviewer asked for

> "I really just want the up/down arrows to navigate the files as I go through them and
> the lines inside it."

↑/↓ step through the lines of a file; at either end of one they step into the
neighbouring file. Nothing else.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| What a blank row is | Scenery, never a cursor position | It is not a place. `unitStartRows` (`rows.ts:318`) already skips blanks; this states a rule the file half-holds. |
| Where the rule is enforced | One `landing()` wrapper in `App.tsx`, used by every cursor writer | There are four of them (keyboard, wheel, click, double-click) plus a clamping effect. Enforcing it at each site is how one gets missed. |
| Which way `landing` scans | The direction of travel, then the other way | ↓ off a file's last line must reach the *next* header, and ↑ off a header must reach the *previous* last line. A fixed direction gets one of the two wrong. |
| Which file a blank reports | The one **above** it | It renders after that file's content, so that is the file the reviewer sees around it. Also makes an index click land on the header. |
| `]` / `[` at the ends | Stay put | Same rule `nextFindingRow` already follows. Bouncing backwards is indistinguishable from a misfire. |
| Dead unit-index nav helpers | Delete | Superseded by the row-based versions and encoding the behavior being removed. |

## Design

### 1. Blank separators stop being cursor stops

A new pure helper in `src/tui/rows.ts`:

```ts
/**
 * The nearest row the cursor may occupy, searching `prefer` first.
 *
 * Blank separators are scenery: they render no cursor mark, so a cursor parked
 * on one is a cursor the reviewer cannot see. Landing on one costs a keystroke
 * and moves the file index's marker to a file the body is not showing.
 *
 * Falls back to the opposite direction, then to `index` itself, so a caller can
 * never be handed a row that does not exist.
 */
export function nearestStop(rows: DetailRow[], index: number, prefer: 1 | -1): number
```

`App.tsx` grows one wrapper and routes every cursor write through it:

```ts
/** Where a cursor aimed at `row` actually comes to rest. */
function landing(row: number, prefer: 1 | -1): number {
  return nearestStop(detailRowList, clampCursor(row, detailRowList.length), prefer);
}
```

| Call site | Direction passed |
|---|---|
| `moveRows(next)` — `j`/`k`/↑/↓/`ctrl-d`/`ctrl-u`/`]`/`[`/`n`/`p` | `next >= cursor ? 1 : -1` |
| Wheel, `App.tsx:881` | `1` on wheel-down, `-1` on wheel-up |
| Click, `App.tsx:924` | `1` |
| Double-click, `App.tsx:912` | `1` |
| Row-count effect, `App.tsx:528` | `-1` — it exists to pull the cursor back into range |

The wheel and click paths keep the scroll behavior they have; `landing` resolves an
index and nothing else. The comment at `App.tsx:922` about not recentring under the
reviewer's own click still holds and stays.

Result: ↓ from a file's last line lands on the next file's header. ↑ from a header lands
on the previous file's last line. Symmetric, one press, one place, and the `▸` in the
grid and the `▸` in the body move together because they are reading the same row.

### 2. A blank reports the file above it

`buildRows` stamps the separator with the preceding unit's path rather than the upcoming
one. Load-bearing even given §1: the wheel and the mouse can still put the cursor there,
and it is what makes an index click land on a header.

One dependent fix. `markSeen` (`App.tsx:551`) finds a file's last row with
`findLastIndex(r => r.path === path)`, which would now find the trailing blank — a row
the cursor can no longer reach — so no file would ever auto-check again. It must ignore
blanks when locating that last row.

### 3. `]` and `[` stop at the ends

`nextFileRow` and `prevFileRow` return `from` when no header remains in that direction,
replacing the `?? prevFileRow(...)` bounce and the `?? 0` snap. The doc comment on
`nextFileRow` documents the old fallback and goes with it.

`nextFileIndex`, `prevFileIndex`, `nextFindingIndex` and `prevFindingIndex` are deleted
from `src/tui/units.ts` along with their tests. Nothing in `src/` calls them; the
row-based versions in `rows.ts` replaced them, and `nextFileIndex` still carries the
bouncing fallback this section removes.

## Testing

**`tests/tui/rows.test.ts`**

- `nearestStop` returns `index` unchanged when the row is already a stop.
- `nearestStop` skips a run of blanks in the preferred direction.
- `nearestStop` falls back to the opposite direction when the preferred one runs out.
- `nearestStop` returns `index` when the list holds no stop at all.
- The blank before a file header carries the *preceding* file's path.
- `nextFileRow` at the last file returns `from`.
- `prevFileRow` at the first file returns `from`.
- `nextFileRow`/`prevFileRow` still cross to the neighbouring header from mid-file.

**`tests/tui/app-input.test.tsx`** — the reported bug, driven through the real key path:

- One ↓ from a file's last line puts the cursor mark on the next file's header, not on
  an empty row.
- One ↑ from a file header puts the cursor mark on the previous file's last line.
- `]` on the last file leaves the cursor where it was.
- Clicking a cell in the top file index lands the cursor on that file's header.
- A file still earns its `✓` when ↓ carries the cursor through its last line.

## Out of scope

- Any change to what ↑/↓ do *inside* a file. Hunk headers and dropped-summary rows stay
  cursor stops; they are places, and `o`, `c` and `i` all act on them.
- Wrapping `]`/`[` around the ends of the diff.
- The file index grid's own layout or ordering.
