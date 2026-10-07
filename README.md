```
█▄ ▄█ ▄▀▀▄ █▀▀▄ █▀▀▄ ▄▀▀▄ █   █
█ ▀ █ █▄▄█ █▄▄▀ █▄▄▀ █  █ █ ▄ █
█   █ █  █ █ ▀▄ █ ▀▄ ▀▄▄▀ █▀ ▀█
```

**A large diff, abridged to what carries meaning.**

marrow is a local web app for reviewing large pull requests. It cuts the diff down to the
parts worth reading, groups what is left by what it is for, drafts findings anchored to
specific lines, lets you accept, rewrite, or throw each one away, and submits a single
GitHub review with inline comments and suggestions.

<img width="1440" height="900" alt="marrow reviewing a pull request: changes grouped by intent in the sidebar, an overview with Claude's summary and finding counts, and a syntax-highlighted GitHub-style diff" src="docs/screenshots/review.png" />

```bash
npx marrow-review 42      # inside a clone: review PR 42 in your browser
```

---

## Why

A 3000-line pull request is mostly not worth reading. Lockfiles, generated clients, import
churn, and reformatting drown the twenty lines where the actual decision lives. marrow
separates the two, shows you the second, and keeps the first one keystroke away.

Nothing is ever hidden. Every dropped hunk collapses into a visible fold that names the
rule that dropped it, the header counts what was kept, and one key expands any of it in
place. An abridgement you cannot audit is just a tool with an opinion.

What survives is then **grouped by intent**, not by directory: the core change first,
supporting changes next, mechanical ones last, each group with a sentence on why it exists.
One feature that touches five modules reads as one group.

