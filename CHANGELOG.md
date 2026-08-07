# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
