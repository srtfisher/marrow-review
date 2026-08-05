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

## Density and proportion

- **Sidebar 32 columns**, content flexes. 32 says *navigation serves content* — the diff
  is the product. A 50/50 split would say they are peers; they are not.
- **Gutter 6 columns** (`old new`), dim, right-aligned — tabular alignment is the
  terminal's version of `tabular-nums`.
- **Rhythm is uneven on purpose:** zero blank rows between hunk lines (dense, scannable),
  one blank row between hunks, one between files. Reading is tight; navigating breathes.
- **Two-row list entries** (title, then author · file count dimmed) rather than one dense
  row — the list is chosen from, not scanned in bulk.

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
| selected (list) | reverse video on the title row only, not the whole two-row block |
| cursor (detail) | cyan `▸` in the left margin; no reverse — it would fight the diff colors |
| folded | the folded-noise rule, dim |
| dropped file | dim path plus `· dropped: <rule>`, never omitted |
| staged | `● N staged` in yellow, header and status bar both |
| failing checks | `danger`, named inline in the header — never a bare count |
| empty list | "No pull requests." — never a blank pane |
| no search match | `No match for "query".` — never a blank pane |
| degraded (no worktree) | `diff-only` in the status bar, stated not hidden |
| model still running | **no spinner** — rule verdicts render immediately and model verdicts fill in; there is nothing to wait on, so nothing should imply waiting |

## Motion

Effectively none. This is a keyboard tool used hundreds of times a day; per the general
rule, high-frequency actions get no animation because it makes them feel slow. No
transitions, no fades. The only "motion" is progressive reveal as model verdicts arrive.

## Rejected defaults, recorded so they stay rejected

- Hardcoded truecolor palette → ANSI semantic slots that inherit the user's theme
- `┌─┐` boxes around panels → one vertical rule and tonal tiers
- Emoji status icons → typographic marks; emoji cell width is unreliable and reads as toy
- A spinner during model calls → progressive reveal
- Equal-weight rows → two-tier list entries, one bold figure per view
