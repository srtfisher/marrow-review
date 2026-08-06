# marrow — inline commenting

**Date:** 2026-08-05
**Status:** approved design, ready for implementation planning
**Size:** large — the main build of the three
**Depends on:** nothing structurally. Lands second.

## Why

The north star, stated plainly because it settles most of the small decisions below:
**GitHub's web code review UI, in the terminal, with meat cutting the noise and the
model finding the bugs.** Where a question here has no obvious answer, the answer is
whatever github.com/pull/N/files does.

Measured against that, commenting is the weakest part of the app today:

| GitHub does | marrow does |
|---|---|
| Drag the gutter, or click then shift-click, to select a range | Nothing. `rowCursor` (`App.tsx:206`) is one row index. |
| Double-click a line to comment on it | Nothing. `handleMouse` (`App.tsx:695`) only moves the cursor. |
| Compose in a box wedged between the diff rows, code still visible above and below | `mode === 'comment'` returns `<CommentEditor>` as the **entire screen**. The diff vanishes. |
| A multi-line textarea | A one-line `ink-text-input`. |
| Pre-fill a suggestion with the lines being replaced | Nothing. |
| The saved comment stays in the diff under its lines | Invisible. Only a count in the header. |

The parts *below* the UI are already ready. `CommentAnchor.startLine` and
`StagedComment.startLine` exist, `findAnchorProblems` validates every line in a range
(`src/core/review/anchors.ts:56`), and `buildReviewPayload` emits `start_line` and
`start_side` (`src/core/review/payload.ts:68`). The only reason no comment has ever had
a range is that `saveComment` hardcodes `startLine: null` (`App.tsx:629`). This is a
UI-shaped hole in a stack that is otherwise finished.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Range selection | `V` visual-line mode, plus shift-click and drag | Keyboard and mouse reach the same thing. This is a keyboard tool; a range only a mouse could make would be unreachable over ssh. |
| Keys | `c` comment, `s` suggest, both lowercase | User's call. `C`/`S` are removed rather than aliased — two ways to do one thing is a help overlay nobody finishes reading. |
| `s` collision | Context-sensitive | `s` already means "send this finding as a suggestion" on a finding row. Every key in this app acts on what is under the cursor; this is that rule, not an exception to it. |
| Composer placement | Rows spliced into the diff row list | The viewport windows on `DetailRow[]`. Anything that is not a row cannot be scrolled past, and the composer must be scrollable — it can be taller than the terminal. |
| Text buffer | A pure module, `src/tui/textarea.ts` | Editing logic tested without a terminal. The component becomes a renderer plus a key dispatch table. |
| Save key | `ctrl-d` | `ctrl-s` is XOFF. On a terminal that has not disabled flow control it freezes the session, and the reviewer's only clue is that the app stopped responding. |
| Mouse mode | `1002`, up from `1000` | Needed for drag. See the correction below. |
| Suggestion body | The fence typed literally into the body | Collapses `c` and `s` into one code path. See *The simplification* below. |
| Staged comments | Rendered inline under their anchor | Without this, the diff is not where your review lives, and "looks like GitHub" is half-done. |

## Design

### 1. Selection

One new piece of state:

```ts
const [selectAnchor, setSelectAnchor] = useState<number | null>(null);
```

A **row** index, matching `rowCursor`. When non-null the selection is
`[min(selectAnchor, cursor), max(selectAnchor, cursor)]` — so it grows in either
direction from where `V` was pressed, which is what vim does and what a drag does.

- `V` sets it to `cursor`, or clears it if already set.
- `esc` clears it, before falling through to the existing `back` action.
- `j`/`k`/arrows/`ctrl-d`/`ctrl-u` move the cursor and the range follows.
- Saving or cancelling a comment clears it.

### 2. Rows to GitHub's terms

A new pure function in `src/tui/rows.ts`, sitting beside `anchorAtRow`:

```ts
export function rangeAnchor(
  rows: DetailRow[],
  from: number,
  to: number,
): CommentAnchor | null
```

Rules, in order:

1. Take the `diff-line` rows in `[from, to]`. Non-diff rows in the range (blanks, hunk
   headers, findings) are ignored rather than rejected — a selection that happens to
   sweep across a hunk boundary is a reasonable thing to have done.
2. Clamp to one file: keep only rows whose `path` matches the first kept row's. GitHub
   has no cross-file comment.
3. Choose a side. Prefer `RIGHT` — the lines with a `newLine`. If none of the selected
   lines exist in the post-image (a pure deletion block), use `LEFT` with `oldLine`.
   A range that spans both can only anchor to one, and `RIGHT` is what a reviewer
   means when they sweep across a replacement.
4. `line` = max of the chosen side's numbers, `startLine` = min, or `null` when they
   are equal — which `payload.ts:68` already normalizes back to a single-line comment.
