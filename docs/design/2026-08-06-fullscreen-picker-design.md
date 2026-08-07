# marrow — the picker becomes the app

**Date:** 2026-08-06
**Status:** approved design, ready for implementation planning
**Size:** medium — a day, mostly TUI
**Depends on:** nothing. No `src/core` changes.

## Why

Three complaints from real use, all about the same seam:

1. **PR titles are unreadable.** The sidebar is 32 columns (`theme.layout.sidebarWidth`,
   `src/tui/theme.ts:48`) and truncates every title of consequence. "Resolve settings
   pages…" identifies nothing; the title is the one field a reviewer chooses by.
2. **You can leave a review but never return to it.** `esc` from the review sets
   `mode = 'list'` and keeps the PR loaded (`App.tsx:1150-1158`), but the only way
   forward from the list is `enter`, and `enter` calls `onOpenPr` — which nulls
   everything and refetches (`src/cli.tsx:292-300`), re-running the meat pass and losing
   the scroll position, the cursor, and the reviewed checkmarks. The state survives the
   trip; the UI provides no door back to it.
3. **Startup doesn't feel like an app starting.** `runTui` awaits the initial
   `listPulls` *before* entering the alternate screen or rendering anything
   (`src/cli.tsx:200`), so `marrow` sits silent in the raw terminal until GitHub
   answers, then snaps a two-pane layout onto the screen.

The sidebar was designed for a job it no longer has. Once a PR is open the review is
already full-screen (`reviewing` removes the pane, `App.tsx:343-348`) — the sidebar
exists only while choosing, and while choosing there is nothing else on screen worth
sharing the width with. The `Welcome` panel exists purely to occupy the other pane.
Both dissolve into one full-screen picker.

## What was asked for

> "You can't read the full PR name most of the time. It doesn't need to be a sidebar
> either because once you go to the sidebar you can't go back to the review. Make a
> better UI for searching the PRs and then make the review full screen. When leaving
> the review, add an are-you-sure step. I want it to feel like an app when you first
> start it up."

Settled in discussion:

- The picker is **search-first**: a live filter input is always active, fzf-shaped.
- Leaving a review keeps it **warm** — `esc` from the picker lands back in it exactly
  where it was; only opening a *different* PR replaces it.
- The leave confirm fires on **every** `esc` from the review.
- Startup gets **both** a centered launch screen and a persistent one-row app chrome.
- The ASCII banner survives — it moves from the `Welcome` box to the launch screen and
  the top of the picker.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Sidebar and `Welcome` | Deleted, replaced by one full-screen `PrPicker` | The sidebar's 32 columns exist only when nothing competes for them; a pane split with no second occupant is chrome. |
| `list` and `search` modes | Merged into one `picker` mode | A search-first picker has no non-searching state; two modes for one screen is where the `esc` semantics bugs lived. |
| Typing in the picker | Every printable character edits the filter | The letters are the search UI. `j/k`, `q`, `1 2 3`, `/`, `?`, `R` stop being bindings *in the picker only*. |
| Movement / open / filter | `↑`/`↓` (+ `ctrl-n`/`ctrl-p`), `enter`, `tab` cycles open → review-requested → all | The only keys a live input leaves free. Digits now search — `#546` must be typeable. |
| Refresh in the picker | `ctrl-r` | `R` is filter text now. `R` stays in the review. |
| Help from the picker | None — the hint bar carries every picker binding | The picker has five bindings; an overlay to list five things is a joke. `?` is filter text. The help overlay (from the review) still documents the picker group. |
| Title truncation | Titles get up to **two computed rows**, then truncate | Unreadable titles were the original complaint. The wrap is computed in the pure layout module, so the "no row may ever wrap" rule keeps its real target: Ink wrapping silently breaking row math. |
| Warm review | PR data and all per-PR UI state stay loaded when `mode` leaves `detail`; `esc` in the picker returns to it; `enter` on the warm PR returns instead of re-opening | The state already survives (only the `openNumber` effect resets it, `App.tsx:424-433`); this adds the missing door. |
| Replacing the warm review | No second confirm | Leaving it was already confirmed, and drafts are written through to disk (`App.tsx:515-520`). Two prompts for one decision is nagging. |
| Leave confirm shape | Status-bar takeover, `pending` yellow, like `confirmQuit` (`App.tsx:283`, `999-1010`, `1294-1298`) | Nothing is destroyed, so no `danger`; taking over the status row means the layout never shifts under the question. |
| Launch screen | Render first, fetch after; centered banner + tagline + repo + spinner; errors land in the same frame | The app should *start*, then load. Today it loads, then starts. |
| App chrome | One row + rule on picker, review, help, submit, chat — not on the launch frame | The frame *is* the brand moment; a header saying "marrow" above a banner saying "marrow" is a duplicate. The design system already sanctions a rule below a header. |
| Row budget | `bodyHeight = rows - 4` (chrome + rule + hrule + status bar) | One place; every shared layout function reads it. |
| Layout arithmetic | New pure `picker.ts` beside `PrPicker.tsx` | Same discipline as `fileindex.ts`/`viewport.ts`: renderer and movement math read the same functions, or a cursor points at the wrong PR. |

