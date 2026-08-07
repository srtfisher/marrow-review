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

Pick something to review. The picker is the whole screen and the filter is always live —
every key you type narrows the list by title, author, or number, so `546` and `settings`
both get you there:

```
 marrow · octocat/webapp · open                                          reviewing #546
────────────────────────────────────────────────────────────────────────────────────────
 █▄ ▄█ ▄▀▀▄ █▀▀▄ █▀▀▄ ▄▀▀▄ █   █
 █ ▀ █ █▄▄█ █▄▄▀ █▄▄▀ █  █ █ ▄ █
 █   █ █  █ █ ▀▄ █ ▀▄ ▀▄▄▀ █▀ ▀█
 a large diff, abridged to what carries meaning

 filter › settings▏                                                             3 of 12

 ❯ #546 Resolve settings pages from packages via a namespace prefix
     octocat · 3h ago · ● reviewing

   #544 Cache the audience lookup on the settings dashboard
     hubot · 3h ago

   #521 Settings export omits toggles that were disabled after the last publish,
       and reports success anyway
     octocat · 2d ago

────────────────────────────────────────────────────────────────────────────────────────
 ↑↓ move   ⏎ review this one   ⇥ filter   ctrl-r refresh   esc back to #546
```

Titles get the full width and a second row if they need one, because the title is the
field you choose by. `⏎` opens the one under the cursor. `⇥` cycles the server-side filter
between open, needs my review, and all.

Leaving a review with `esc` asks once, and the review stays warm: its entry is marked
`● reviewing`, the top row keeps saying so, and `esc` in the picker walks straight back
into the same diff — same line, same scroll position, same files checked off. Only opening
a different pull request replaces it.

Then read it. The review is the whole terminal, the header is a map of every file in the
change, and the meat gauge says how much of the diff survived:

```
 marrow · octocat/webapp · open
────────────────────────────────────────────────────────────────────────────────────────
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
 ↑↓ move   c comment   s suggest   n finding   d full   ! approve   ] file   ? keys
```

The `▍` marks a file. `✓` in the index is a file you have read — it checks itself off when
the cursor passes the end of one. Magenta is the model talking, and only ever the model.

## Requirements