5. Return `null` when no diff-line rows survive, and let the caller fall back to the
   existing `anchorAtRow`, which degrades a file header or a finding row to its hunk.

New line numbers are contiguous within a hunk regardless of interleaved deletions, so
a `RIGHT` range never contains a gap. `findAnchorProblems` verifies this anyway; it
already walks every line in the range.

### 3. Mouse

**A correction to the existing code.** `src/tui/mouse.ts:16` rejects `1002` and `1003`
together as too expensive, reasoning that motion events arrive continuously and Ink
repaints on input. That is true of `1003` (report all motion) and false of `1002`
(report motion only while a button is held). An idle window under `1002` generates
nothing at all. The comment gets corrected along with the constant:

```ts
export const MOUSE_ENABLE  = '\u001B[?1002h\u001B[?1006h';
export const MOUSE_DISABLE = '\u001B[?1006l\u001B[?1002l';
```

`parseMouse` gains `'drag'` as a `MouseAction`, detected by the motion bit (`code & 32`)
on a press-form report. `MouseReport.button` still names which button is held.

In `handleMouse`, on a `diff-row` hit:

| Gesture | Effect |
|---|---|
| left press | Move the cursor. Clear any selection. *(unchanged)* |
| shift + left press | Set `selectAnchor` to the current cursor if unset, then move the cursor to the clicked row — extending the selection to the click. |
| left drag | Set `selectAnchor` to the press row if unset, then move the cursor to the row under the pointer. |
| left press ×2, same row, < 400 ms | Open the comment composer on that row — or on the whole selection, if the double-click landed inside one. |

Double-click tracking is a `useRef<{ row: number; at: number } | null>`. The threshold
is a named constant in `mouse.ts` next to `WHEEL_ROWS`.

A drag that leaves the viewport does not auto-scroll. It is a nice touch and it is a
second timer feeding cursor motion; `V` plus `ctrl-d` already covers a selection longer
than the screen.

### 4. The composer

**It is rows.** A new `DetailRow` kind:

```ts
| { kind: 'composer'; unit: number; path: string;
    part: 'top' | 'body' | 'bottom'; lineIndex?: number }
```

spliced into the row list after the last row of the anchored range by a pure function
in `rows.ts`:

```ts
export function withComposer(
  rows: DetailRow[],
  afterRow: number,
  composer: ComposerView,
): DetailRow[]
```

`Detail.renderRow` grows one case. Every composer row is exactly one `<Text>`, which is
the invariant the whole row model exists to protect — a composer that wrapped would
push every row below it down by one and the cursor would stop addressing what the
reviewer sees.

**What it looks like:**

```
  40 │ + const refreshDisplayName = () =>
  41 │ +   mutate(key => Array.isArray(key) && key[0] === 'x')
     ╭─ Comment on lines R40 to R41 ──────────────────────────╮
     │ ```suggestion                                          │
     │ const refreshDisplayName = () =>                        │
     │   mutate(key => Array.isArray(key) && key[0] === 'x')   │
     │ ```█                                                   │
     ╰─ ^d save · ^o editor · esc cancel ─────────────────────╯
  42 │ +   , undefined, { revalidate: true })
```

Border in `structure` cyan — it is position, telling you where in the diff you are
writing. The title mirrors GitHub's own wording exactly: `Comment on line R29`,
`Comment on lines R40 to R41`, `Comment on line L17` for the pre-image side.

**The text buffer** is `src/tui/textarea.ts`, pure:

```ts
export interface Buffer { lines: string[]; row: number; col: number }

export function fromText(text: string): Buffer
export function toText(buffer: Buffer): string
export function insert(buffer: Buffer, chunk: string): Buffer
export function newline(buffer: Buffer): Buffer
export function backspace(buffer: Buffer): Buffer
export function move(
  buffer: Buffer,
  dir: 'left' | 'right' | 'up' | 'down' | 'home' | 'end',
): Buffer
```

Every function total and testable with no terminal. `insert` takes a chunk rather than
a char because a paste arrives as one input event, and a pasted block of code is the
single most likely thing to go into a suggestion.

**Keys while the composer is open.** It owns every key; `useInput` in `App` keeps its
existing early return for `mode === 'comment'`.

| Key | Effect |
|---|---|
| printable / paste | `insert` |
| enter | `newline` |
| backspace, delete | `backspace` |
| arrows | `move` |
| ctrl-a / ctrl-e | line home / end |
| **ctrl-d** | save |
| ctrl-o | hand off to `$EDITOR` with the current text, return with the result |
| esc | cancel, discarding the body |

`ctrl-e` is line-end, per readline, so the `$EDITOR` handoff takes `ctrl-o` — "open in
editor". The footer states whichever two matter.

Cancelling discards without a confirm, matching GitHub's Cancel button. The composer is
a place you spend thirty seconds, not thirty minutes, and `ctrl-o` is there for
anything longer.

