# marrow — interface design system

Medium: terminal (Ink 7). Every rule below is adapted to a medium with one typeface,
one type size, no shadows, and a background the user chose, not us.

## Intent

**Who.** A senior engineer who has just been assigned a 3000-line pull request. Already
in the repo, already in a terminal, between other work. Five minutes earlier: writing
code. Five minutes later: shaping someone's afternoon with a verdict.

**Task.** *Judge.* Not browse, not explore — read the part that carries meaning, form an
opinion, record it. Every layout decision serves getting to a defensible verdict faster.

**Feel.** A workbench. Dense, quiet, unhurried. Kin to `git`, `less`, `fzf` — tools that
assume competence. Explicitly *not* a colorful CLI toy, and not a web dashboard cosplaying
as a terminal.

## The decision that shapes everything: no hardcoded palette

**Bind to ANSI semantic slots, never truecolor hex.** The user has already chosen a
terminal theme — Solarized, Gruvbox, Tokyo Night — with a background, a contrast level,
and a green they can distinguish from their red. A hardcoded `#3fb950` fights all of that
and looks wrong in half of terminals.

This is the terminal-native form of "bind to semantic tokens, not literals." It is also
the single biggest reason most TUIs look worse than the terminal they run in.

Consequence: we get 16 slots and 3 attributes. That is the whole budget. It is enough,
because hierarchy here comes from **weight and color, never size** — the extreme case of
the general rule, since size is fixed at one.

## Tokens

Colors carry meaning; they are never decoration.

| Token | ANSI | Means — and only this |
|---|---|---|
| `add` | green | A diff addition. Nothing else is ever green. |
| `del` | red | A diff deletion. Nothing else is ever red. |
| `structure` | cyan | Position and navigation: file marker, current pane, search query. |
| `pending` | yellow | Unsubmitted work. The one token allowed to nag. |
| `agent` | magenta | Model-authored content (Plan 3 findings). Reserved so you can *always* tell what the model said from what you and your colleagues said. |
| `danger` | red + bold | Failing checks, destructive confirms. Distinguished from `del` by weight and context. |

Four text tiers, the hierarchy backbone:

One glyph is drawn rather than typed: the wordmark on the welcome panel, in the same
half-block characters the meat gauge uses, in `primary` — not the cyan `structure` token,
which means position and navigation everywhere else, and a logo is neither. Three rows,
and the first thing dropped when the pane is short: it is decoration, and the three
questions that panel answers are not.

| Tier | ANSI | Use |
|---|---|---|
| `primary` | bold, default fg | The one thing per view that matters — PR title, the kept-lines figure |
| `secondary` | default fg | Diff content, comment bodies — what you read |
| `tertiary` | dim | Hunk headers, metadata, gutters |
| `muted` | dim + bright-black | Chrome: rules, folded markers, help hints |

**~60/30/10 holds:** most of the screen is `tertiary`/`muted` structure, `secondary` for
content, and color reserved for the ~10% that means something.

## Depth: tonal only — commit to it

No shadows exist here, and boxes are the default trap. **Structure comes from tonal tiers
plus exactly one vertical rule** (`│`, dim) between the panes. No `┌─┐` boxes anywhere.
Horizontal rules only at the two hard boundaries: below the header, above the status bar.

Squint test: you should perceive two panes and a status line, and nothing should jump —
except the meat gauge and anything yellow.

## Revision: align with `srtfisher/atproto-inspect`

The user pointed at their own Ink project as the reference — a tool we built together.
Reading its source corrects two rules I had written abstractly. Their stated preference
wins over my abstraction:

| I had banned | The reference does | Ruling |
|---|---|---|
| Spinners | `ink-spinner` dots, accent color, `paddingX={1} paddingY={1}` | **Allowed for genuine waits**, paired with named steps and elapsed time. |
| Box borders | `borderStyle="round"` + `borderColor` on the header | **Allowed on the header only.** Panes still separate by tonal tiers and one vertical rule. |

Conventions adopted verbatim, so the two tools feel like the same hand made them:

- **`paddingX={1}` on every pane and panel.** Nothing sits flush against the terminal edge.
- **Selection is `❯ ` in the accent color**, never reverse video. Unselected rows get two
  spaces so text never shifts horizontally as the cursor moves.
- **A muted position indicator under a scrolled list**: `1–10 of 47`.
- **Breadcrumbs with a muted `›`**, last crumb in the accent color.
- Colors stay ANSI slot names, which the reference also uses.

## Revision, after first real use

The first run on a real repository showed the list reading as a wall of text: two-row
entries stacked with no separation, flush to the left edge, and a full-width reverse-video
block on the selected row. Corrections, all in the direction of more air:

- **A blank row between list entries.** Three rows per entry, not two. The list is chosen
  from deliberately; it is not a log.
- **One column of left padding** on every pane. Text flush against the terminal edge reads
  as unfinished.
