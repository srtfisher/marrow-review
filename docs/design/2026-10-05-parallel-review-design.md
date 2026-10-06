# The review pass, rebuilt on /code-review

**Date:** 2026-10-05
**Status:** approved, implemented — see "As built" for where it changed after measuring
**Size:** large — replaces the find and verify passes; touches session, rubric, UI cards
**Depends on:** 2026-10-05-token-economy-design.md, 2026-10-05-pass-settings-design.md

## Why

The review pass is one opus agent that reads the abridged diff and then explores, a file per
turn, with no budget. On a 12-file pull request it read 25 files, CONTEXT.md among them; on
19 files it took four and a half minutes and $1.28–$3.09, and two runs on the same head
returned 10 findings and then 5. Every turn re-sends the conversation so far, so cost and
time grow with how long it wanders, not with what it finds.

Asked for:

> "how can we optimize the token usage and speed of the review step" — "all" of: inline
> the changed files, a read budget, launching from a clone, parallel review.
> "keep it similar to /code-review from claude" — "Structure + scope".
> "also keep it similar to alley's code review"

Claude's `/code-review` runs five Sonnet reviewers in parallel, each with one narrow lens and
little reading, then has Haiku score every issue 0–100 and drops anything under 80. Alley's
code-review skill is one pass, but contributes the parts a score cannot: questions as a
first-class category, a severity model where non-blocking never gates a merge, a list of
findings *not* to raise, and "reads only to confirm or kill a named candidate".

marrow takes `/code-review`'s structure and scope, and Alley's generic practice. Nothing
Alley-specific ships; Alley's rules reach marrow through `--standards`.

## Pipeline

```
gather (no model) ──► 5 reviewers in parallel ──► merge ──► score each (Haiku) ──► threshold
```

### 1. Gather — once, no model, before any reviewer starts

| Input | Source | Bound |
|---|---|---|
| Abridged diff | the meat result | as today |
| Changed files, full head contents, line-numbered | `source.readHead` | 40k chars a file, 150k in all; largest kept change first; the rest listed by path |
| Conventions | `CLAUDE.md` / `AGENTS.md` at the **base** ref: the root, plus every directory holding a changed file | 20k chars, as today |
| Team standards | `--standards` | as today |
| History | GraphQL, one request: for each changed file, its last 5 commits at base, each commit's pull request, and that pull request's review comments **on the same file** | 15 files, 3 comments a thread |
| Threads, failing checks | as today | as today |

Gathering is additive like everything else: a failed GraphQL call leaves the history and
prior-comments reviewers with nothing, and they are skipped, not failed.

### 2. Reviewers — five, in parallel, one tier below `--model`

Each gets the shared rubric (below), its lens, and only the inputs its lens needs. A reviewer
whose input is empty does not run.

| Lens | Reads | Inputs | Tools |
|---|---|---|---|
| **conventions** | the change against `CLAUDE.md`, `AGENTS.md`, and team standards — guidance written for whoever writes code, so not every line applies to review | diff, changed files, conventions, standards | read-only, budgeted |
| **bugs** | a shallow scan of the changes themselves for large bugs; no context beyond the change | diff, changed files | none |
| **history** | the modified code against what its history says it was for | diff, changed files, commit history | read-only, budgeted |
| **prior comments** | review comments on earlier pull requests to these files that apply again here | diff, prior comments | none |
| **code comments** | the change against guidance in the changed files' own comments | diff, changed files | none |

Three of five run with no tools at all — they are one model turn. The two with tools get a
read budget stated in the prompt (Alley's rule: a read must confirm or kill a named
candidate) and a `maxTurns` backstop:

| `--effort` | Reads a tooled reviewer may make | `maxTurns` |
|---|---|---|
| low | 3 | 8 |
| medium | 6 | 14 |
| high | 12 | 26 |

### 3. Merge

Reviewers overlap. Two findings on the same path, anchored within three lines, with the same
type, merge: the higher severity wins, the longer body is kept, and both lenses are recorded.
Each finding carries `lenses: Lens[]` so the card can say who raised it.

### 4. Score — Haiku, one per issue, in parallel

Each issue goes to a scorer two tiers below `--model`, which is given `/code-review`'s 0–100
scale verbatim, the false-positive list below, the team's `anti_rules` and out-of-scope list
when standards provide them, the finding, the hunk it is anchored in, and the paths of the
convention files. For a convention finding it must confirm the file actually says it. It may
read up to 3 files; `maxTurns: 8`.

**Questions are not scored.** A question has no failure to be confident about; it is shown,
never blocking, with a suggestion to document the answer (Alley). The score replaces
`verdict` and `refutations` entirely: a finding has `score: number | null` and `scoreReason`.

### 5. Threshold

