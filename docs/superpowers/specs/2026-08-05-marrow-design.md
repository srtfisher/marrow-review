# marrow — design

**Date:** 2026-08-05
**Repo:** `srtfisher/marrow` (private, possibly shared later)
**Status:** approved design, ready for implementation planning

## What it is

A terminal app for reviewing large GitHub pull requests. It abridges a diff down to the
parts that carry meaning, drafts a set of findings for you to triage, and submits one
GitHub review with inline comments, suggestions, and an approve / request-changes /
comment verdict.

Prior art: [`boldsoftware/meat`](https://github.com/boldsoftware/meat) — a Go CLI that
model-abridges a diff into a "reading diff", chunking at file and hunk boundaries for
large commits. marrow reimplements that idea in TypeScript; it does not depend on `meat`.
The review UI takes inspiration from hand-rolled PR review apps (two-pane list + detail
with a collapsible "meat" section above the diff).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Platform | Ink TUI, not a Laravel web app | The Agent SDK is Node — a web app needs a PHP→Node bridge. Triage is keyboard-shaped. Distribution is one command. |
| AI backend | `@anthropic-ai/claude-agent-sdk` (0.3.222) embedded in-process | Streaming, tool use against the real repo, session resume. Uses the Claude Code subscription. |
| Billing | Subscription only, by default | See *Auth* below. |
| Division of labor | AI drafts findings, human triages | Fastest path through a 3000-line PR. |
| Meat engine | Deterministic rules, then LLM classification | Cheap wins are free and testable; the model handles what rules can't. |
| Repo context | Run inside a clone; PR head in a detached worktree | Findings quality depends on the agent reading whole files and finding call sites. |
| Entry point | Two-pane, current repo | Every PR in the list is one you have a clone for. |
| v1 also includes | Existing threads + CI status, resume, adversarial verify, freeform chat | All four selected. |

## Architecture

One npm package (`@srtfisher/marrow`, `bin: marrow`), two source trees with an
enforced boundary:

```
src/core/**   zero UI imports — dependency-cruiser rule fails CI on violation
src/tui/**    Ink components; may import core, never the reverse
src/cli.ts    arg parsing, renders <App/>
```

Single package rather than workspaces: the boundary is a lint rule rather than a
convention, without workspace tooling. `src/core` lifts out cleanly if a web frontend
is ever wanted.

TypeScript strict, full type coverage. `bun test`.

### Core modules

| Module | Responsibility |
|---|---|
| `core/github` | Octokit REST + GraphQL. Returns domain types (`PullRequest`, `ReviewThread`, `CheckRun`), never raw API shapes. |
| `core/git` | Locates the repo, fetches `refs/pull/N/head`, manages detached worktrees under `~/.cache/marrow/worktrees/`, prunes stale ones. |
| `core/diff` | Unified-diff parser → `File[] → Hunk[] → Line[]`, each line carrying old and new line numbers. Makes inline comments anchorable. |
| `core/meat` | Rule engine + LLM classifier. One verdict per hunk, with a reason. |
| `core/findings` | Findings pass + adversarial verify pass. |
| `core/agent` | Thin wrapper over the Agent SDK: session lifecycle, streaming, structured output, `resume`. Transport is injectable for tests. |
| `core/review` | Review state machine — pure functions over triage state. Where correctness lives. |
| `core/store` | Resume persistence and the meat verdict cache. |

### Flow when a PR opens

```
resolve repo + PR ──┬─► github: metadata, files, diff, threads, checks   (parallel)
                    └─► git: fetch PR ref → worktree
                              │
                         diff parse
                              │
                meat: rules (instant) ─► LLM classify (streams in per file)
                              │
                findings agent ─► verify (per finding, concurrent)
                              │
                      triage ─► submit one GitHub review
```

Two properties follow from this shape:

- **The screen is useful before the AI is.** Rules run in milliseconds, so a ranked,
  mostly-abridged diff renders immediately. LLM verdicts and findings stream in and
  re-render. Nothing blocks on a model.
- **Everything caches by head SHA.** Reopening a PR costs nothing. A new commit
  invalidates it. Necessary given findings run automatically on open.

## Auth

### GitHub

Shell out to `gh auth token` at startup and hand the result to Octokit; fall back to
`GITHUB_TOKEN`. No new PAT to create or rotate.

### Anthropic — subscription, guaranteed

Claude Code resolves credentials in the order `ANTHROPIC_API_KEY` →
`ANTHROPIC_AUTH_TOKEN` → the OAuth profile from `/login`. A stray `ANTHROPIC_API_KEY`
in the environment would therefore put every review silently on metered API billing.

**marrow deletes both variables from the spawned subprocess's environment** unless
`--use-api-key` is passed. Subscription auth is the guaranteed default, not the likely
one. If a key is stripped, the status line says so once.

Consequence: the status bar shows a **usage** indicator, not dollars — nothing is billed
per token under subscription auth.

## Meat engine

### Pass 1 — deterministic rules

Every drop is attributed to a named rule and logged. No anonymous drops.

**File-level:** lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
`composer.lock`, `go.sum`, `Cargo.lock`, `Gemfile.lock`), generated output (`dist/`,
`build/`, `vendor/`, `*.pb.go`, `*_pb2.py`, `*.min.js`), snapshots
(`__snapshots__/*.snap`), binaries.