## Design

### 1. Launch: render, then load

`runTui` (`src/cli.tsx:195`) stops awaiting `listPulls` before `render`. New order:
enter the alternate screen, render immediately with `prs: null` (loading), fire the
fetch, rerender on arrival. `<App>` gains a tri-state list — `null` = fetching,
`PullRequestSummary[]` = loaded — and a `listError: string | null`.

While `prs === null` — and whenever a PR is opening with nothing else on screen — `App`
renders the **launch frame**, a new `Launch.tsx` component: banner, tagline,
`owner/repo`, and a body slot, all centered vertically and horizontally. No chrome row.
The body slot holds a spinner line (`⣾ fetching open pull requests…`) during the list
fetch; the braille spinner reuses the frames `LoadingSteps` already uses.

- Fetch fails → the spinner line becomes the error in `danger`, with
  `r retry · q quit` beneath it. No filter input exists on this frame, so `r`/`q` are
  free. Retry re-runs the fetch and restores the spinner.
- `marrow 42` → `openPr` fires immediately (`src/cli.tsx:432` today), and the same
  centered frame hosts the existing `LoadingSteps` stages in its body slot instead of
  the spinner. The picker never appears until the reviewer leaves the review.
  (Opening a PR *from* the picker keeps `LoadingSteps` where the reviewer already is:
  the steps replace the entry region, the filter line goes quiet until the load
  resolves.)
- List arrives → the frame settles into the picker: banner docks to the top, chrome
  appears, the filter input activates.

### 2. The chrome row

The first row of every settled screen, above a dim horizontal rule:

```
 marrow · octocat/webapp · open                    reviewing #546
─────────────────────────────────────────────────────────────────
```

Left: app name, repo label, active server-side filter (`open` / `needs my review` /
`all`). Right: `reviewing #N` — only rendered when a warm review exists *and* the
current screen is not that review; in the review itself the title block two rows down
already says it, and saying it twice on one screen is noise. Truncates from the right
side first on narrow terminals; the left side truncates the repo label, never the app
name.

A new pure `chrome.ts` computes the two segments for a width; `App` renders the row
once above the body for `picker`/`detail`, and the full-screen takeovers (`Help`,
`SubmitScreen`, chat) get `height = rows - 2` and render below the same row.
`bodyHeight` becomes `rows - 4` (`App.tsx:383` today).

### 3. The picker

`PrList.tsx` and `Welcome.tsx` are deleted. `PrPicker.tsx` renders full-width:

```
 marrow · octocat/webapp · open                    reviewing #546
─────────────────────────────────────────────────────────────────

   █▄ ▄█ ▄▀▀▄ █▀▀▄ █▀▀▄ ▄▀▀▄ █   █
   █ ▀ █ █▄▄█ █▄▄▀ █▄▄▀ █  █ █ ▄ █
   █   █ █  █ █ ▀▄ █ ▀▄ ▀▄▄▀ █▀ ▀█
   a large diff, abridged to what carries meaning

 filter › settings_                                      3 of 12

 ❯ #546 Resolve settings pages from packages via a namespace
       prefix
     octocat · 3h ago · ● reviewing

   #544 Cache the audience lookup on the settings dashboard
     hubot · 3h ago

   #521 Settings export omits disabled toggles
     octocat · 2d ago
─────────────────────────────────────────────────────────────────
 ↑↓ move   ⏎ review   ⇥ filter   ctrl-r refresh   esc back to #546
```