| `--effort` | Shown at or above |
|---|---|
| low | 90 |
| medium | 80 (`/code-review`'s line) |
| high | 60 |

Below the line is not deleted: it folds into **Low confidence (N)**, which `v` opens, with the
score and the scorer's reason on each card — the same "nothing hidden" treatment refuted
findings get today. A finding the scorer failed on stays visible as unscored.

## The rubric

Kept: blocking / non-blocking ("never imply a non-blocking finding should gate a merge"),
the closed type list in precedence order, failure scenarios for correctness and security,
anchoring, no "you", never reviewing the pull request's prose.

New, from `/code-review` — not raised unless the team's standards or `CLAUDE.md` ask:

- pre-existing issues, and real issues on lines the pull request did not change
- anything a linter, type checker, compiler, or CI decides
- test coverage, documentation, general code quality, general security hardening
- pedantic nitpicks a senior engineer would not raise
- changes in behavior that are plainly intentional or part of the broader change
- a rule the code explicitly silences (a lint-ignore comment)

New, from Alley: "if a finding cannot name what actually breaks, drop it rather than hedge";
the reader test (mechanism and observable consequence, actionable by someone new to the
repository); questions only when "the answer would change the review".

Performance and accessibility stay as types, raised when concrete — an unbounded query, a
removed label — because they are bugs, not general quality.

## Models and flags

| Role | Flag | Default |
|---|---|---|
| Reviewers | `--review-model` | one tier below `--model` (sonnet) |
| Scorer | `--verify-model` | two tiers below `--model` (haiku) |
| Ask | `--model` | opus |

The **verify** pass is now scoring: on by default again, because one Haiku call per issue is
the cheap filter the design depends on. `--no-verify` and the Passes panel still switch it
off, and findings then show unscored. `--effort` sets the read budget and the threshold.

## Caching, progress, usage

- Each reviewer's result is cached on its model and full prompt; each score on the scorer's
  model and prompt. A restart reuses both; `⇧R` re-runs all of it fresh.
- Progress: `Review · 3/5 reviewers done`, `Score · 4/9 scored`.
- Usage stays one row per pass (`Review` sums five runs). Turns and reads are recorded.

## Invariants

- A failed reviewer costs that lens's findings; the others land. All five failing is the
  findings-failed state that exists today.
- A failed scorer leaves its finding unscored and visible — never above or below the line by
  default.
- Failures are never cached.

## Not in this change

- `--standards` recursing into folders, selecting files, and stack-scoped rule files — needed
  to point it at Alley's skill folder directly; today a folder holding `profile.yml` and the
  one matching `rules-*.yml` works. A follow-up.
- Blame. History by commit is one GraphQL request; blame per range is one per file.

## Measuring it

alleyinteractive/kauffman#1827, API source, `--effort medium`, before and after: wall time,
cost, turns, reads, findings shown, findings folded. Before: 4m30s, $1.28–$3.09, 5–10
findings, turns and reads not yet recorded (they are now).

## As built

Measured on kauffman#1827 (19 files, API source, `--effort medium`), the draft above was
worse than what it replaced: $4.44 for the review and $0.18 for scoring, 5m29s, and the
history reviewer — one of the two with tools — tried tools API mode does not have, read
past its budget, hit its turn cap after five minutes, and lost everything it had found.
The SDK also reasons at `effort: 'high'` by default, which is where most of the 77k output
tokens went. Three changes, then measured again:

| Change | Why |
|---|---|
| **No reviewer has tools.** The read budget and `maxTurns` for reviewers are gone. | Everything a `/code-review` reviewer goes to fetch — conventions, history, prior comments — is gathered beforehand. Tools bought wandering and a failure mode that discards findings. The scorer keeps its three reads: checking one claim is where a read earns its keep. |
| **The full changed files go only to the bugs and code-comments reviewers.** | They read the code itself; the others judge the diff against conventions, history, or comments. Four copies of the same files were most of the 448k input tokens. |
| **Reviewers reason at the review's `--effort`; the scorer at `low`.** | `AgentRequest.effort`, passed to the SDK. |
| **API mode denies `Read`, `Grep`, `Glob`.** | They read an empty temporary directory there; denying them stops a run spending turns on them. `AgentAccess.deniedTools`, `deniedFor()`. |

| kauffman#1827 | Review | Score | Total | Shown |
|---|---|---|---|---|
| Before: one opus reviewer | 4m30s, $1.28–$3.09 | — | $1.28–$3.09 | 5–10, unscored |
| Draft: two reviewers with tools | 5m29s, $4.44, one reviewer lost | 31s, $0.18 | $4.62 | 1 |
| As built | 3m33s, $2.00, 0 failures | 24s, $0.23 | $2.23 | 2 at 90, 1 folded at 75, 1 question |

The review's wall time is its slowest reviewer: four of five finish within 75 seconds.
Progress names the reviewers still running ("waiting on history") so the long pole is
visible on every review, not only in a measurement.
