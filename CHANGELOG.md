# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **marrow is now a local web app.** `npx marrow-review` starts a small server bound to
  `127.0.0.1` and opens a GitHub-styled review page; the Ink TUI is gone. Every button
  shows its keyboard shortcut, and `?` lists them all.
- **The review pass applies a generic rubric** modeled on Alley's code-review skill and
  Claude Code's `/code-review`: findings are `blocking` or `non-blocking`, carry a type
  (Security, Correctness, Performance, Accessibility, Maintainability, Tests, Docs,
  Process), and correctness issues carry a concrete failure scenario. Uncertainty becomes
  a question, never a blocker. The repository's `CLAUDE.md`/`AGENTS.md` from the base
  branch are read as project conventions.
- **Only findings with a failure scenario are put to the refutation lenses;** cleanups and
  questions are left `plausible` rather than refuted for not describing a failure.
- Outside a clone, the model passes now run through the GitHub API instead of switching off.

### Added

- **Grouping by intent**, after pulls.review: the kept hunks are grouped by what they are
  for, core change first. Anything the model does not place lands in a visible Ungrouped
  group, and a failed grouping falls back to directories.
- Comment on a block by dragging across the gutter; Write/Preview with GitHub's own
  rendering; `:` emoji and `@` mention autocomplete; a Suggest change button.
- Per-file Viewed checkboxes that notice when a file changes after you viewed it.
- An Ask Claude panel scoped to the code under the cursor.
- `--source auto|checkout|worktree|api`, `--effort low|medium|high`, `--standards <dir>`,
  `--port`, `--no-open`, and `owner/repo#n` targets.
- A Claude Code plugin with a `marrow` skill that launches the app.

### Removed

- `--no-highlight` (the page highlights with Shiki and follows the system theme).

## [0.3.1] - 2026-09-28

### Fixed

- **The abridgement no longer dies with `error_max_structured_output_retries`.**
  The classifier asks for its verdicts before its summary; written the other way
  round, a long summary could swallow the verdicts until Claude Code gave up.
- **A classifier failure no longer offers `R`,** which only re-runs the findings
  pass and so could never help.
- **A model pass that exhausts its schema retries says what the schema
  rejected,** instead of only the SDK's subtype.

## [0.3.0] - 2026-09-18

### Changed

- **A clean checkout already at the pull request head is read directly, instead
  of always cloning into a detached worktree.** The agent still gets to read
  whole files and find call sites either way; when the checkout differs, has
  tracked or untracked changes, or can't be inspected, marrow falls back to the
  worktree as before. Untracked-file detection ignores the user's own
  `status.showUntrackedFiles` config so a hidden file can't slip past the
  cleanliness check.
- Added a screenshot to the README.

## [0.2.0] - 2026-08-06

Missing tools are named, and named accurately. Every one of these failures was
already survivable — this release is about what marrow says when they happen.

### Changed

- **A missing `gh` is told apart from a `gh` that is signed out.** The fallback
  to `GITHUB_TOKEN` is unchanged; the error when there is no token no longer
  tells you to run `gh auth login` against a `gh` you do not have.
- **A model pass that dies says why, and only offers `R` when retrying could
  work.** Claude Code failing to start or to authenticate produced "Model pass
  failed — press R to retry", which is advice that cannot succeed. Both causes
  are now named with their remedy, and the retry is offered only for failures
  that might not recur. The chat pane and `--dry-run` carry the same reason.
- **An abridgement that kept everything says whether that was a judgement.**
  `MeatResult` now carries the classifier's failure, so a diff with nothing cut
  can distinguish "the model read it all and kept it all" from "the model never
  answered".

### Fixed

- **A missing `git` no longer reports a missing GitHub remote.** Every detection
  failure said "Not inside a GitHub clone"; each cause — no `git`, no
  repository, no `origin`, a non-GitHub `origin` — now says itself.

## [0.1.0] - 2026-08-06

Initial release: a terminal tool for reviewing large pull requests, published as
`marrow-review` and run as `marrow`.

### Added

- **The abridgement.** Deterministic rules drop lockfiles, generated output,
  snapshots, minified files, deleted files, pure moves, whitespace-only and
  import-only hunks; the highest-signal rule reads `.gitattributes` for
  `linguist-generated`. A model pass classifies what survives, and a
  content-addressed cache means a hunk is never judged twice. Every drop
  collapses into a visible fold naming the rule that dropped it.
- **Findings.** A find pass anchored to lines, a verify pass that tries to refute
  each finding through two independent lenses (reachability and reproduction),
  and triage: accept, rewrite, suggest, or drop. Refuted findings are hidden
  rather than deleted — `v` brings them back with the refutation attached.
- **The review TUI** (Ink): a full-screen pull-request picker with a live filter,
  a diff pane with a file-index header and the meat gauge, inline comments and
  suggestions on a line or a selected range, `$EDITOR` integration, existing
  review threads, syntax highlighting, mouse support, and a grouped help
  overlay.
- **One GitHub review.** Every anchor is validated locally before sending, since
  GitHub rejects a review atomically if one comment is badly anchored. Drafts are
  written through to disk as you go, and a review left with `esc` stays warm.
- **Subscription billing by default.** `ANTHROPIC_API_KEY` and
  `ANTHROPIC_AUTH_TOKEN` are withheld from the agent subprocess unless
  `--use-api-key` is passed, so a stray key in your shell cannot quietly move
  every review onto metered API billing.
- **Isolation from the reviewed code.** The agent runs with `Read`, `Grep`, and
  `Glob` only, in a detached worktree at the pull request's head, with
  `settingSources: []` so a `.claude/settings.json` committed by the pull
  request's author cannot define hooks that run on the reviewer's machine.
