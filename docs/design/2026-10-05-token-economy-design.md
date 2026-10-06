# Spending tokens on findings, not on repeats

**Date:** 2026-10-05
**Status:** approved direction (conversation), implemented. The findings cache stands; the
verify redesign was superseded the same day by 2026-10-05-parallel-review-design.md, which
replaced refutation with `/code-review`-style scoring.
**Size:** small — one cache, one rewritten pass
**Depends on:** 2026-10-05-pass-settings-design.md

## Why

> "i don't mind it using tokens if the results are good but wasting tokens is not allowed"

Measured on a 19-file pull request (alleyinteractive/kauffman#1827):

| Pass | Runs | Cost | What it bought |
|---|---|---|---|
| Review (find) | 1 | $1.28 | all ten findings |
| Verify | 10 | $12.24 | one finding hidden |
| Abridge, group | 0 | $0 | served from cache |

Two kinds of waste, neither of which buys a better finding:

1. **Paying twice for the same answer.** The draft store keeps accepted findings only, so
   every restart or reopen re-ran find (and verify) against an unchanged head. Three
   relaunches of #1827 in one afternoon paid for three identical reviews.
2. **Verify reading the repository from scratch, twice per finding, with no ceiling.** Each
   lens was its own agent, given the claim but not the code it was about, with no turn limit:
   about a million cache-read tokens per run to judge one claim.

Find is where tokens turn into findings, and it is left alone — `--effort high` remains the
way to spend more there.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Findings cache | Content-addressed on everything the review reads: model, the whole system prompt (rubric, effort, standards, conventions), and the prompt (kept hunks, threads, failing checks) with the abridgement summary left out | The summary is model prose that differs between a classified run and a fully cached one; keying on it would miss on the second run every time. Everything that changes the review's *input* changes the key. |
| Verify cache | Per finding, keyed on verify model + the verify prompt | A finding that survives a push with the same text and code is not re-verified. |
| Failures | Never cached — a failed find, or a finding no lens answered | The cache has no expiry; one bad run must not pin an empty review. Same rule as the meat and group caches. |
| `⇧R` | Bypasses the cache and overwrites it | Asking to run it again is asking for a fresh answer. |
| Verify shape | One agent per finding answers both lenses, each with its own verdict | The two questions read the same code; two agents read it twice. `scoreVerdict` and the UI are unchanged — still two refutations. |
| Verify context | The diff hunk the finding anchors to goes in the prompt | Without it the first several turns of every run were spent finding the code. |
| Verify ceiling | Prompt asks for at most a few reads; `maxTurns: 12` as the backstop | The SDK ends an over-limit run as an error with the tokens already spent, so the prompt has to keep it under; the cap only stops a runaway. A capped run yields no refutations, which scores `plausible` — never a false `confirmed`. |
| Verify only blocking? | No | Once verify is cheap, a non-blocking correctness claim is still worth checking. |

Lost: the two lenses are no longer independent agents; one context answers both. Each
must still be answered separately, and a finding is only hidden when both refute it.

## Where it lives

- `src/core/findings/cache.ts` — `FindingsCache` (memory and file-backed, under
  `~/.cache/marrow/findings/<owner>__<repo>.json`), `findingsKey`, `verifyKey`.
- `runFindings` takes an optional cache; `runVerify` takes an optional cache and an
  `excerpt(finding)` lookup.
- `ReviewSession` threads `findingsCache` from `SessionDeps`; `retryFindings()` runs fresh.
  The find and verify steps say when they were served from cache, and so does the usage
  popover.
