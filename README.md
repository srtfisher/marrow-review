```
█▄ ▄█ ▄▀▀▄ █▀▀▄ █▀▀▄ ▄▀▀▄ █   █
█ ▀ █ █▄▄█ █▄▄▀ █▄▄▀ █  █ █ ▄ █
█   █ █  █ █ ▀▄ █ ▀▄ ▀▄▄▀ █▀ ▀█
```

**A large diff, abridged to what carries meaning.**

marrow is a terminal tool for reviewing large pull requests. It cuts the diff down to the
parts worth reading, drafts findings anchored to specific lines, lets you accept, rewrite,
or throw each one away, and submits a single GitHub review with inline comments and
suggestions.

---

## Why

A 3000-line pull request is mostly not worth reading. Lockfiles, generated clients, import
churn, and reformatting drown the twenty lines where the actual decision lives. marrow
separates the two, shows you the second, and keeps the first one keystroke away.

Nothing is ever hidden. Every dropped hunk collapses into a visible fold that names the
rule that dropped it, the header counts what was kept, and one key expands any of it in
place. An abridgement you cannot audit is just a tool with an opinion.

The idea is borrowed from [`boldsoftware/meat`](https://github.com/boldsoftware/meat),
which abridges a diff into a "reading diff". marrow reimplements that idea in TypeScript
and builds a review workflow around it.

## What it looks like

Pick something to review:

```
 Open · 3                       │
                                │
 ❯ #546 Resolve settings pages… │
     octocat · 3h ago           │
                                │
   #544 Cache the audience loo… │
     hubot · 3h ago             │
                                │
   #541 Drop the legacy import… │ ╭────────────────────────────────────────────────╮
     octocat · 3h ago           │ │ █▄ ▄█ ▄▀▀▄ █▀▀▄ █▀▀▄ ▄▀▀▄ █   █                │
                                │ │ █ ▀ █ █▄▄█ █▄▄▀ █▄▄▀ █  █ █ ▄ █                │
                                │ │ █   █ █  █ █ ▀▄ █ ▀▄ ▀▄▄▀ █▀ ▀█                │
                                │ │ a large diff, abridged to what carries meaning │
                                │ │                                                │
                                │ │ octocat/webapp · 3 open                        │
                                │ ╰────────────────────────────────────────────────╯
                                │
                                │   ↑↓  j k  move       /  search
                                │   enter    review     ?  all keys
                                │   1 2 3    filter     q  quit
────────────────────────────────────────────────────────────────────────────────────────
 ↑↓ move   ⏎ review this one   / search   1 2 3 filter   q quit   ? all keys
```

Then read it. The sidebar gets out of the way, the header becomes a map of every file in
the change, and the meat gauge says how much of the diff survived:

```
 Resolve settings pages from packages via a namespace prefix
 #546 · octocat · main ← feat/settings-namespace · opus
 Packages can now register their own settings pages under a namespace prefix.
 ▇▇▇▇▇▇▇▁▁▁  kept 178/245 lines · 11/17 files · meat
 ▸  AccountSettingsController.php     resolve-page.ts                   app.tsx
    ssr.tsx                           PackageServiceProvider.php        settings.tsx
    NamespacedPagesTest.php           vite.config.ts                    tsconfig.json
    app.css                           vitest.config.ts

 ▸ ▍ packages/billing/src/Http/Controllers/AccountSettingsController.php
   @@ -36,6 +36,9 @@  [changes how a page is resolved]
       36     36  public function edit(Request $request): Response
       37     37  {
       38        -    return Inertia::render('settings/account', [
              38 +    return Inertia::render('billing::settings/account', [
       39     39          'account' => $request->user()->account,
       40     40      ]);
       41     41  }
     ! Namespace prefix is not validated anywhere  important
        An unregistered prefix resolves to a 500 rather than a 404.

   ▍ resources/js/resolve-page.ts
   @@ -36,6 +36,9 @@  [changes how a page is resolved]

┄┄┄ 4 hunks folded · imports-only, whitespace — press z to reveal ┄┄┄

┄┄┄ pnpm-lock.yaml · dropped: lockfile ┄┄┄
────────────────────────────────────────────────────────────────────────────────────────
 ↑↓ move   C comment on this line   S suggest   ] next file   ! approve   ? keys
```

The `▍` marks a file. `✓` in the index is a file you have read — it checks itself off when
the cursor passes the end of one. Magenta is the model talking, and only ever the model.

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

Run it from inside a clone. marrow fetches the pull request's head commit into a detached
git worktree so the agent can read whole files and find call sites, not just the diff. No
clone, or a worktree that fails to create? It degrades to diff-only and says so in the
header rather than letting you trust a half-evidenced review.

### Keys

| | |
|---|---|
| `j` `k` | move · `Ctrl-D` `Ctrl-U` half page |
| `]` `[` | next / previous file · `n` `p` next / previous finding |
| wheel | scroll the diff · click a line to put the cursor on it |
| click | a file in the index to jump to it |
| `space` | fold this file · `z` reveal its dropped hunks · `Z` reveal everything |
| `/` | search by title, author, or number · `1` `2` `3` filter |
| `d` | full diff ↔ meat · `t` existing threads · `o` open on github.com |
| `a` `e` `s` `x` | accept / rewrite / suggest / drop the finding under the cursor |
| `C` `S` | write your own comment / suggestion on this line |
| `v` | show refuted findings and why they were refuted |
| `i` | ask the model about this hunk · `?` help · `q` quit |
| `!` | submit |

The keyboard does everything; the mouse is there because a reviewer scrolling a diff
reaches for the wheel without deciding to. `?` lists every binding, grouped, and scrolls if
your terminal is too short for all of them.

Submit is `!` rather than a letter on purpose. During triage the most-pressed keys are `a`
and `x`; approving someone's pull request is outward-facing and awkward to undo, so it does
not get a shortcut next to them. `!` opens a screen that shows what will happen, then asks.

Quitting with unsubmitted work asks before it throws anything away, and drafts are written
through to disk as you go — closing the laptop is not the same as abandoning the review.

## Options

```
--model <alias>       reasoning model (default: opus)
--meat-model <alias>  diff classifier (default: one tier below --model)
--filter <f>          open | review-requested | all
--use-api-key         allow ANTHROPIC_API_KEY instead of the subscription
--dry-run             print, submit nothing
--no-highlight        no syntax colouring in the diff (NO_COLOR also honoured)
```

## How the abridgement works

1. **Deterministic rules**, instantly and free — lockfiles, generated output, snapshots,
   minified files, pure renames, whitespace-only hunks, import-only hunks. Every drop is
   attributed to a named rule. The highest-signal rule reads your `.gitattributes` for
   `linguist-generated`, which is the maintainers' own statement about what is noise.
2. **A model pass** over what survives, classifying keep/drop with a one-line reason and
   writing the "what this PR actually does" summary.
3. **A cache**, keyed by hunk content, so the same hunk is never judged twice and a verdict
   cannot flip between runs.

Keeping is the safe default, which means a classifier that returns fewer verdicts than it
was asked for leaves hunks kept for no reason at all. `kept 244/245 lines` would look like
a judgement and actually be a shortfall, so the header counts those separately and says so.

## What the agent can and cannot do

The findings, verification, and chat passes run with `Read`, `Grep`, and `Glob` — and
nothing else. `Write`, `Edit`, `NotebookEdit`, and `Bash` are denied. A review tool has no
business modifying your checkout, and denying `Bash` means it cannot run commands in your
repository. The tool policy is defined once and shared by all three passes, with a test
asserting the allow and deny sets stay disjoint.

Every finding is then put to a second pass that tries to refute it, through two
independent lenses: is this code actually reachable, and does the failure actually
reproduce. Both have to refute for a finding to be marked `refuted`; a split verdict leaves
it `plausible` and says so. Refuted findings are hidden rather than deleted — `v` brings
them back with the refutation attached, so you can see what the verifier threw out and
disagree with it.

**If a model call fails, the review still works.** The agent passes are additive: a dead
subprocess, a rate limit, or malformed output costs you the findings, not the diff,
navigation, your own comments, or the ability to submit.

## Billing

marrow uses your **Claude Code subscription**, not metered API billing.

Claude Code resolves credentials in the order `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN`
→ your OAuth profile. A stray key in your shell would therefore put every review on the API
quietly. marrow removes both variables from the agent subprocess unless you pass
`--use-api-key`, and tells you once when it does.

## Development

```bash
bun test              # 545 tests
bun run typecheck
bun run lint:boundary # src/core must never import UI
bun run build
```

`src/core/**` is a pure library with no UI imports, enforced by dependency-cruiser.
`src/tui/**` is the Ink layer. The split is deliberate: the hard parts — diff parsing,
anchoring, the meat engine, review construction — are testable without rendering, and a
non-terminal frontend could reuse them.

Layout arithmetic lives in pure modules next to the components that draw from it
(`fileindex.ts`, `viewport.ts`, `hittest.ts`, `help.ts`, `hints.ts`) and is unit-tested
directly. In a terminal, "the renderer and the scroll maths disagree by one row" is a real
class of bug, and the fix is to have exactly one of them.

Interface decisions and the reasoning behind them live in `.interface-design/system.md`.

## Status

Early. The submit path is thoroughly unit-tested and validates every anchor locally before
sending — GitHub rejects a review atomically if one comment is badly anchored — but it has
not yet been exercised against a wide range of live pull requests.

## License

[MIT](LICENSE) © Sean Fisher