The abridgement is borrowed from [`boldsoftware/meat`](https://github.com/boldsoftware/meat),
and the grouping from [pulls.review](https://github.com/antfu/pulls.review) (MIT). marrow
reimplements both in TypeScript and builds a review workflow around them.

## Requirements

- Node 24+
- [`gh`](https://cli.github.com) 2.97+, authenticated (`gh auth login`) — or a `GITHUB_TOKEN`
  in the environment, which marrow falls back to when `gh` is absent
- A Claude Code subscription. Claude Code itself ships with marrow, so there is nothing
  else to install; if it cannot start or cannot authenticate, marrow says so and carries
  on without the model passes — the diff, your comments, and submitting all still work.

## Use

```bash
npx marrow-review                  # pull requests for the repo you are standing in
npx marrow-review 42               # review PR 42
npx marrow-review <url>            # review a PR by URL, any repository
npx marrow-review owner/repo#42    # the same, shorter
npx marrow-review --dry-run 42     # print the abridged diff, submit nothing
```

marrow starts a small server on `127.0.0.1`, prints `marrow: <url>`, and opens your
browser. The URL carries a random token; nothing else on your machine can talk to it.
`Ctrl-C` stops it. The package is `marrow-review`; installed globally
(`npm i -g marrow-review`) the command is `marrow`.

### From Claude Code

The repository is also a Claude Code plugin with a `marrow` skill:

```
/plugin marketplace add srtfisher/marrow-review
/plugin install marrow@marrow
```

Then "review PR 42 in marrow" starts the app and hands you the link. The skill launches
marrow and nothing else — the review is yours.

### Where the agent reads from

Run it from inside a clone and the agent can read whole files and find call sites, not just
the diff. If the pull request's head is already checked out and clean, marrow reads it in
place; otherwise it fetches the head commit into a detached git worktree. Outside a clone —
or with `--source api` — the agent reads files through the GitHub API at the head commit.
That mode cannot search the repository (GitHub only indexes the default branch), and the
header says so rather than letting you trust a half-evidenced review.

### The Mac app

There is also an optional Mac app: the same page in a window of its own, with a Dock icon
and a notification when Claude's review lands, so you can switch away while it runs.
⌘N opens another window and ⌘T another tab, for a second review alongside the first.
Install it with Homebrew:

```bash
brew install --cask srtfisher/marrow/marrow
```

`brew upgrade` picks up new releases. The cask clears macOS's download quarantine for you,
since the app is not signed with an Apple Developer ID.

To install by hand instead, download `marrow-<version>-mac-arm64.zip` (Apple silicon) or
`-mac-x64.zip` (Intel) from [Releases](https://github.com/srtfisher/marrow-review/releases),
unzip it, and move `marrow.app` to Applications. Because of the missing Developer ID, macOS
blocks it the first time. Either clear the download quarantine once:

```bash
xattr -dr com.apple.quarantine /Applications/marrow.app
```

or open it, dismiss the warning, and choose **Open Anyway** under System Settings › Privacy
& Security. Allow notifications when macOS asks.

It needs the same things as the command: `gh` signed in, and Claude Code installed and
signed in — the app uses the `claude` on your machine rather than bundling its own. If
`gh` is missing or signed out, the window says so and how to fix it; if Claude Code is
missing, the app says so once and still opens: the diff, your comments, and submitting
all work without it. **File › Open Local Checkout…** (`⌘O`) points it at a clone of the repository you
review, so Claude can search it, as running `marrow` inside a clone does; without one it
reads through the GitHub API. The passes you choose are remembered between launches.

## Reviewing

The page is GitHub's files view with two additions: a sidebar of groups, and Claude.

- **Read.** `j`/`k` move a line cursor; `]`/`[` jump files, `}`/`{` groups. Folded hunks
  name their rule; `z` reveals them, `d` switches to the full diff. Each file has a
  **Viewed** checkbox (`w`) that folds it away and notices if it changes after you viewed it.
- **Triage Claude.** Findings appear in purple under their line — purple is only ever the
  model — each marked `blocking` or `non-blocking`, with a type, the reviewers that raised
  it, a 0–100 confidence score, and, for bugs, the concrete failure it would cause. `a`
  accepts, `e` rewrites, `s` posts it as a suggestion, `x` drops it, `n`/`p` move between
  them. Findings scored below the line fold into **Low confidence**; `v` shows them.

  <img width="1440" height="900" alt="A blocking Correctness finding with its failure scenario and Accept, Edit, and Drop buttons showing their keys" src="docs/screenshots/finding.png" />

- **Comment.** Click a line number, or drag or shift-click across the gutter to select a
  block, then `c` (or the `+` beside the line). The composer previews with GitHub's own
  renderer, autocompletes `:emoji:` and `@mentions`, and **Suggest change** (`⌘G`) inserts
  a suggestion block prefilled with the selected lines.

  <img width="1440" height="900" alt="A comment on lines 99 to 101, previewed with GitHub's renderer: an emoji and a suggested change" src="docs/screenshots/comment.png" />

- **Ask.** `i` opens a panel to ask Claude about the code under the cursor.
- **Watch it work.** While Claude reviews, the header and the overview say what it is
  doing ("3/5 reviewers done · waiting on history"); scoring counts findings scored.
- **See the spend.** The header shows the tokens the review has used; `u` breaks them down
  by pass — abridge, group, review, score, ask — with turns, files read, cache reads, time, and the SDK's
  API-equivalent cost estimate.
- **Submit.** `!` opens the finish dialog: summary, verdict, and what will post.

Every button shows its key; `?` lists them all. Submit is `!` rather than a letter on
purpose: during triage the most-pressed keys are `a` and `x`, and approving someone's pull
request is outward-facing and awkward to undo.

Drafts are written through to disk as you go. Reopening a pull request picks the review up
where you left it, and carries comments over to a new head commit when they still anchor.

## Options

```
--model <alias>       Ask, and the tier the others step down from (default: opus)
--meat-model <alias>  diff classifier and grouping (default: one tier below --model)
--review-model <m>    the five parallel reviewers (default: one tier below --model)
--verify-model <m>    the scorer, one call per finding (default: two tiers below --model)
--source <s>          auto | checkout | worktree | api (default: auto)
--effort <e>          low | medium | high — how much the review reports (default: medium)
--standards <dir>     your team's review rules: every .md/.yml file in <dir>
--filter <f>          open | review-requested | all
--port <n>            listen on this port (default: any free port)
--no-abridge          abridge with the rules alone; no model classifier
--no-group            lay the diff out by directory instead of by intent
--no-find             skip Claude's review (and so its scoring)
--no-verify           skip scoring: findings arrive unscored, and all are shown
--no-open             print the URL instead of opening a browser
--claude-path <p>     use this Claude Code instead of the one bundled with marrow
--use-api-key         allow ANTHROPIC_API_KEY instead of the subscription
--dry-run             print, submit nothing
```

## The four model passes

Opening a pull request runs four passes, each a call (or a handful of calls) to Claude. All
four are on by default. Each can be switched off with a flag, or from **Passes** (`,`) in
the page, which changes the next pull request you open.

1. **Abridge** reads every hunk that no rule has already dropped and decides whether it
   carries meaning or is noise, with a one-line reason. It also writes the short "what this
   pull request does" summary. Off: the rules still fold lockfiles, generated files, and
   whitespace, but everything else is shown, marked as kept without being judged.
2. **Group** sorts what is left by what it is for, so a feature that touches five modules
   reads as one group, core change first. Off: the diff is laid out by directory.
3. **Review** (find) is five reviewers working at once, each reading the change from one
   angle — the project's conventions, bugs in the change itself, the code's history,
   comments from earlier pull requests, and the code's own comments — and drafting findings
   tied to lines. Off: there are no findings. `⇧R` runs it anyway for the review in front
   of you.
4. **Score** (verify) asks a small, fast model how confident it is that each finding is
   real, from 0 to 100, and folds the ones below the line out of the way. Questions are not
   scored. Off: findings arrive unscored, and all of them are shown.

Asking Claude about the code (`i`) is separate from these four. It runs only when you ask.

## How the abridgement works

1. **Deterministic rules**, instantly and free — lockfiles, generated output, snapshots,
   minified files, deleted files, pure moves, whitespace-only hunks, import-only hunks. Every
   drop is attributed to a named rule. The highest-signal rule reads your `.gitattributes`
   for `linguist-generated`, which is the maintainers' own statement about what is noise.
2. **A model pass** over what survives, classifying keep/drop with a one-line reason and
   writing the "what this PR actually does" summary.
3. **A cache**, keyed by hunk content, so the same hunk is never judged twice and a verdict
   cannot flip between runs.

Keeping is the safe default, which means a classifier that returns fewer verdicts than it
was asked for leaves hunks kept for no reason at all. `kept 244/245 lines` would look like
a judgment and actually be a shortfall, so the header counts those separately and says so.

## How grouping works

The kept hunks are given to the model as a manifest — directory, file, and each hunk's
function context — with the bodies inline when they fit and on demand when they do not.
Every hunk must land in exactly one group; a grouping that misses some gets one chance to
correct itself, and anything still unplaced goes to a visible **Ungrouped** group. A change
of three files or fewer is one group with no model call. If grouping fails, marrow groups by
directory and says why.

## How the review works

The review follows Claude Code's own `/code-review`, with the parts of Alley's code-review
practice that a score cannot express.

**1. Gather, once, with no model.** Before any reviewer starts, marrow collects what they
will read: the abridged diff; the full head version of each changed file, line-numbered
(largest change first, up to 40k characters a file and 150k in all, the rest listed by
path); `CLAUDE.md` and `AGENTS.md` from the **base** branch — at the root and in every
directory the pull request touches — because at the head they are the author's to edit;
your `--standards`; and, in one GitHub request, each changed file's last five commits and
the review comments left on that same file in the pull requests those commits came from.

**2. Five reviewers, in parallel, one turn each.** Each gets the shared rubric, one angle,
and only the material that angle needs:

| Reviewer | Looks for | Reads |
|---|---|---|
| conventions | departures from a specific rule in `CLAUDE.md`, `AGENTS.md`, or your standards, quoted | the diff and the conventions |
| bugs | large, obvious bugs in the change itself, with no reaching beyond it | the diff and the changed files |
| history | bugs in light of the code's history: a fix undone, an invariant an earlier commit set up | the diff and the commit history |
| prior comments | review comments on earlier pull requests to these files that apply again | the diff and those comments |
| code comments | changes that break what the code's own comments say must hold | the diff and the changed files |

A reviewer with nothing to read — no conventions, no history — does not run. None of them
has tools: everything they would go looking for was gathered for them, so each answers in
a single turn instead of wandering the repository a file at a time. Findings two reviewers
raise on the same point merge into one, crediting both.

**3. Score.** A small model scores each issue 0–100 on `/code-review`'s scale, verbatim —
from "a false positive that doesn't stand up to light scrutiny" to "definitely a real
issue, that will happen frequently in practice". It is given the hunk the finding is about,
may open up to three files to check it, and for a conventions finding is shown the
conventions so it can confirm the rule exists. The line is 80 at the default effort (90 at
`low`, 60 at `high`). Below it, a finding folds into **Low confidence** with the scorer's
reason — never deleted. A finding the scorer failed on stays visible, unscored.

**The rubric.** Severity is `blocking` (must change before merge) or `non-blocking` (worth
fixing; never implied to gate the merge). Type is one of Security, Correctness,
Performance, Accessibility, Maintainability, Tests, Docs, Process — the earlier one wins
when two fit. Every correctness or security issue names a failure scenario: concrete
inputs, then what goes wrong; a finding that cannot name what breaks is dropped rather than
hedged. Real uncertainty is a **question** — never a blocker, never scored, raised only when
the answer would change the review. Out of scope unless your conventions or standards ask
for it: pre-existing issues and lines the pull request did not change, anything a linter,
type checker, or CI decides, test coverage, documentation, general code quality, nitpicks,
plainly intentional behavior changes, and rules the code explicitly silences.

`--standards <dir>` adds your team's own rules: every `.md` and `.yml` file in the
directory goes to the conventions reviewer, and to the scorer of any finding raised
against them. Nothing team-specific ships with marrow.

## What it costs, and what is cached

marrow spends tokens where they turn into findings, and tries not to spend them anywhere
else. Three rules do most of the work:

**The bulk passes run a tier down.** Only Ask uses the top model. The reviewers run a tier
below it, as `/code-review` runs its reviewers on Sonnet, and the scorer — one call per
finding — two tiers below:

| Pass | Model | Default | Runs |
|---|---|---|---|
| Abridge | `--meat-model` | one tier below `--model` (sonnet) | once, over hunks no rule dropped |
| Group | `--meat-model` | one tier below `--model` (sonnet) | once; skipped for three files or fewer |
| Review | `--review-model` | one tier below `--model` (sonnet) | five reviewers at once, one turn each |
| Score | `--verify-model` | two tiers below `--model` (haiku) | once per issue; questions are not scored |
| Ask | `--model` | opus | when you ask |

"A tier below" goes by model family, so `--model claude-opus-5-5` puts the reviewers on
sonnet and the scorer on haiku. The reviewers also reason at the review's own `--effort`
rather than the SDK's default of `high`, and the scorer at `low`: most of what a
structured answer costs is the thinking before it.

**Nothing is paid for twice.** Every model result is cached on disk, keyed on its inputs:

| Cache | Location | Keyed on | Reused when |
|---|---|---|---|
| Abridgement verdicts | `~/.cache/marrow/meat/` | each hunk's path and text (not its line numbers) | the same hunk appears again, in any pull request or push |
| Grouping | `~/.cache/marrow/groups/` | the set of kept hunks, plus the title and description | the same change is opened again |
| Each reviewer's findings | `~/.cache/marrow/findings/` | the model, the rubric and effort, and everything that reviewer was handed — so new conventions re-run only the conventions reviewer | you reopen or restart on an unchanged pull request |
| Scores | `~/.cache/marrow/findings/` | the scorer's model, the finding, and the code it is about | a finding comes back unchanged |

Change any input — push a commit, change `--effort`, switch the model, a new review thread
appears — and the affected pass runs again; the rest are still reused. A failure is never
cached: the caches have no expiry, so one bad run must not pin an empty result. The token
popover (`u`) labels anything that came from the cache, and `⇧R` re-runs the review and
scoring fresh, replacing what was cached. Deleting `~/.cache/marrow` is always safe;
it costs tokens, not work. Your drafts live separately, in `~/.local/state/marrow/reviews`.

**Measured, not assumed.** On a 19-file pull request (API source, default effort), the
single opus reviewer this replaced took 4m30s and $1.28–$3.09, and wandered: on a 12-file
change it opened 25 files, one turn each. The five tool-less reviewers take 3m33s and
$2.00, and scoring adds 24s and $0.23. A first version that gave two reviewers tools was
worse than either — $4.62, and one reviewer spent five minutes exploring before losing
everything to its turn limit — which is why none of them has tools now. The token popover
shows turns and files read per pass, so the next change can be measured the same way.

If findings are thin, spend more where it pays: `--effort high` lowers the line to 60 and
lets reviewers reason harder, and `--review-model opus` puts the reviewers on the top model.

## What the agent can and cannot do

The reviewers have no tools at all. The scorer and Ask run with `Read`, `Grep`, and `Glob` —
or, in API mode, two read-only tools that fetch files from GitHub, with the local file
tools denied — and nothing else. `Write`, `Edit`,
`NotebookEdit`, and `Bash` are denied. A review tool has no business modifying your
checkout, and denying `Bash` means it cannot run commands in your repository. The tool
policy is defined once and shared by every pass, with a test asserting the allow and deny
sets stay disjoint.

**If a model call fails, the review still works.** The agent passes are additive: a dead
subprocess, a rate limit, or malformed output costs you the findings, not the diff,
navigation, your own comments, or the ability to submit.

## What leaves your machine

Reviewing sends the pull request's diff to Anthropic, and whatever files the agent reads
while looking for call sites. That is the whole point of the tool, but it is worth stating
plainly before you point it at a private repository: the same rules apply as for any other
use of Claude Code on that code. `--dry-run` submits nothing to GitHub, but it is not an
offline mode: it still runs the abridgement's model pass, so the diff is still sent.

When marrow reuses the current checkout, ignored files remain available to the read-only
agent even though Git does not consider them checkout changes. Use a separate clone, or
`--source worktree`, if that checkout contains ignored files you do not want the agent to
be able to read.

Nothing else is transmitted. The other network calls are to GitHub, through `gh`'s
credentials: to read the pull request, render comment previews, list emoji and mentions,
and submit your review. The page itself is served from your machine and loads nothing from
elsewhere except avatars and emoji images from GitHub.

## Billing

marrow uses your **Claude Code subscription**, not metered API billing.

Claude Code resolves credentials in the order `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN`
→ your OAuth profile. A stray key in your shell would therefore put every review on the API
quietly. marrow removes both variables from the agent subprocess unless you pass
`--use-api-key`, and tells you once when it does.

## Development

```bash
bun install
bun test              # the whole suite
bun run typecheck     # tsc over src and tests, then over the web page
bun run lint:boundary # core imports no UI; the page imports core types only
bun run build         # tsc -> dist/, vite -> dist/web
bun run e2e           # the built page in Chromium, over a fixture server (no GitHub, no model)
```

The suite needs [bun](https://bun.sh): tests import `bun:test`. The package itself runs on
plain Node 24+ — bun is a development dependency of the repository, not of the tool.

`src/core/**` is a pure library with no UI or HTTP imports, enforced by dependency-cruiser.
`src/server/**` serves it over HTTP and server-sent events, and `startServer()` is a library
function so a desktop shell can host the same thing. `src/web/**` is the React page; the
arithmetic it draws from lives in pure modules under `src/web/lib` and is unit-tested
directly, so the renderer and the keyboard read one model of the page.

The Mac app is `desktop/`, its own package, and never part of the npm package:

```bash
cd desktop && npm install
npm start                 # Electron over the repo's dist/ (run the root build first)
bun test                  # the shell's pure helpers
npm run e2e               # the app itself, driven by Playwright, over the same fixture server
scripts/package.sh        # out/marrow-<version>-mac-<arch>.zip; pass arm64 or x64
scripts/icon.sh           # assets/icon.svg -> assets/icon.icns (needs librsvg)
```

Interface decisions and the reasoning behind them live in `.interface-design/system.md`.
The design documents behind each feature are in `docs/design/`, and `RELEASING.md` covers
cutting a release.

## Status

Early. The submit path is thoroughly unit-tested and validates every anchor locally before
sending — GitHub rejects a review atomically if one comment is badly anchored — but it has
not yet been exercised against a wide range of live pull requests.

## License

[MIT](LICENSE) © Sean Fisher
