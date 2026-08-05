# marrow

Review large pull requests in the terminal. marrow abridges a diff down to the parts
that carry meaning, drafts findings anchored to specific lines, and submits one GitHub
review with inline comments and suggestions.

```
▍mdv/SmartTypography.swift  +33 −0
  @@ -36,6 +36,11 @@ smartenMarkdown   [guards thematic breaks]
     36  │     if looksLikeThematicBreak(trimmed) {
     37  │ +       return source
     38  │ +   }

┄┄┄ 4 hunks folded · imports-only, whitespace — press z to reveal ┄┄┄

┄┄┄ pnpm-lock.yaml · dropped: lockfile ┄┄┄
```

## Why

A 3000-line pull request is mostly not worth reading. Lockfiles, generated clients,
import churn, and reformatting drown the twenty lines where the actual decision lives.
marrow separates the two, shows you the second, and keeps the first one keystroke away.

The idea is borrowed from [`boldsoftware/meat`](https://github.com/boldsoftware/meat),
which abridges a diff into a "reading diff". marrow reimplements that idea in TypeScript
and builds a review workflow around it.

## Requirements

- Node 24+
- [`gh`](https://cli.github.com) 2.97+, authenticated (`gh auth login`)
- A Claude Code subscription

## Install

```bash
bun install
bun run build
npm link          # or add ./dist/cli.js to your PATH
```

## Use

```bash
marrow                      # pull requests for the repo you are standing in
marrow 42                   # review PR 42
marrow <url>                # review a PR by URL
marrow --dry-run 42         # print the abridged diff, submit nothing
```

Run it from inside a clone. marrow fetches the PR's head commit into a detached git
worktree so the agent can read whole files and find call sites, not just the diff. No
clone, or a worktree that fails to create? It degrades to diff-only and says so.

### Keys

| | |
|---|---|
| `j` `k` | move · `Ctrl-D` `Ctrl-U` half page |
| `]` `[` | next / previous file · `n` `p` next / previous finding |
| `space` | fold this file · `z` reveal its dropped hunks · `Z` reveal everything |
| `/` | search by title, author, or number · `1` `2` `3` filter |
| `d` | full diff ↔ meat · `t` existing threads · `o` open on github.com |
| `a` `e` `s` `x` | accept / edit / suggest / drop the finding under the cursor |
| `C` `S` | write your own comment / suggestion on this line |
| `i` | ask about this hunk · `?` help · `q` quit |
| `!` | submit |

Submit is `!` rather than a letter on purpose. During triage the most-pressed keys are
`a` and `x`; approving someone's pull request is outward-facing and awkward to undo, so
it does not get a shortcut next to them. `!` opens a screen that shows what will happen,
then asks.

## Options

```
--model <alias>       reasoning model (default: opus)
--meat-model <alias>  diff classifier (default: one tier below --model)
--filter <f>          open | review-requested | all
--use-api-key         allow ANTHROPIC_API_KEY instead of the subscription
--dry-run             print, submit nothing
```

## Billing

marrow uses your **Claude Code subscription**, not metered API billing.

Claude Code resolves credentials in the order `ANTHROPIC_API_KEY` →
`ANTHROPIC_AUTH_TOKEN` → your OAuth profile. A stray key in your shell would therefore
put every review on the API quietly. marrow removes both variables from the agent
subprocess unless you pass `--use-api-key`, and tells you once when it does.

## What the agent can and cannot do

The findings, verification, and chat passes run with `Read`, `Grep`, and `Glob` — and
nothing else. `Write`, `Edit`, `NotebookEdit`, and `Bash` are denied. A review tool has
no business modifying your checkout, and denying `Bash` means it cannot run commands in
your repository. The tool policy is defined once and shared by all three passes, with a
test asserting the allow and deny sets stay disjoint.

Model-authored text always renders in magenta, a color reserved for exactly that. You
can always tell what the model said from what a colleague said.

**If a model call fails, the review still works.** The agent passes are additive: a dead
subprocess, a rate limit, or malformed output costs you the findings, not the diff,
navigation, your comments, or the ability to submit.

## How the abridgement works

1. **Deterministic rules**, instantly and free — lockfiles, generated output, snapshots,
   minified files, pure renames, whitespace-only hunks, import-only hunks. Every drop is
   attributed to a named rule. The highest-signal rule reads your `.gitattributes` for
   `linguist-generated`, which is the maintainers' own statement about what is noise.
2. **A model pass** over what survives, classifying keep/drop with a one-line reason and
   writing the "what this PR actually does" summary.
3. **A cache**, keyed by hunk content, so the same hunk is never judged twice and a
   verdict cannot flip between runs.

Nothing is ever hidden. The header counts what was kept, dropped hunks collapse into a
visible fold naming the rule that dropped them, and `z` expands them in place.

## Development

```bash
bun test              # 273 tests
bun run typecheck
bun run lint:boundary # src/core must never import UI
bun run build
```

`src/core/**` is a pure library with no UI imports, enforced in CI by dependency-cruiser.
`src/tui/**` is the Ink layer. The split is deliberate: the hard parts — diff parsing,
anchoring, the meat engine, review construction — are testable without rendering, and a
non-terminal frontend could reuse them.

Design decisions live in `.interface-design/system.md`; the specs and implementation
plans are under `docs/superpowers/`.

## Status

Private and early. The submit path is thoroughly unit-tested and validates anchors
locally before sending — GitHub rejects a review atomically if one comment is
badly anchored — but it has not yet been exercised against a live pull request.