- **Selection is a marker plus brightness, not a reverse-video block.** A full-width
  inverse bar is the heaviest thing on screen and fights everything around it. The list
  uses `❯ ` in the accent color (matching the reference project); the detail pane keeps
  `▸`, which distinguishes "which pull request" from "where in the diff".
- **A blank row under the pane header** before the first entry.

The density rule stands, but it was applied too literally: dense *within* a row, airy
*between* groups. Two-row entries jammed together got the first half right and the second
half wrong.

## Loading and progress — a second exception to "no spinners"

The no-spinner rule assumed nothing ever blocks. Opening a pull request does: fetching
metadata, creating a worktree, and abridging the diff take seconds to minutes, and the
findings pass can take much longer. A frozen `Loading #547…` is indistinguishable from a
hang, and a reviewer who thinks the tool is stuck will kill it.

So opening a pull request shows **staged progress with elapsed time** — each step named,
completed steps marked, the current step marked as running, and a seconds counter that
visibly advances. The counter is the part that proves it is alive; a static list of steps
does not.

This joins chat as the second place progress may be shown. The rule is unchanged in
substance: **show progress only when the user is genuinely blocked on something**, never
as decoration.

## Revision, after reviewing a real 17-file pull request

The first large diff put through the tool exposed four things, and the fixes changed the
layout enough to be worth recording as rules.

**The pane scrolls by row, not by unit.** The viewport windowed on whole units — a file
header, a whole hunk — which cannot hold: a design-doc change is one file with one
thousand-line hunk, and a forty-row pane obeying "whole units only" showed either that
hunk alone or, at the top of a diff, the one-row file header and thirty-nine blank rows.
Rows are now what renders, what scrolls, and what the cursor points at. Consequence: **no
row may ever wrap.** Everything truncates. A wrapped line pushes every row below it down
by one and the cursor stops pointing at what the reviewer sees.

**The cursor is a line, so `C` comments on a line.** It used to anchor to the hunk's last
changed line whatever was under the cursor, which is not what "comment on this line"
means.

**The sidebar goes away once a pull request is open.** It exists to choose one. After that
it is 32 columns spent on a list nobody is reading, taken from the diff. The header takes
over its job: title, number, and **an index of every file in the change**, laid out as a
grid of file *names* — full paths force one column and seventeen rows, and truncating them
to fit identifies nothing. A name shared by two files gets its parent directory back.

**Reading progress is a check in that index**, green, set when the cursor passes a file's
last row and toggleable with `m`. Files are the unit a reviewer thinks in.

## The bottom row is verbs, not metadata

It used to restate the repository, the number, and the meat gauge — all three already in
the header — while the keys that operate the tool lived only behind `?`. It is now a hint
bar of what applies to the row under the cursor: a finding offers accept and drop, a diff
line offers comment and suggest. Keys take the `structure` token, labels stay muted, so
the eye lands on what to press.

It degrades from the back, never mid-word. `?` always survives, because it is the way out
of not knowing the rest, and plain truncation ate it first.

## Say when a pass fell short

`kept 1038/1040 lines` reads as a judgment and can be a shortfall — a classification run
that returned fewer verdicts than it was asked for leaves every hunk it skipped kept by
default. The header names the count out loud in `pending` yellow. Same principle as the
folded-noise rule and `diff-only`: **degradation is stated, never inferred from a number
that looks healthy.**

## Density and proportion

- **Sidebar 32 columns**, content flexes. 32 says *navigation serves content* — the diff
  is the product. A 50/50 split would say they are peers; they are not.
- **Gutter 6 columns** (`old new`), dim, right-aligned — tabular alignment is the
  terminal's version of `tabular-nums`.
- **Rhythm is uneven on purpose:** zero blank rows between hunk lines (dense, scannable),
  one blank row between hunks, one between files. Reading is tight; navigating breathes.
