# marrow — syntax highlighting

**Date:** 2026-08-05
**Status:** approved design, ready for implementation planning
**Size:** medium
**Depends on:** nothing structurally. Lands third — it touches `DiffLineRow`, which
inline commenting also renders around, and this ordering keeps the two apart.

## Why, and what it costs

Code reads faster with syntax color, and the north star for this app is GitHub's web
review UI, which has it.

It is also the one change in the current backlog that takes something away.
`src/tui/theme.ts:12` is unambiguous — *"A diff addition. Nothing else is ever green."*
The palette's whole discipline is that a color means one thing, so a reviewer scanning
a 40-row window never has to ask what a color is doing. Putting five colors on every
line of code dissolves that, and it cannot be un-dissolved by being careful.

The resolution taken here: **the add/del signal moves out of the code text and into
the marker and the gutter**, which is the column the eye already runs down when
skimming a diff. Green and red keep meaning exactly what they meant. They just stop
covering the words.

The alternative GitHub uses — a background wash behind the line — was considered and
rejected. This app names ANSI slots rather than hex values specifically so it inherits
the user's terminal theme, and background colors are where that inheritance breaks
worst: a `green` background against a user's chosen `green` foreground is a coin flip
between subtle and unreadable.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where add/del lives | Gutter + `+`/`-` marker | Keeps the ANSI-slot rule, needs no background colors, and stays in the column being skimmed. |
| Library | `cli-highlight` (highlight.js) | User's call. 190+ languages, correct out of the box, no tokenizer to maintain. |
| Theme | A **custom** one, ANSI slot names only | `cli-highlight`'s default theme hardcodes colors and would break theme inheritance across the whole diff. |
| `green` / `red` in that theme | **Absent** | Those two slots stay reserved. A syntax token must never be able to impersonate an addition. |
| Highlight granularity | Per hunk, not per line | A block comment or template literal spanning lines mis-colors when each line is highlighted alone — and a JSDoc block is exactly what the reviewer's screenshots showed. |
| Failure mode | Fall back to plain text, silently, per hunk | A highlighter that throws on one odd file must not take the diff down with it. |
| Escape hatch | `--no-highlight`, plus an automatic bail on very large files | Highlighting is a nicety; reading the diff is not. |

## The risk worth naming

This app's entire row model exists because a line that renders as two terminal rows
breaks the cursor — `src/tui/rows.ts` says so at the top, and `DiffLineRow`'s docstring
says it again. Highlighted text is the same characters plus invisible ANSI escapes, and
every width calculation between here and the terminal has to know they're invisible.

Ink truncates with an ANSI-aware width, so this should hold. "Should" is not the
standard for the one invariant the architecture is built on, so it gets an explicit
test rather than an assumption: a highlighted line at a width that forces truncation
must occupy exactly one row and leave the gutter aligned.

## Design

### `src/tui/highlight.ts`

```ts
/** Language id for a path, or null when highlight.js has no grammar for it. */
export function languageFor(path: string): string | null

/**
 * A hunk's lines, highlighted together and split back apart. Highlighting the
 * hunk as one string is what gets block comments and template literals right;
 * the split repairs the ANSI state each line needs to stand alone.
 */
export function highlightHunk(lines: string[], language: string | null): string[]

/** Splits ANSI-marked text into lines, re-opening the active style on each. */
export function splitAnsiLines(text: string): string[]
```

`splitAnsiLines` is the part that earns its own function and its own tests. A token
spanning a newline — a block comment — comes out of `cli-highlight` as one open code,
the whole comment including its newlines, and one close code. Split naively, the first
line opens a style it never closes and the second closes one it never opened; the
terminal then colors everything after it. The function tracks the active SGR code,
closes it at each line end, and re-opens it at the next line start.

**Caching.** Results are memoized per hunk, keyed by `path` + hunk header. Hunks are
stable for the life of a review, so each is highlighted once no matter how many times
it scrolls past.

**Bail-outs**, each returning the lines unchanged:

- `--no-highlight` passed.
- `languageFor` returned `null`.
- The hunk exceeds a line or byte ceiling.
- `cli-highlight` threw. Called with `ignoreIllegals: true`, since a diff hunk is a
  fragment and is frequently not valid standalone syntax.

### The theme

Built once, mapping highlight.js token classes onto chalk styles that name ANSI slots:

| Token classes | Slot |
|---|---|
| `keyword`, `built_in`, `literal` | `magenta`* |
| `string`, `regexp` | `yellow`* |
| `number` | `cyan`* |
| `comment` | `dim` |
| `title`, `class`, `function` | `blue` |
| `attr`, `property`, `variable` | default |
| everything else | default |

\* These reuse slots the app also gives meaning to elsewhere (`agent`, `pending`,
`structure`). Inside the code column that is tolerable — a reviewer is not asking
whether a string literal is model-authored. What is not tolerable is `green` or `red`
appearing there, and those are simply not in the map. This table is the one place the
tension lives, so it is written down rather than discovered later.

`--no-highlight` and a future `--theme` both act on this map alone.

### `DiffLineRow`

```tsx
<Text wrap="truncate">
  <Text color={colorFor(line)}>{formatGutter(line, gutterWidth)}</Text>{' '}
  <Text color={colorFor(line)}>{marker(line)}</Text>
  {highlighted ?? line.text}
</Text>
```

Two changes from today: the gutter takes the add/del color instead of `dimColor`, and
the code text is the highlighted string instead of sharing the marker's color.

A context line's gutter stays `dimColor` — it has no add/del signal to carry, and
dimming it is what keeps the changed lines' gutters standing out.

The highlighted string is threaded in from the row, not computed in the component:
`DetailRow`'s `diff-line` variant gains an optional `highlighted?: string` filled at
row-build time, so highlighting happens once per hunk in `buildRows` rather than once
per line per render.

### Interaction with the composer

Spec 2's composer body is **not** highlighted, even when it holds a ` ```suggestion `
block. The composer is text you are writing, in a box whose border already says so, and
coloring it like committed code would blur the one distinction that matters there.

## Testing

- `languageFor` — common extensions, an unknown one, a dotfile, a path with no
  extension.
- `splitAnsiLines` — a style spanning two lines, a style closing mid-line, text with no
  codes, an empty line inside a styled run, and a round-trip where stripping the codes
  from the output reproduces the input exactly.
- `highlightHunk` — a block comment across lines colors as one comment; an unknown
  language returns the input unchanged; a thrown highlighter returns the input
  unchanged.
- **The invariant:** a highlighted line longer than the pane renders as exactly one row
  with the gutter still aligned.
- The theme map contains no `green` and no `red`. Asserted, so it cannot be
  reintroduced by someone tuning colors later without the test telling them why not.

## Out of scope

- Word-level intra-line diff highlighting (GitHub's darker green on the changed span).
  Different feature, different algorithm.
- Highlighting finding bodies or comment bodies. Those are prose.
- A configurable color theme beyond the `--no-highlight` switch.
