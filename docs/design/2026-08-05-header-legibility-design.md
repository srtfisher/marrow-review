# marrow — header and hint legibility

**Date:** 2026-08-05
**Status:** approved design, ready for implementation planning
**Size:** small — one afternoon
**Depends on:** nothing. Lands first of three.

## Why

Three separate states of the detail pane are currently indistinguishable from each
other on screen:

1. **The model pass returned nothing** vs **is still running** vs **never ran.** Only
   the *failed* case says anything (`src/tui/App.tsx:947`). A reviewer opening a pull
   request with no findings sees exactly what they'd see if the pass had silently
   produced zero results — which is how "I don't see any findings" happens on a tool
   that is, in fact, placing findings correctly (`src/tui/units.ts:52`).
2. **`d` on a diff nothing was cut from.** The view toggles and nothing visibly
   changes. `src/tui/components/Detail.tsx` already carries a comment worrying about
   exactly this, and solves half of it by naming the view — but the numbers beside the
   name don't move, so the key still reads as broken.
3. **`d` exists at all.** It is in the hint bar (`src/tui/hints.ts:104`) but sits
   second-to-last, and `fitHints` drops from the back while protecting `?` — so `d` is
   the *first* hint cut on a narrow terminal, i.e. exactly when a reviewer most needs
   to be told the diff they're reading is abridged.

None of this is a bug in the sense of wrong output. It is the pane declining to say
what it knows, which for a tool whose thesis is "nothing is ever hidden" is the same
failure wearing different clothes.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where `+N −M` goes | The gauge row, after the kept-lines count | It is a statement about the same thing the gauge is: how much diff there is. |
| Which numbers it shows | The **current view's** — kept in meat, total in full diff | This is what makes `d` visibly do something. A static total would toggle beside a changing label and read as a stale number. |
| Where the finding count goes | The **meta row**, not the gauge row | The gauge row is already near truncation at 80 columns. The meta row already carries the model name; findings are what that model produced. |
| Finding count color | `agent` magenta | The token reserved for model-authored content. A finding count is a fact about the model's output. |
| `d` hint priority | Ahead of `]`, `!`, `m` | Losing `d` costs the reviewer the knowledge that the diff is abridged at all. Losing `m` costs a checkbox. |
| `n`/`p` hints | Shown only when findings exist and the cursor is not on one | A hint for navigating to something that isn't there is noise, and the bar's budget is six verbs. |

## Design

### `MeatResult` gains four counts

```ts
export interface MeatResult {
  // …existing…
  keptAdditions: number;
  keptDeletions: number;
  totalAdditions: number;
  totalDeletions: number;
}
```

Computed in the loop that already computes `keptLines` (`src/core/meat/index.ts:151`).
The existing `changedLineCount(hunk)` helper is generalized:

```ts
function changedLineCounts(hunk: Hunk): { additions: number; deletions: number }
```

with `changedLineCount` derived from it as the sum, so there is one place that decides
what "a changed line" means and the two numbers can never disagree with the total.

### The gauge row

```
▇▇▇▁▁▁▁▁▁▁  kept 124/1040 lines · +98 −26 · 8/31 files · meat
```

and after `d`:

```
▇▇▇▇▇▇▇▇▇▇  kept 1040/1040 lines · +812 −228 · 31/31 files · full diff
```

`+98` in `add` green, `−26` in `del` red — the same two tokens every diff line uses,
carrying the same meaning. The minus is U+2212, not a hyphen, so it optically matches
the `+` in width and weight.

Unchanged: the gauge itself, the unclassified-hunk warning, and the truncation
behavior (`wrap="truncate"`).

### The meta row

```
#546 · octocat · main ← feat/x · claude-opus-5 · 3 findings  ● 2 staged
```

The findings segment renders one of four things, from `findingsStatus`:

| State | Renders | Style |
|---|---|---|
| `running` | `findings…` | `muted` |
| `ok`, count > 0 | `3 findings` | `agent` |
| `ok`, count 0 | `no findings` | `muted` |
| `failed` | *nothing here* — the existing red banner covers it | — |
| `idle` | nothing | — |

`ok` with zero findings is deliberately not silent. A clean pull request and a pass
that returned nothing look the same to the reviewer, and only one of them is good news.

The count is of **shown** findings (`shownFindings`, which respects the `v` refuted
toggle), so the number always matches what `n` will actually walk through.

### The hint bar

`detailHints` takes a third argument:

```ts
export function detailHints(
  row: DetailRow | undefined,
  fullDiff: boolean,
  findingCount: number,
): Hint[]
```

Push order becomes — first is most protected, since `fitHints` cuts from the back:

```
↑↓ move
<contextual verbs: a/x/e on a finding, else C/S>
n  next finding          ← only when findingCount > 0 and cursor is not on a finding
d  full diff / meat only
!  approve / request changes
]  next file
m  mark reviewed
?  all keys
```

`p` is not given its own hint. It is `n`'s inverse, the help overlay documents it, and
the bar's whole discipline is that six verbs get read and twelve do not.

The contextual verbs are `C`/`S` here because that is what they are when this lands.
The inline-commenting spec renames them to `c`/`s`; nothing in this change depends on
which letters they are.

## Testing

`tests/tui/hints.test.ts` and `tests/tui/detail.test.tsx` already exist and cover the
shapes being changed. New cases:

- `changedLineCounts` on a hunk with adds, dels, and context — and that the two
  numbers sum to `changedLineCount`.
- `computeMeat` totals: kept counts ≤ total counts, and total counts equal the sum of
  every file's `additions`/`deletions` from the parser.
- The gauge row renders the kept numbers in meat and the total numbers in full diff —
  the assertion that `d` changes something.
- All four finding states render distinguishable text.
- `fitHints` at a width that admits exactly five hints keeps `d` and drops `m`.

## Out of scope

- Per-file `+/−` counts in the file index. The index is a map of *where*, not *how
  much*, and 31 cells each carrying two numbers is a table, not a map.
- Any change to how findings are produced or placed. If the count reads `no findings`
  on a pull request that plainly has bugs, that is a separate investigation — but it
  is one this change makes possible to start.