- **Three-row list entries**: title, a dimmed `author · relative time` row, then a blank
  row. The list is chosen from deliberately, not scanned in bulk, so it gets air.
  (GitHub's `pulls.list` returns no file counts — showing `0 files` was a bug.)

## Signature elements

Three things that could only exist in this product:

1. **The meat gauge** — `▇▇▇▇▇▁▁▁▁▁ 59/106`. Kept-versus-dropped as one glyph run in both
   the header and the status bar. The product's entire thesis, eight characters wide. Ten
   cells, green filled / dim empty, proportional to kept lines.
2. **The folded-noise rule** — `┄┄┄ 4 hunks folded · imports-only, whitespace ┄┄┄`.
   Dropped content is *visibly present but collapsed*, with the rule that dropped it named
   inline. This is "nothing is hidden" made structural rather than promised.
3. **The cut mark** — a cyan `▍` before each file path. A butcher's mark on the cut,
   nodding at the `meat` lineage, and doubling as the eye's anchor when scrolling.

## States — none are optional

| State | Treatment |
|---|---|
| selected (list) | `❯ ` in the accent color plus a bold title. Never reverse video — a full-width inverse bar is the heaviest thing on screen. |
| cursor (detail) | cyan `▸` in the left margin; no reverse — it would fight the diff colors |
| folded | the folded-noise rule, dim |
| dropped file | dim path plus `· dropped: <rule>`, never omitted |
| staged | `● N staged` in yellow, header and status bar both |
| failing checks | `danger`, named inline in the header — never a bare count |
| empty list | "No pull requests." — never a blank pane |
| no search match | `No match for "query".` — never a blank pane |
| degraded (no worktree) | `diff-only` in the status bar, stated not hidden |
| model still running (findings filling in) | no indicator — rule verdicts already rendered and nothing is blocked |
| user is blocked (opening a PR, awaiting a chat answer) | `ink-spinner` dots plus named steps and a ticking elapsed counter. The counter is what proves it is alive. |

## Motion

Effectively none. This is a keyboard tool used hundreds of times a day; per the general
rule, high-frequency actions get no animation because it makes them feel slow. No
transitions, no fades. The only "motion" is progressive reveal as model verdicts arrive.

## Revision, after looking at the thing on a wide terminal

Four fixes, all of them the same mistake in different places: a layout that divided the
space it was given instead of asking what the content needed.

**The wordmark was drawn wrong and nobody noticed for weeks.** Three rows of half-blocks
are a 6×31 bitmap, and the letters have to be legible *as pixels*. The R was drawn with a
bowl and no leg, which is a P, so the welcome panel proudly read **MAPPOW**. The M had
three stems and the W had a solid bar through it. The glyphs are now documented as their
pixel grid in the source, and the test unpacks the half-blocks back into that grid and
asserts the letterforms — the only kind of check that can see this class of bug, since the
half-block strings themselves look plausible either way.

**The file index sized its cells to a share of the width.** Four columns of `width / 4`
put `app.css` in a fifty-seven-column cell on a 230-column terminal, so the index read as
four unrelated lists with a gutter of nothing between them — and still truncated the one
name long enough to need the room. Cells are sized to their longest label now, and the
column count follows from how many of those fit. The old cap of four columns was recorded
as "a very wide terminal does not get eight columns of nothing", which was right about the
symptom and wrong about the cause: with content-sized cells, more columns is a *tighter*
block, not a more spread-out one. Six, and the same 17-file change that took five header
rows now takes three — two more rows of diff.

**The help overlay did not fit the terminal.** Twenty-four bindings in one flat column is
twenty-six rows, and Ink overdraws rather than clipping, so an eighty-by-twenty-four
terminal garbled it exactly the way the welcome panel used to. Bindings are grouped under
headings now, packed into as many columns as the width allows and as *few* as the height
needs — two roomy columns beat three cramped ones when two already fit — and what still
does not fit scrolls, with the same `1–21 of 37` indicator the pull-request list uses.
Clipping was the tempting fix and the wrong one: this is the screen that exists to tell you
about a key, so the key it omits is the one you came for.

**Consequence for the whole app:** layout arithmetic is a pure module, unit-tested, and the
renderer and the scroll maths read the *same* function rather than each deriving the number.
`detailHeaderRows`, `planFileIndex`, `layoutHelp`, `hitDetail` are all this shape. One row
of disagreement between them is a cursor pointing at the wrong line, which is a review tool
commenting in the wrong place.

## The mouse, admitted narrowly

The keyboard does everything and stays that way. But a reviewer scrolling a diff reaches
for the wheel without deciding to, and a window where that does nothing feels like the tool
is not really running in it.

So: the wheel scrolls, and a left click puts the cursor on a line or jumps to a file on the
index. Nothing else — no drag, no selection, no hover. Motion reporting is deliberately not
enabled: Ink repaints on input, and tracking a mouse across an idle window would redraw the
whole diff for nothing.

Two details that matter more than the feature:

- **The wheel scrolls the view and drags the cursor along**, which is the opposite of `j`,
  where the cursor moves and the view follows. The cursor is not decoration here — `C`
  comments on the line it points at — so a view that scrolled out from under it would leave
  a reviewer able to comment on a line they cannot see.
- **A click on a line already on screen does not recentre.** The pane moving in response to
  the reviewer's own click is the pane moving for no reason.

Reporting is turned off again on every exit path, including while `$EDITOR` owns the
terminal. A shell left in reporting mode prints `[<0;12;7M` at the prompt on every click,
and nothing tells the user which program did that to them.

## Rejected defaults, recorded so they stay rejected

- Hardcoded truecolor palette → ANSI semantic slots that inherit the user's theme
- `┌─┐` boxes around panels → one vertical rule and tonal tiers
- Emoji status icons → typographic marks; emoji cell width is unreliable and reads as toy
- A spinner during model calls → progressive reveal
- Equal-weight rows → two-tier list entries, one bold figure per view
- Grid cells sized to a share of the width → cells sized to their contents, column count
  derived from those
- Clipping an overlay that does not fit → group, reflow into columns, then scroll
- Mouse motion/drag reporting → wheel and click only