**Scrolling.** While the composer is open the cursor is pinned to the row holding the
caret, so the existing `nextScrollTop` keeps it on screen as the body grows. A composer
taller than the viewport scrolls like any other run of rows.

### 5. Suggestion pre-fill

`s` opens the composer with the body already set to:

````
```suggestion
const refreshDisplayName = () =>
  mutate(key => Array.isArray(key) && key[0] === 'x')
```
````

The code lines are the **post-image** text (`line.text`) of each selected line that has
one — `add` and `context` lines. A `del` line contributes nothing, because a suggestion
replaces what is there now and a deleted line is not there now.

The caret lands at the end of the last code line, which is where a reviewer editing a
suggestion starts typing.

`c` opens the same composer with an empty body. That is the only difference between
them.

### 6. The simplification

Today `saveComment` (`App.tsx:629`) diverts a suggestion's entire body into the
`suggestion` field and blanks `body`, and `renderCommentBody` (`payload.ts:20`)
reassembles the fence at submit time. With the fence typed literally into the body,
that inverts and gets simpler:

- The composer always produces a **body**.
- `suggestion` stays `null` for anything the reviewer composed.
- `renderCommentBody` already returns `comment.body` verbatim when `suggestion` is
  `null`, so a typed fence passes straight through with no special case.

The `suggestion` field stays on `StagedComment` — `triage.ts:50` populates it from
model findings, and that path is untouched.

So `c` and `s` become one code path differing only in pre-filled text, and the
"is this a suggestion" flag disappears from the composer entirely.

`saveComment` also stops hardcoding `startLine: null` and takes it from the anchor.

### 7. Staged comments in the diff

`buildRows` takes the staged comments:

```ts
export function buildRows(
  units: ReviewUnit[],
  threads: ReviewThread[],
  showThreads: boolean,
  staged: StagedComment[],
): DetailRow[]
```

and emits, after the diff-line row matching a comment's `(path, side, line)`:

```
  41 │ +   mutate(key => Array.isArray(key) && key[0] === 'x')
     ● you · R40–R41
       this rotates the JWT on every keystroke
  42 │ +   , undefined, { revalidate: true })
```

`pending` yellow and `theme.glyph.staged` — the same token the header count uses,
because it is the same fact in a second place. The body is wrapped to the pane width at
row-build time, one `DetailRow` per wrapped line, since a row may never wrap itself.

With the cursor on one:

- `enter` reopens the composer on it, pre-filled, replacing the comment on save.
- `x` deletes it. (`x` is drop-finding on a finding row; same context rule as `s`.)

A comment whose anchor no longer resolves — the existing orphan path in
`src/core/store/review.ts:119` — is not rendered inline, because there is no line to
render it under. Those remain visible on the submit screen, which is already where
orphans are dealt with.

## Keymap and help

```
c         comment on this line or selection
s         suggest a change      (on a finding row: send that finding as a suggestion)
V         start / clear a line selection
enter     edit the staged comment under the cursor
x         delete the staged comment under the cursor  (on a finding row: drop it)
```

`C` and `S` are removed. `KEY_HELP` entries updated, including the mouse rows, which
already document `click` and now document shift-click, drag, and double-click.

## Testing

The pure layer carries the weight, which is the point of putting the logic there:

- `textarea.ts` — every function, including the edges: backspace at column 0 joining
  lines, backspace at the very start being a no-op, `move` clamping at both ends, a
  multi-line `insert` chunk, round-tripping `fromText`/`toText`.
- `rangeAnchor` — single line, forward range, backward range, mixed add/del preferring
  RIGHT, pure deletion block falling to LEFT, a range spanning two files clamping to
  the first, a range containing no diff lines returning `null`.
- `withComposer` — the composer lands after the right row; the row list is otherwise
  unchanged; the composer's own rows are each one row.
- `buildRows` with staged comments — placement under the right line, a comment on a
  line that is not shown, two comments on the same line, body wrapping.
- `parseMouse` — drag reports, shift-modified presses, and the existing cases
  unchanged.
- Double-click threshold logic as a pure helper, so it is tested without a clock.

Component-level, in `tests/tui/app-input.test.tsx`: `V` then `j` then `c` produces a
composer titled for a two-line range; `s` on a selection pre-fills the fence; `ctrl-d`
stages a comment with the right `startLine`; `esc` discards.

## Out of scope

- Replying to an existing review thread. Threads are read-only today (`t`), and
  replying is a different GitHub endpoint.
- Markdown preview (GitHub's Write/Preview tabs). The body is markdown and the
  terminal cannot render it meaningfully; a "Preview" tab that showed the same text
  would be theatre.
- Reactions, attachments, `@` autocomplete.
- Auto-scroll while dragging past the viewport edge.
