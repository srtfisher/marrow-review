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

   Run it with the shell tool's background option; it is a server and does not exit on its own. Pass through anything the human asked for:
   - `--effort low|medium|high` — how much the review pass reports (default `medium`).
   - `--standards <dir>` — a directory of the team's review rules (`.md`/`.yml` files) to apply on top of the built-in rubric.
   - `--source api` — review through the GitHub API without touching the checkout.
   - `--no-open` — when there is no browser on this machine.

4. **Hand over the link.** marrow prints one line, `marrow: <url>`, once it is listening, and opens the browser itself. Read the background output until that line appears (it takes a few seconds while it authenticates), then give the human the URL. Say that the abridgement, grouping, and review passes keep running after the page opens, and that `?` in the app lists the keyboard shortcuts.

5. **Leave it running.** Stop the background process only when the human asks, or when they say they have submitted and are done.

## If it fails

- `No GitHub credentials found` — they need `gh auth login`.
- `Claude Code could not authenticate` in the app — the model passes are off, but the diff, comments, and submitting all still work. Running `claude` once to sign in fixes it.
- Anything else: quote the error; do not retry in a loop.