The highest-signal rule reads the repo instead of guessing: **`.gitattributes`
`linguist-generated`**. That is the maintainers declaring what is noise, in their own
words, and it beats any pattern list.

**Hunk-level:** whitespace-only, import/`use`-block-only, identical after whitespace
normalization, license headers, 100%-similarity renames.

Surviving hunks that aren't dropped are also *ranked*, so the important ones sort first.

### Pass 2 — LLM classification

Surviving hunks are chunked at file and hunk boundaries (never mid-hunk), classified
`keep`/`drop` with a one-line reason, concurrently, then merged. The same pass produces
the "what this PR actually does" summary that sits above the diff.

**Verdicts cache by hunk content hash.** Without this the same hunk is re-judged every
run and can flip between `keep` and `drop`, which reads as unreliability. With it, a hunk
has one verdict for as long as its bytes don't change. Cache lives at
`~/.cache/marrow/meat/{repo}/` and is shared across PRs in the repo.

### Nothing is hidden

- `kept 59/106 lines in 2/3 files` in the header.
- `z` expands the dropped hunks under a file in place; `Z` expands everything.
- Each dropped hunk shows either its rule name or the model's reason.

## Findings and verification

### Pass 3 — findings

The agent runs pointed at the worktree with `Read` / `Grep` / `Glob` and nothing else.
`Write`, `Edit`, `NotebookEdit`, and `Bash` are denied via `disallowedTools` plus a
`canUseTool` callback that rejects anything not read-only. A review tool has no business
mutating the checkout. Denying `Bash` also means no running the test suite — accepted
trade for v1: slower findings beat an agent executing arbitrary commands.

