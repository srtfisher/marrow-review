---
name: marrow
description: Use when someone wants to review a pull request themselves, especially a large one — "review PR 123 in marrow", "open this PR for review", "help me review this pull request", a pasted pull request URL they are about to review, or "start marrow". Launches marrow, a local GitHub-styled web app that abridges the diff to what carries meaning, groups it by intent, and drafts findings the reviewer triages before submitting one GitHub review. Not for addressing feedback on your own PR (that is address-pr-review), and not for writing the review yourself.
---

# marrow

Start marrow for the human and hand them the link. The review is theirs: they read the abridged diff, triage Claude's findings, write their own comments, and submit from the app. You do not review the pull request, comment on it, or submit anything.

## Steps

1. **Work out the target.** A number means a pull request in the repository the session is in. A URL or `owner/repo#n` can be any repository. With no pull request named, marrow opens its picker for the current repository.

2. **Check the two requirements**, and stop with what is missing if either fails:
   - `node --version` is 24 or later.
   - `gh auth status` succeeds, or `GITHUB_TOKEN` is set.

3. **Launch it in the background**, from the repository root when there is one, so the agent can read a local checkout:

   ```bash
   npx -y marrow-review@latest <number|url|owner/repo#n>
   ```

   Run it with the shell tool's background option; it is a server and does not exit on its own. Pass through anything the human asked for, and nothing they did not: every default below is deliberate.

   **Models.** Aliases (`opus`, `sonnet`, `haiku`) or full model ids both work.
   - `--model <m>` — Ask Claude, and the tier the other passes step down from (default `opus`).
   - `--meat-model <m>` — the abridgement classifier and grouping (default: one tier below `--model`).
   - `--review-model <m>` — the five parallel reviewers (default: one tier below `--model`).
   - `--verify-model <m>` — the scorer, one call per finding (default: two tiers below `--model`).

   Only set the other three when the human names them; stepping down a tier is how marrow keeps the bulk passes from costing top-model prices. "Use opus for the review" means `--review-model opus`. "Use sonnet" means `--model sonnet`, which moves the reviewers and scorer to haiku.

   **Passes.** Every model pass runs by default, and each can be switched off. The flag names are the pass names, not the words people use:
   - `--no-find` — no findings: skip Claude's review ("just the diff", "no findings", "no code review"). Scoring goes with it.
   - `--no-verify` — skip scoring: findings arrive unscored and all are shown ("don't score them", "show me everything"). Scoring is one cheap call per finding, so only when asked.
   - `--no-abridge` — no meat analysis: abridge with the deterministic rules alone, no model classifier ("skip the meat").
   - `--no-group` — lay the diff out by directory instead of grouping by intent.

   Combine them freely: `--no-find --no-group` gives the abridged diff with no findings and a by-directory layout. Add `--no-abridge` as well and no model runs at all.

   **The review.**
   - `--effort low|medium|high` — how much the review reports (default `medium`). It sets how hard the reviewers reason and the score a finding needs to be shown: 90 at `low`, 80 at `medium` (`/code-review`'s line), 60 at `high`.
   - `--standards <dir>` — a directory of the team's review rules (`.md`/`.yml` files) to apply on top of the built-in rubric.
   - `--source auto|checkout|worktree|api` — where the agent reads the code (default `auto`). `api` reviews through the GitHub API without touching the checkout.

   **The app.**
   - `--filter open|review-requested|all` — which pull requests the picker lists (default `open`); only matters with no pull request named.
   - `--port <n>` — listen on a fixed port (default: any free port).
   - `--no-open` — print the URL instead of opening a browser, for a machine with no browser.
   - `--use-api-key` — bill `ANTHROPIC_API_KEY` instead of the Claude Code subscription. Only when the human asks; the key is withheld otherwise.

   **Not a launch.** `--dry-run <pr>` prints the abridged diff as text and exits, with no server and no review; use it in the foreground when the human wants to see the cut without opening the app. `--help` lists all of this.

4. **Hand over the link.** marrow prints one line, `marrow: <url>`, once it is listening, and opens the browser itself. Read the background output until that line appears (it takes a few seconds while it authenticates), then give the human the URL. Say that the abridgement, grouping, and review passes keep running after the page opens, and that `?` in the app lists the keyboard shortcuts.

5. **Leave it running.** Stop the background process only when the human asks, or when they say they have submitted and are done.

## If it fails

- `No GitHub credentials found` — they need `gh auth login`.
- `Claude Code could not authenticate` in the app — the model passes are off, but the diff, comments, and submitting all still work. Running `claude` once to sign in fixes it.
- Anything else: quote the error; do not retry in a loop.