Top to bottom: banner + tagline (dropped first, as a block, when the terminal is too
short to show at least three entries alongside them — never clipped mid-glyph), a
blank row, the filter line, a blank row, entries, position indicator when the list
overflows.

**The filter line.** `filter › ` in `structure` cyan, the query, a cursor block.
Right-aligned on the same row: `N of M` when the query narrows, plain `M` otherwise —
this replaces the old `Open · 3` pane header; the chrome row already names the filter.
Matching reuses `matchesQuery`/`filterPrs` (`src/tui/search.ts`) unchanged: substring
over title, author, and number, deliberately not fuzzy. The double `filterPrs` call
(`App.tsx:309` and `PrList.tsx:68`) collapses to one — `App` filters, `PrPicker`
receives the visible list.

**Entries.** Marker `❯ ` in the accent color plus bold title on the selected row —
never reverse video. Title takes one or two rows as its length requires at the current
width, wrapped at word boundaries by the layout module; past two rows it truncates
with `…`. Meta row beneath in `muted`: `author · relative time`, plus
`· ● reviewing` on the warm PR's entry. Blank row after each entry. Entry height is
therefore 3 or 4 rows, decided by `picker.ts`, and every consumer — renderer, scroll
clamp, hit test — reads the same answer.

**Empty states** (none optional): `No pull requests.`, `No match for "query".` — both
centered in the entry region, the filter line still live above them.

**Keys.**

| Key | Effect |
|---|---|
| any printable | append to the query; `backspace` deletes |
| `↑` / `↓`, `ctrl-p` / `ctrl-n` | move the cursor |
| `enter` | open the PR under the cursor — or return to it if it is the warm one |
| `tab` | cycle the server-side filter; refetch (existing `changeFilter`, `src/cli.tsx:389`) |
| `ctrl-r` | refetch the list (existing `refresh`) |
| `esc` | query non-empty → clear it; else warm review → return to it; else quit (through the existing unsaved-work confirm) |
| `ctrl-c` | hard exit, unchanged |
| wheel | scroll the list; click aims, click again opens (existing two-click pattern, `App.tsx:869-889`) |

`hitList` in `src/tui/hittest.ts` is replaced by a hit function in `picker.ts` that
understands variable-height entries and the banner offset.

### 4. Modes and the keymap

`Mode` (`src/tui/keymap.ts:3`) becomes
`'picker' | 'detail' | 'comment' | 'submit' | 'help' | 'chat'` — `list` and `search`
collapse into `picker`. `resolveAction` treats `picker` like the text-entry modes: it
returns only `back` on `escape` (`keymap.ts:140-142`); everything else the picker does
is handled by a dedicated inline handler in `App`'s `useInput`, the way `search` is
today (`App.tsx:1012-1022`), because "every printable character is data" is exactly
the property those modes encode.

`KEY_HELP`'s `list` group (`keymap.ts:103-105`) is rewritten to the picker bindings —
`type to filter`, `↑ ↓ move`, `enter`, `tab`, `ctrl-r`, `esc` — still shown in the
help overlay opened from the review. The `j / k`, `wheel`, `R`, `?`, `q` entries drop
their `list` mode tag.

Mouse handling gains nothing new: `confirmLeave` suppresses it exactly as
`confirmQuit` does (`App.tsx:992-994`).

### 5. The warm review

Two additions, no new state:

- **The door back.** `esc` in the picker with an empty query: if `props.pr !== null
  && props.meat !== null`, `setMode('detail')`. Everything the review needs is still
  in `App`'s state — only the `openNumber` effect resets it (`App.tsx:424-433`), and
  that effect has not run.
- **The short-circuit.** `enter` in the picker on the warm PR
  (`selected.number === props.pr?.number` with `meat` loaded) sets `mode` to `detail`
  instead of calling `onOpenPr`. Opening any other PR goes through `openPr`
  unchanged, which replaces the warm review — deliberately unguarded; the confirm
  already happened on the way out, and the draft is on disk.

The picker's hint bar says `esc back to #546` when a review is warm; the entry carries
`● reviewing`.

### 6. Leaving the review asks

