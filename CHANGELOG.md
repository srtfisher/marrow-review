# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.4] - 2026-10-07

### Added

- **GitHub failures explain themselves.** When submitting, listing pull requests, or loading
  one fails, marrow says why — never a blank message — and when the fault is GitHub's (a
  5xx, a rate limit, or no response at all) it quotes githubstatus.com: the overall status,
  each incident with its latest update, and the degraded components. GitHub's request id is
  shown for support. A failed submit says whether anything was posted.
- Command- or Ctrl-click a pull request in the picker to open it in a new tab.

### Changed

- The review header and the tab title name the repository beside the number, as
  `org/repo#N`.
- The picker refreshes every few minutes, and a pull request you just reviewed leaves
  "Review requested" without waiting for GitHub's search index.
- A pull request's details in the picker stay on one line, truncating the branch name.

### Fixed

- **Submitting during a GitHub outage looked like nothing happened.** The button spun and
  reset with no message, because GitHub's empty error response became a blank error the
  page did not show. The submit dialog's error and buttons are now pinned in view.
- A pull request that fails to load marks the step it was on as failed instead of leaving
  it running.

## [0.4.3] - 2026-10-06

### Added

- **Pick a verdict from the keyboard.** The finish dialog opens with the cursor in the
  summary, and ⌥1, ⌥2, and ⌥3 choose Comment, Approve, or Request changes from anywhere in
  it, each shown beside its option.

### Changed

- In the Mac app a submitted review returns straight to the pull request list, with a
  notice bar linking the review on GitHub. In a browser the "Review submitted" page stays.

### Fixed

- **The Mac app's review notifications never appeared.** macOS refuses notifications from
  an ad-hoc signed app; the app now bounces its Dock icon and posts the notice through
  `osascript` instead.

## [0.4.2] - 2026-10-06

### Changed

- The release workflow updates the Homebrew tap (`brew install --cask srtfisher/marrow/marrow`)
  through a deploy key, so each release reaches Homebrew without a manual step. No change to
  marrow itself.

## [0.4.1] - 2026-10-06

### Added

- **Review requests on the home screen.** Open pull requests waiting on your review, from
  every repository, are listed under the picker, each naming its repository. The list is
  hidden when there are none.
- The Mac app's About panel credits the author and links the repository, which also opens
  from Help › marrow on GitHub.

### Fixed

- **"Needs my review" listed every open pull request.** The list endpoint cannot filter by
  reviewer; the tab now searches for review requests, including ones made of your teams.

## [0.4.0] - 2026-10-06

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
- **The abridgement classifier gets no tools and short ids.** It had been browsing the
  directory marrow was started in and copying 64-character hashes back; on a five-file pull
  request it now answers in seconds instead of over a minute, and no longer exhausts its
  schema retries.

### Added

- **Grouping by intent**, after pulls.review: the kept hunks are grouped by what they are
  for, core change first. Anything the model does not place lands in a visible Ungrouped
  group, and a failed grouping falls back to directories.
- Comment on a block by dragging across the gutter; Write/Preview with GitHub's own
  rendering; `:` emoji and `@` mention autocomplete; a Suggest change button.
- Per-file Viewed checkboxes that notice when a file changes after you viewed it.
- An Ask Claude panel scoped to the code under the cursor.
- Token usage per pass (`u`): runs, input, output, cache reads, time, and the SDK's
  API-equivalent cost, including what failed runs spent.
- `--source auto|checkout|worktree|api`, `--effort low|medium|high`, `--standards <dir>`,
  `--port`, `--no-open`, and `owner/repo#n` targets.
- A Claude Code plugin with a `marrow` skill that launches the app.
- **An optional Mac app**, attached to each GitHub release: the page in its own window,
  a notification and Dock badge when the review lands, File › Open Local Checkout, and
  passes remembered between launches. It uses the Claude Code on your machine, and says
  so when `gh` or Claude Code is missing. Not signed with a Developer ID; see the README.
- `--claude-path <path>` to use an installed Claude Code instead of the bundled one.

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