Inputs: the abridged diff, the PR description, **existing review threads** (so it stops
before re-raising a colleague's point), and failing check output.

Structured output per finding: `file`, `line`, `side` (`RIGHT` for the post-image,
`LEFT` for a deleted line), `severity`, `title`, `body`, `confidence`, and an optional
`suggestion` holding replacement code. Multi-line findings also carry `start_line`, and a
multi-line suggestion must span exactly the lines it replaces.

**Anchoring constraint.** GitHub accepts inline comments only on lines present in the
diff. A finding about an unchanged line elsewhere in the file is still worth reporting,
but cannot be an inline comment — the review builder detects this and demotes it to a
top-level review comment rather than failing at submit time.

### Pass 4 — adversarial verify

Two refuters per finding with distinct lenses: *is this code path actually reachable* and
*does the failure actually reproduce*. Findings arrive labeled `confirmed` / `plausible` /
`refuted`. Refuted findings are collapsed behind a keystroke with the refutation
attached, never deleted — a wrong verifier must be visible.

### Models

The tier ladder is `opus` → `sonnet` → `haiku`; "one tier below" means the next entry down,
and `haiku` stays at `haiku`.

| Pass | Default | Rationale |
|---|---|---|
| Meat classification | one tier below `--model` (so `sonnet` when `--model` is the default `opus`) | High-volume, mechanical. |
| Findings, verify, chat | `--model`, default `opus` | Where reasoning quality matters. |

`--model <alias>` sets the reasoning tier. `--meat-model <alias>` overrides the classifier
independently. `m` cycles the reasoning model live mid-session via the SDK's
`setModel()`.

## TUI

### Layout

Left sidebar ~34 columns: PR list, filter chips, count. Right pane flexes. Below ~100
columns it collapses to a single pane with `Tab` toggling.

### One cursor, not two modes

The detail pane's cursor moves over *review units* — hunks and findings interleaved, each
finding sitting directly under the hunk it concerns. The claim and the code are visible
together while reading; `n`/`p` jump finding-to-finding when triaging fast is preferable
to reading. Triage is not a separate screen, just the same cursor moving differently.

### Keymap

| Context | Keys |
|---|---|
| List | `j`/`k` move · `Enter` open · `1`/`2`/`3` Open / Needs-my-review / All · `/` filter by title or author |
| Navigate | `j`/`k` line · `Ctrl-D`/`Ctrl-U` half page · `]`/`[` file · `}`/`{` hunk · `n`/`p` finding · `Space` fold file |
| Reveal | `z` dropped hunks in file · `Z` all · `d` full diff ↔ meat · `t` existing threads · `c` checks · `o` open hunk on github.com |
| Triage a finding | `a` accept as inline comment · `e` edit in `$EDITOR` · `s` convert to suggestion · `x` drop · `v` see refutations |
| Author your own | `C` comment on line · `V` then `Shift-J`/`K` to select a range, then `C` · `S` suggestion |
| Ask | `i` chat about the hunk or finding under the cursor · `Esc` close |
| Submit | `!` opens the submit screen |
| Global | `?` help · `m` cycle model · `R` refetch · `q` quit (guards unsubmitted work) |

**Why `!` rather than `A`/`X` for submit.** Single-letter approve puts approving a pull
request one shifted keystroke from `a` (accept finding) and `x` (drop finding) — the two
most-pressed keys during triage. Approval is outward-facing and awkward to undo, so it
does not get a letter near the hot path. `!` opens a screen where you pick approve /
request-changes / comment explicitly, review the staged comments, write the review body,
and confirm. One review, one deliberate action.

### Status bar

```
srtfisher/repo#42 · kept 59/106 · findings 4✓ 2? · 3 staged · opus · 4 sessions · worktree ✓
```

The rightmost AI indicator reports **what marrow itself has spent this session** — session
count and accumulated token usage from the SDK's result messages. It deliberately does not
claim a percentage of your subscription limit: whether a usable rate-limit figure is
available from the SDK is unverified, and inventing one would be worse than omitting it.
If the SDK does expose remaining-limit data, showing it here is a cheap follow-up; if it
does not, the session/token counters stand on their own.

### Known UI engineering

1. **Ink has no scrollable viewport.** A window of lines is computed from cursor position
   and terminal height, re-rendered on resize. This is the main non-trivial UI work and
   should be one well-tested component the other views sit inside.
2. **Syntax highlighting has a correctness trap.** Highlighting each diff line
   independently breaks template literals, block comments, and multi-line strings. The
   correct approach: highlight the whole post-image file once from the worktree, then map
   highlighted lines onto diff lines.
3. **`$EDITOR` handoff is fiddly.** Suspend Ink's raw mode, spawn the editor with
   inherited stdio, resume and force a repaint.

Images in PR descriptions degrade to a placeholder plus `o` to open in the browser.

## Submitting a review

One `POST /repos/{owner}/{repo}/pulls/{n}/reviews` carrying `event`
(`APPROVE` / `REQUEST_CHANGES` / `COMMENT`), `body`, and `comments[]` of
`{path, line, side, start_line?, start_side?, body}`. Suggestions are a
` ```suggestion ` fence in the comment body — no separate API.

**GitHub rejects a review atomically.** One badly-anchored comment 422s the whole review,
including the good ones. Therefore every staged comment is validated against the parsed
diff *before* submit, so bad anchors surface in the UI while they can still be fixed. If
a 422 happens anyway, the draft survives, the offending comment is highlighted, and you
resubmit. Triage work is never lost to an API error.

Two GitHub rules the UI knows rather than discovers:

- **You cannot approve or request changes on your own PR.** If you are the author, both
  are disabled with a stated reason rather than failing at submit; comment is all that is
  left, and it is the default.
- **A review needs content, not a body.** GitHub accepts an empty review body on a
  non-approval as long as at least one inline comment carries text — only a review with
  neither a body nor a comment is rejected.
- **A pending review from the web UI conflicts.** Detected on open, with a choice to adopt
  or discard it.

`--dry-run` builds and prints the review payload without submitting. It is both the
integration test and the way to build trust in the tool early.

## Persistence and resume

State: `~/.local/state/marrow/reviews/{owner}-{repo}-{n}-{headSha}.json`, written
atomically (temp file + rename) so a crash cannot corrupt it. Contents: triage decisions
per finding, staged comments, draft review body, agent session IDs (so chat resumes with
its context).

Meat verdicts cache separately by hunk hash under `~/.cache/marrow/`, shared across PRs
in the repo.

**New commits mid-review.** The head SHA changes, which would normally discard everything.
Instead: staged comments whose anchor line still matches by content carry over; those that
don't are surfaced as orphaned, to be re-placed or dropped. PRs are pushed to constantly
during review, so this is the difference between the tool being usable on a live PR and
not.

*This carry-over is the first thing to cut if the implementation plan runs long* — plain
"start fresh on a new SHA" is still correct, just annoying.

## Failure handling

**Principle: a model failure never makes the app unusable.** The agent passes are
additive. If the SDK subprocess dies, a rate limit is hit, or structured output comes back
malformed (retried once with the validation error, then surfaced), the full diff, the
rule-based abridgement, navigation, and the entire manual comment-and-submit path all
still work. The findings pane shows what failed and offers retry.

| Failure | Behavior |
|---|---|
| No clone / not in a git repo | Degrade to diff-only mode with a banner. Never a blocked review. |
| Worktree creation fails (disk, permissions) | Degrade to diff-only with a banner. |
| Shallow clone | Fine — the diff always comes from GitHub; the worktree is only for reading context. |
| GitHub 5xx / 429 | Octokit retry with backoff; surface the rate-limit reset time. |
| Agent subprocess dies | Findings pane shows the error, offers retry; review remains fully usable. |
| Malformed structured output | Retry once with the validation error, then surface. |
| `Ctrl-C` during an agent run | `query.interrupt()`; state preserved. |

## Testing

Core is pure and injectable, so unit tests carry the weight.

- **`core/diff` gets a fixture corpus** — renames, binary files, mode changes,
  no-newline-at-EOF, empty files. Every anchoring bug traces back to this module, and a
  422 at submit time is the worst place to find one.
- **`core/meat` rules are table-driven**, positive and negative cases each, no model in
  the loop.
- **`core/review` state-machine tests**: triage transitions, payload construction, the
  demote-to-top-level path, validation rejections.
- **`core/github` runs against recorded fixtures.** No live calls in the suite.
- **Agent passes take an injected transport**, so tests use canned structured responses. A
  handful of live evals against real PRs sit behind an env flag.
- **TUI tests cover the viewport component and keymap dispatch** via
  `ink-testing-library`. Not whole-screen snapshots — they break on cosmetic changes and
  teach you to ignore them.

## CLI surface

```
marrow                      PRs for the current repo
marrow 42                   open PR 42
marrow <url>                open a PR by URL
marrow --model sonnet 42    set the reasoning tier (default: opus)
marrow --meat-model haiku   override the classifier independently
marrow --dry-run 42         build and print the review payload, don't submit
marrow --use-api-key        allow ANTHROPIC_API_KEY (metered billing) instead of stripping it
```

Optional config at `~/.config/marrow/config.json` for flag defaults.

## Out of scope for v1

- Cross-repo review inbox (`review-requested:@me` across all of GitHub)
- Replying to or resolving existing review threads
- Editing or deleting already-submitted comments
- Any configuration beyond CLI flags plus the optional config file
- Running tests or any `Bash` access from the findings agent

## Dependencies

| Package | Version at design time |
|---|---|
| `ink` | 7.1.1 |
| `@anthropic-ai/claude-agent-sdk` | 0.3.222 |
| `@octokit/rest` | 22.0.1 |
| `ink-text-input` | 6.0.0 |
| `zod` | for Agent SDK structured output and tool schemas |
| `dependency-cruiser` | enforces the core/tui boundary |

Node 24, bun for test and install. `gh` 2.97+ required at runtime for auth.

## Implementation note

The Agent SDK's exact streamed message type discriminators (`assistant` vs
`assistant_message`, etc.) must be read from the installed package's `.d.ts` rather than
from documentation, and pinned in `core/agent` behind our own types so the rest of the
codebase never touches SDK shapes directly.
