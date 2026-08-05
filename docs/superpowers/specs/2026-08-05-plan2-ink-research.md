# Ink 7.1.1 research notes for Plan 2 (TUI)

Read from the installed package, not from memory or documentation. These correct two
assumptions in the design spec before Plan 2 is written against them.

## Package facts

- **ESM only** (`"type": "module"`, single `exports` entry). Fits our existing setup.
- **`engines.node >= 22`** — we are on 24.
- **`react >= 19.2.0` is a REQUIRED peer.** Plan 2 must add React as a real dependency.
  Only `@types/react` and `react-devtools-core` are marked optional in
  `peerDependenciesMeta`; `react` itself is not.

## Two spec assumptions that need updating

The design spec says, under "Known UI engineering":

> **Ink has no scrollable viewport.** We render a window of lines computed from cursor
> position and terminal height ourselves, and re-render on resize. It's the main
> non-trivial UI work.

Half right. Ink 7 still has no scrollable-viewport *component*, so the windowing logic
(which slice of lines is visible for a given cursor position) remains ours to build and
test. But the resize half is solved: **`useWindowSize`** is exported, so we do not need
to hand-roll `process.stdout.on('resize')` tracking. **`useBoxMetrics`** and
**`measureElement`** additionally give measured box dimensions, which is what the
viewport needs to know how many rows it actually has.

Net effect: the viewport component is smaller than the spec assumed, but still the piece
to build first and test hardest.

## Testing approach — revise the spec's plan

The spec proposes `ink-testing-library`. Ink 7 exports **`renderToString`**, which
renders a component tree to a plain string. For a viewport whose entire contract is
"given N lines, a cursor position, and a height, show the right window", asserting on a
returned string is simpler and less brittle than a testing-library harness, and it needs
no extra dependency. Prefer `renderToString` for the viewport and keymap-dispatch tests;
reach for `ink-testing-library` only if something genuinely needs interaction over time.

## Full exported API (Ink 7.1.1)

Components: `Box`, `Text`, `Static`, `Transform`, `Newline`, `Spacer`
Entry points: `render`, `renderToString`
Hooks: `useInput`, `usePaste`, `useApp`, `useStdin`, `useStdout`, `useStderr`,
`useFocus`, `useFocusManager`, `useIsScreenReaderEnabled`, `useCursor`, `useAnimation`,
`useWindowSize`, `useBoxMetrics`
Other: `measureElement`, `kittyFlags`, `kittyModifiers`

`useInput(handler)` receives `(input: string, key: Key)` where `Key` includes
`upArrow`, `downArrow`, `leftArrow`, `rightArrow`, `pageUp`, `pageDown`, and the usual
modifier flags — so the plan's `Ctrl-D`/`Ctrl-U` half-page bindings and arrow-key
fallbacks are directly supported.

`usePaste` is worth knowing about for the comment editor: a pasted multi-line block
should not be interpreted as a sequence of keystrokes.
