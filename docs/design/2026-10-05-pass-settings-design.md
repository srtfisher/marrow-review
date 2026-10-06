# Switching model passes off

**Date:** 2026-10-05
**Status:** approved design (reviewed in conversation), implemented. Superseded in part:
verify was briefly opt-in, then became scoring and on by default again
(2026-10-05-parallel-review-design.md); `--no-verify` switches it off.
**Size:** small — a config field threaded through core, server, CLI, and one popover
**Depends on:** 2026-10-05-web-app-design.md

## Why

Every review runs four model passes: abridge, group, find, verify. Each costs time and
tokens, and not every review wants all four — a reviewer who only wants the abridged,
grouped diff should not wait on, or pay for, findings; someone checking the abridgement
rules should not pay for the model classifier. Today the only way to skip any of them is
`--dry-run`, which skips everything but the abridgement and leaves no page.

## What was asked for

> "lets allow marrow to skip findings, code review analysis and meat analysis. they can pass
> this as arguments AND the UI can have a quick settings panel to manage these"

Settled in discussion:

- **All four passes** toggle independently.
- Abridgement off means **rules only**: the deterministic rules still fold, the model
  classifier does not run.
- The settings panel changes the **next review only**; an open review is never altered.
- The README explains the four passes in plain English.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Flags | `--no-abridge`, `--no-group`, `--no-find`; `--verify` | Matches `--no-open`. Verify is **off by default**: on a 19-file pull request it ran 10 agents for 20 minutes of summed time and $12 of the $13.50 total. `--no-verify` is still accepted. |
| Abridge off | Rules run; no model call, **no cache reads**, nothing written to the cache | "Rules only" should mean the same thing on the first run and the hundredth. Never writing keeps the no-expiry cache honest. |
| Attribution | `MeatResult.classifierSkipped`; unjudged hunks are reported as "model pass off", not as a failure | A shortfall must never read as a judgment, and a deliberate skip must not read as an error either. |
| Group off | The existing directory fallback, never cached; step `skipped` | Same layout a failed grouping produces, but named as a choice. |
| Find off | Findings status `off`; find and verify steps `skipped` | "0 findings" would claim the review ran and found nothing. |
| Verify off | Findings stay `plausible` with no refutations | `scoreVerdict` already means exactly that for zero refutations; nothing is promoted. |
| `⇧R` with find off | Runs find (then verify, if on) | Pressing it is an explicit request for the pass. |
| Ask (chat) | Not toggleable | It only runs when asked. |
| Where settings live | In the server process, seeded from the flags; copied into each session at creation | "Next review only" falls out of copying. |
| Persistence | None | The flags are the source of truth; a restart returns to them. |

## Core

`SessionConfig.passes: PassSettings` where
`PassSettings = { abridge: boolean; group: boolean; find: boolean; verify: boolean }`,
defined in `src/core/session/passes.ts` with `ALL_PASSES` (every pass on).

- `computeMeat` takes `classify: boolean` (default true). When false it applies the rules,
  marks every other hunk `keep: true, source: 'fallback'`, sets `classifierSkipped: true`,
  and touches neither the transport nor the cache. `unclassified` still counts those hunks.
- `ReviewSession.load` passes `classify: passes.abridge`; the abridge step finishes
  `skipped` with "rules only — N hunks kept unjudged".
- `runGroup` with `group` off lays sections out with `directoryGroups` and finishes
  `skipped`.
- `runFind` with `find` off sets findings `{ status: 'off' }` and both steps `skipped`.
  `retryFindings()` runs find regardless.
- With `verify` off, findings go straight to `done` as `plausible`; the verify step is
  `skipped`.

## Server

`AppOptions.passes` seeds a mutable value. `GET /app` includes `passes`; `PUT /settings`
with `{ passes }` validates four booleans and replaces it. `createSession` receives the
current value as an argument, so sessions already open keep theirs.

## UI

A **Passes** popover from a header button and from the picker, opened with `,` from the
keymap. Four switches, the verify switch disabled and shown off while find is off, and a
line saying the settings apply to the next pull request opened. The overview says "Review
pass off" when findings status is `off`.

## Tests

Args for each flag; for each pass, a session test that turning it off makes no transport
call for it and leaves its step `skipped`; rules-only meat reads and writes no cache; find
off skips verify; `retryFindings` runs find when it was off; `PUT /settings` changes the
next session and not an open one.