- Node 24+
- [`gh`](https://cli.github.com) 2.97+, authenticated (`gh auth login`) — or a `GITHUB_TOKEN`
  in the environment, which marrow falls back to when `gh` is absent
- A Claude Code subscription. Claude Code itself ships with marrow, so there is nothing
  else to install; if it cannot start or cannot authenticate, marrow says so and carries
  on without the model passes — the diff, your comments, and submitting all still work.

## Install

```bash
npx marrow-review
```

That is the whole install. The package is `marrow-review`; the command it gives you is
`marrow`. If you review often enough to want it on your `PATH`:

```bash
npm i -g marrow-review
```

## Use

```bash
npx marrow-review           # pull requests for the repo you are standing in
npx marrow-review 42        # review PR 42
npx marrow-review <url>     # review a PR by URL
npx marrow-review --dry-run 42   # print the abridged diff, submit nothing
```

Installed globally, the command is `marrow`:

```bash
marrow                      # pull requests for the repo you are standing in
marrow 42                   # review PR 42
marrow <url>                # review a PR by URL
marrow --dry-run 42         # print the abridged diff, submit nothing
```

marrow draws before it fetches: the screen is up with the wordmark, the repository, and a
spinner while GitHub answers, and a failed fetch lands in that same frame with
`r retry · q quit` rather than as an error under your prompt. Given a pull request up
front, that same frame shows the loading steps instead.

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
| click | a file in the index to jump to it · in the picker, click aims and click again opens |
| `space` | fold this file · `F` fold every file · `z` reveal its dropped hunks · `Z` reveal everything |
| type | in the picker: filter by title, author, or number · `⇥` open / needs my review / all |
| `ctrl-r` | refetch the list · `esc` clears the query, else back to the warm review, else quits |
| `d` | full diff ↔ meat · `t` existing threads · `o` open on github.com |
| `a` `e` `s` `x` | accept / rewrite / suggest / drop the finding under the cursor |
| `c` `s` | write your own comment / suggestion on this line · `V` first to select a range |
| `v` | show refuted findings and why they were refuted |
| `i` | ask the model about this hunk · `?` help · `q` quit |
| `!` | submit |

Arriving at a file puts that file at the top of the pane, so `]` shows you the file rather
than its name at the bottom edge with the contents below the fold. Reading is unaffected:
`j` and `k` move the view as little as the cursor requires, right up until a keystroke
lands you on a file header. `F` collapses the whole diff to its file names and a second
`F` puts it back, leaving you on the file you were reading.

The keyboard does everything; the mouse is there because a reviewer scrolling a diff
reaches for the wheel without deciding to. `?` lists every binding, grouped, and scrolls if
your terminal is too short for all of them — from the review, because in the picker `?` is
filter text like every other printable key, and the row along the bottom already names all
five keys it has.

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
   minified files, deleted files, pure moves, whitespace-only hunks, import-only hunks. Every
   drop is attributed to a named rule. The highest-signal rule reads your `.gitattributes`
   for `linguist-generated`, which is the maintainers' own statement about what is noise.

   Deleting a file and moving one are the two largest things a diff can contain and the two
   least worth reading: the whole former body arrives marked `-`, to say something the path
   already says. Both fold to one line. A move that also *edits* the file keeps its edits —
   the move is free, the change inside it is not.
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

## What leaves your machine

Reviewing sends the pull request's diff to Anthropic, and — because the agent runs in a
worktree with `Read`, `Grep`, and `Glob` — whatever files it reads while looking for call
sites. That is the whole point of the tool, but it is worth stating plainly before you
point it at a private repository: the same rules apply as for any other use of Claude Code
on that code. `--dry-run` submits nothing to GitHub, but it is not an offline mode: it still
runs the abridgement's model pass, so the diff is still sent.

Nothing else is transmitted. The only other network calls are to GitHub, through `gh`'s
credentials and the Octokit client, to read the pull request and to submit your review.

## Billing

marrow uses your **Claude Code subscription**, not metered API billing.

Claude Code resolves credentials in the order `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN`
→ your OAuth profile. A stray key in your shell would therefore put every review on the API
quietly. marrow removes both variables from the agent subprocess unless you pass
`--use-api-key`, and tells you once when it does.

## Development

```bash
bun install
bun test              # the whole suite
bun run typecheck     # tsc over src and tests both
bun run lint:boundary # src/core must never import UI
bun run build         # tsc -> dist/, the published bin
```

The suite needs [bun](https://bun.sh): tests import `bun:test`. The package itself runs on
plain Node 24+ — bun is a development dependency of the repository, not of the tool.

`src/core/**` is a pure library with no UI imports, enforced by dependency-cruiser.
`src/tui/**` is the Ink layer. The split is deliberate: the hard parts — diff parsing,
anchoring, the meat engine, review construction — are testable without rendering, and a
non-terminal frontend could reuse them.

Layout arithmetic lives in pure modules next to the components that draw from it
(`fileindex.ts`, `viewport.ts`, `picker.ts`, `chrome.ts`, `hittest.ts`, `help.ts`,
`hints.ts`) and is unit-tested
directly. In a terminal, "the renderer and the scroll maths disagree by one row" is a real
class of bug, and the fix is to have exactly one of them.

Interface decisions and the reasoning behind them live in `.interface-design/system.md`.
The design documents behind each feature are in `docs/design/`, and `RELEASING.md` covers
cutting a release.

## Status

Early. The submit path is thoroughly unit-tested and validates every anchor locally before
sending — GitHub rejects a review atomically if one comment is badly anchored — but it has
not yet been exercised against a wide range of live pull requests.

## License

[MIT](LICENSE) © Sean Fisher