New `confirmLeave: boolean` state alongside `confirmQuit` (`App.tsx:283`). Every `esc`
resolved from `detail` that would today switch to the list first checks: selection or
overlay to clear → clear it (unchanged); otherwise set `confirmLeave` instead of
switching. While up, the status row reads, in `pending`:

```
 leave this review? it stays warm — ⏎ leave · esc stay
```

`enter` → `setMode('picker')`, clear the flag. `esc` → clear the flag, stay. Any other
key is swallowed, as `confirmQuit` does. `q` from the review keeps its existing,
separate quit confirm — quitting and leaving are different verbs and keep different
questions.

### 7. What is deleted

- `src/tui/components/PrList.tsx`, `src/tui/components/Welcome.tsx`, and their tests.
- `hitList` from `hittest.ts`.
- `theme.layout.sidebarWidth` and every `reviewing ? … : sidebarWidth + …` width
  branch (`App.tsx:345-348`, `414`) — the detail pane is always `columns - 2`.
- The `search` mode, its inline handler, and the `/` binding.
- The `1`/`2`/`3` filter actions (`keymap.ts:112-116`, `181-182`).

## Testing

**`tests/tui/picker.test.ts`** — the pure module:

- An entry whose title fits one row is 3 rows tall; one that needs two is 4; one that
  needs three truncates to two rows ending in `…`.
- Title wrap breaks at a word boundary, not mid-word, at the row's width.
- The banner block drops exactly when fewer than three entries would fit beside it,
  and drops whole — no partial banner.
- Scroll clamping keeps the cursor visible across mixed 3- and 4-row entries.
- Hit-testing resolves a click to the right entry with the banner shown and with it
  dropped; a click on a blank separator row resolves to no entry.
- The chrome segments truncate the right side first, then the repo label, never the
  app name.

**`tests/tui/prpicker.test.tsx`** — rendering: filter line with count, `N of M` under
a query, selected marker, `● reviewing` on the warm entry, both empty states.

**`tests/tui/launch.test.tsx`** — the launch frame: centered banner + spinner during
the fetch, the error state with its `r retry · q quit` hint, `LoadingSteps` in the
body slot for a direct `marrow 42` open.

**`tests/tui/app-input.test.tsx`** — the flows, through the real key path:

- Typing `settings` in the picker narrows the list; `backspace` restores it; digits
  filter (typing `546` finds `#546`) rather than switching the server-side filter.
- `tab` calls `onFilter` with the next filter in the cycle.
- `esc` with a query clears the query and keeps the picker; a second `esc` with a warm
  review returns to `detail` with the cursor, scroll, and reviewed set intact.
- `enter` on the warm PR does **not** call `onOpenPr`; `enter` on a different PR does.
- `esc` from the review shows the leave confirm; `enter` lands in the picker; `esc`
  stays in the review; a stray key does nothing.
- `q` from the review still routes to the quit confirm, not the leave confirm.
- `ctrl-r` in the picker calls `onRefresh`; `r` alone appends to the query.
- With `prs === null`, keys other than `q`/`r`/`ctrl-c` do nothing (no filter input on
  the launch frame).

**`src/cli.tsx`** — covered by its existing seam: `render` is called before
`listPulls` resolves (fetch no longer blocks first paint).

## Documentation

- `.interface-design/system.md` gets an appended revision: the sidebar's retirement
  and why (truncation, no return path, a pane split with no second occupant), the
  two-computed-rows title amendment to "no row may ever wrap", the chrome row, and
  the launch frame. The "Rejected defaults" list gains: *a sidebar for a list that is
  the only thing on screen*.
- README: the "What it looks like" picker figure, the keys table (`/` and `1 2 3` out;
  type-to-filter, `tab`, `ctrl-r` in), and a line on the launch screen.

## Out of scope

- Fuzzy matching. The substring search is deliberate (`search.ts`) and unchanged.
- More than one warm review. One is the model; a second would need a tab strip.
- Draft indicators (`●` on PRs with saved drafts) in the picker — needs a store
  lookup per row; a separate, later feature if wanted.
- Any change to the review screen's own layout beyond the chrome row and `rows - 4`.
- Responsive behavior below ~50 columns (the old spec's collapse idea stays dead).
