# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
