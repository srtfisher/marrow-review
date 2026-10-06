# marrow — from terminal to a local web app

**Date:** 2026-10-05
**Status:** approved design (sections 1–3 reviewed in conversation; 4–5 written from the
positions stated there), implementation in progress
**Size:** large — replaces `src/tui`, adds three core subsystems
**Depends on:** nothing

## Why

marrow's core — the abridgement, anchoring, find → verify → triage, review construction —
was built to be frontend-agnostic, and the terminal has become the constraint. A reviewer
wants to comment on a block by dragging across a gutter, see a suggestion rendered the way
GitHub will render it, type `:tada:` and get an emoji, and read a large change in the order
that explains it. A terminal does none of that well. The author's own
[address-pr-review](https://github.com/srtfisher/address-pr-review) skill proved the shape
that works: a small local server, a GitHub-styled React page, every button carrying its key.

## What was asked for

> "migrate this to a html application instead of terminal. the html application should be
> launched by a small web server. lets also try and implement some of pulls.review … that
> app will group the changes to their contextual areas. AND also apply the same review that
> /alley-code-review:code-review generates … it can be launched via a npx command or via a
> claude skill"

Settled in discussion:

- The web app **replaces** the Ink TUI. One frontend.
- **Keep the meat engine.** Abridgement stays the first stage; noise reduction is the point.
- Match address-pr-review: keyboard shortcuts **displayed on the buttons**, ease of use, UI
  and style matching GitHub.
- The review pass is a **generic** implementation of both Alley's code-review skill and
  Claude Code's own `/code-review` — nothing Alley-internal ships in the package.
- Review through a **checkout/worktree AND through the GitHub API alone**.
- An excellent reviewing experience: Claude's findings inline, commenting on blocks of
  code, GitHub emoji, suggestion blocks.
- It may later be wrapped in an **Electron/Mac app**.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Frontend | React 19 + Vite + Tailwind v4, Primer palette as `--gh-*` tokens | Lifts address-pr-review's `styles.css`, `Kbd`, diff table and dialog patterns nearly verbatim, which is what "the same feel" means in practice. |
| Server | `node:http`, no framework, `127.0.0.1:0`, token in URL checked with `timingSafeEqual` | Nothing a framework adds is needed; a random port and token keep other local processes and pages out. |
| Electron seam | `startServer(opts) → { url, close }` is a library function; the CLI is one caller | A future Electron main process calls the same function and points a `BrowserWindow` at `url`. The page assumes only HTTP + SSE to localhost. |
| Progress transport | Server-Sent Events | Every model pass is long; polling would either lag or hammer. SSE is one-way, which is all the passes need. |
| Review state | Moves from `App.tsx` into `src/core/session` | It was UI-owned only because the UI was the only consumer. In core it is testable without rendering, and an Electron app gets it for free. |
| Pipeline | abridge → (group ∥ find) → verify | Grouping and find both read only the kept hunks; neither waits for the other. |
| Grouping granularity | Hunks, not files (pulls.review groups files) | One marrow file often carries two concerns; hunk ids are content-derived so they cache. |
| Review sources | `checkout` / `worktree` / `api`, `auto` picks | API mode lets the model run when there is no clone at all, instead of today's diff-only with the passes switched off. |
| API mode tools | `read_file`, `list_dir` pinned to the head SHA; no search | GitHub code search indexes only the default branch. Search that silently reads the wrong version is worse than none. |
| Severity | `blocking` / `non-blocking` | The Alley model, and the honest one: the reviewer's real question is "does this hold the merge". |
| Project conventions | `CLAUDE.md` / `AGENTS.md` read at the **base** ref | At head, the pull request's author controls them, and could instruct the reviewer to look away. |
| Submit key | `!` (address-pr-review uses `f`) | `a` and `x` are the most-pressed keys in triage; approving is outward-facing and should not sit beside them. |
| Thread replies | Read-only threads in this change | Replying is a separate API call outside the single review; follow-up. |

## 1. Architecture

```
src/core/**     no UI, no HTTP (dependency-cruiser)
  agent/        + AgentTool: in-process tools for a run (API mode, read_hunks)
  source/       ReviewSource: checkout | worktree | api; what the agent may read
  group/        hunk grouping: manifest → model → coverage → reconcile → fallback
  review/       + rubric.ts: generic standards prompt material
  session/      ReviewSession: load sequence, passes, draft, triage, chat, submit; events
src/server/**   node:http; imports core, never web
  index.ts      startServer(opts) → { url, close }
src/web/**      React SPA, built by Vite to dist/web; imports core only as `import type`
src/cli.ts      args → startServer → open browser → wait for SIGINT; --dry-run text path
skills/marrow/  SKILL.md for launching from Claude Code
```

Boundary rules: `src/core` imports neither `src/server` nor `src/web` nor React; `src/server`
does not import `src/web`; `src/web` imports nothing from `src/core` or `src/server` at
runtime (`import type` only — dependency-cruiser's `tsPreCompilationDeps: false` ignores
type-only imports, so the rule is "no value imports").

### API

| Route | Purpose |
|---|---|
| `GET /api/app` | repo (if any), viewer, defaults, version |
| `GET /api/pulls?filter=&repo=` | the picker |
| `POST /api/sessions {repo?, number}` | open a PR; returns `{id}` and starts loading |
| `GET /api/sessions/:id` | snapshot: PR, meat, groups, findings, draft, threads, steps |
| `GET /api/sessions/:id/events` | SSE: `snapshot` on connect, then `step`, `meat`, `groups`, `findings`, `degraded`, `draft`, `chat` |
| `PUT /api/sessions/:id/draft` | verdict, body, comments; written through to `ReviewStore` |
| `POST /api/sessions/:id/findings/:fid` | `{action: accept|drop|edit|suggest, body?}` |
| `POST /api/sessions/:id/viewed` | mark a file viewed/unviewed by content hash |
| `POST /api/sessions/:id/chat` | ask about a hunk/selection |
| `POST /api/sessions/:id/retry` | re-run the findings pass |
| `POST /api/sessions/:id/submit` | demote unanchorable → build payload → submit |
| `GET /api/sessions/:id/file?path=&side=` | full file at head/base, for expand-context |
| `POST /api/markdown {text}` | GitHub-rendered preview (`POST /markdown`, `gfm`, repo context) |
| `GET /api/emoji` | GitHub's emoji map, fetched once and cached |
| `GET /api/mentions?q=` | assignable users |

Every route requires the `x-marrow-token` header; static assets are served without it so the
first page load works, and the page reads the token from its own URL.

### Lifecycle

The CLI runs in the foreground, prints `marrow: <url>`, opens the browser (`--no-open` to
skip), and exits on Ctrl-C. After a successful submit the session is closed; the server keeps
running for the picker.

## 2. Review sources

`--source auto|checkout|worktree|api` (default `auto`).

| Source | Agent reads with | `auto` picks it when |
|---|---|---|
| `checkout` | `Read`/`Grep`/`Glob` in the current clone | in the repo, HEAD is the PR head, tree clean |
| `worktree` | `Read`/`Grep`/`Glob` in a detached worktree | in the repo otherwise |
| `api` | `read_file(path)`, `list_dir(path)` at the head SHA | not in a clone of that repo, or worktree failed |

The header names the source; API mode adds "the agent can read files but not search". A
local source falling back to API on worktree failure is reported as a `degraded` event, not
silently. `.gitattributes` for the `linguist-generated` rule is read through the source, so
API mode has it too. `READ_ONLY_TOOLS`/`DENIED_TOOLS` remain the single definition; API mode
swaps the allowed set for the two MCP tool names; the disjointness test covers both.

The agent SDK's `cwd` is still required for API mode: it is set to an empty temporary
directory so `Read` (denied anyway) has nothing to see.

## 3. Screens

**Picker** — GitHub-styled list, Open / Needs my review / All tabs, type to filter, `j`/`k`
or arrows, `⏎` opens. With no repo, an input takes a PR URL or `owner/repo`.

**Review** — header (title, `#n`, state pill, `base ← head`, meat gauge, source, pass
status, **Ask** `i`, **Review changes** `!`); a sidebar of groups (category icon, label,
+/− counts, viewed donut, finding count) or files (`g` toggles); main column with an
overview (summary + rendered description), then each group: header with its why-summary,
then its files and hunks. Ungrouped and "Dropped by abridgement" are the last two sections.

**Diff** — GitHub-styled table, unified (split with `u`), Shiki highlighting loaded lazily,
expand-context rows backed by `/file`, `d` toggles meat ↔ full diff. Dropped hunks are
attributed folds (`z` reveal here, `Z` everywhere). Per-file **Viewed** checkbox keyed by
content hash, showing "changed since viewed" when the hash moves.

**Findings** — inline under the anchor, purple "agent" styling (purple is only ever the
model): severity, type, verdict, failure scenario, suggestion rendered as a suggestion diff.
**Accept** `a`, **Edit** `e`, **Suggest** `s`, **Drop** `x`; `n`/`p` between findings; `v`
shows refuted ones with the refutation.

**Commenting** — click a line number, drag or shift-click to select a block, or `c` on the
cursor line / `V` to start a range. Composer: Write/Preview (GitHub-rendered), `:` emoji
autocomplete, `@` mention autocomplete, **Suggest change** inserts a prefilled
```` ```suggestion ```` block, `⌘⏎` saves, `Esc` cancels. Staged comments render as
"Pending" cards, editable and deletable.

**Ask Claude** (`i`) — side panel scoped to the hunk or selection under the cursor.

**Review changes** (`!`) — verdict radios (author-blocked ones disabled with the reason),
body composer, list of what will post, anchor problems flagged; green primary, `⏎`.

**Keys** — `j k` cursor · `] [` file · `} {` group · `n p` finding · `c V s` comment ·
`a e x` triage · `z Z` folds · `d u g t v` views · `i` ask · `o` open on GitHub · `?` help ·
`!` submit. Every button shows its key in a `<kbd>` and sets `aria-keyshortcuts`. Keys are
ignored while typing or with a dialog open.

## 4. Grouping

Input is the kept hunks only. Hunk id: `h_` + first 10 hex of `sha256(path + header +
body)`.

Prompt: PR title, description, commit subjects when >1; a manifest by directory — per file
`status +a/−d`, per hunk `id @@ section +a/−d`; hunk bodies inline when the total is under
150k characters, otherwise a `read_hunks(ids)` tool (40k per call, 200k total, steering
message when spent).

Output schema, rules in the field descriptions:

```ts
{ overallSummary: string,
  groups: [{ key, label /* ≤4 words */, summary /* why, not what */, category,
             hunkIds: string[], children?: [/* same, no deeper */] }] }
```

Categories: `ui api core data cli security tests docs examples deps build scripts config
i18n assets other`. Group by intent; core change first, mechanical last; tests as a child
of the feature they cover.

Coverage: missing/duplicate/unknown ids trigger one retry with the error list, then
reconcile — unknown dropped, duplicates first-wins, still-missing → **Ungrouped**.
Placement of dropped hunks: a fold sits in the group holding that file's nearest kept hunk;
files with nothing kept go to **Dropped by abridgement**. A file split across groups repeats
its header with "also in".

Degraded paths: ≤3 kept files skip the model (one group); model failure → deterministic
grouping by directory plus a `degraded` event; the fallback is never cached. Cache key:
sha256 of sorted hunk ids + title + body, no expiry, `~/.cache/marrow/groups/`. Model: the
meat model tier.

## 5. The review pass

The find prompt becomes a generic rubric (`src/core/review/rubric.ts`) combining the shape
of Alley's code-review skill and Claude Code's `/code-review`:

- **Severity** `blocking` ("must change before merge") / `non-blocking` ("worth fixing; do
  not hold the merge for it"). Never imply a non-blocking finding should gate a merge.
- **Type**, closed list in precedence order: Security, Correctness, Performance,
  Accessibility, Maintainability, Tests, Docs, Process. When two fit, the higher wins.
- **Kind** `issue` or `question`. Real uncertainty is a question, never a blocker.
- **Correctness and security issues carry a failure scenario** — concrete inputs or state
  → wrong output or crash. No scenario, no blocking correctness finding.
- **Cleanup lens** (from `/code-review`): reuse of an existing helper, simplification,
  efficiency — non-blocking by default.
- **Out of scope**: formatting, naming, anything a linter or CI decides, PR prose, the base
  branch choice. Accessibility is never suppressed on stack grounds.
- **Voice**: no "you"; ask rather than assert when scale or intent is unclear; name blockers
  plainly.
- **Project conventions**: `CLAUDE.md` and `AGENTS.md` at the base ref, truncated to 20k
  characters, labeled as the maintainers' conventions.
- **Team standards**: `--standards <dir>` appends every `*.md`/`*.yml` in it, so a team (Alley
  included) can supply its own rules without marrow shipping them.
- **Effort** `--effort low|medium|high` (default `medium`): low reports only what it is sure
  of; high includes plausible-but-unproven issues, labeled as such.

Schema change: `severity: blocking|non-blocking`, `type`, `kind`, `failureScenario|null`
join the existing fields; `confidence` stays. Verification runs only on issues with a
failure scenario — the refutation lenses ask whether a failure is reachable and reproduces,
which is meaningless for "this duplicates `formatDate`", and a lens that always refutes a
cleanup would hide every one of them. Unverified findings are `plausible`.

Drafts persisted by 0.3 carry no findings (findings were never persisted), so the schema
change needs no migration.

## 6. Distribution

- `npx marrow-review [pr|url]` — starts the server, opens the browser, prints the URL.
  `--port`, `--no-open`, `--source`, `--effort`, `--standards` join the existing flags.
  `--dry-run` and non-TTY keep the text path.
- **Claude skill** — `skills/marrow/SKILL.md` plus `.claude-plugin/plugin.json` make the
  repository installable as a Claude Code plugin. The skill runs
  `npx -y marrow-review@latest <pr>` in the background, reads the `marrow: <url>` line,
  and gives the reviewer the link. It does not review anything itself.
- **Electron** — not built here. `startServer` is the seam; nothing in `src/web` assumes a
  normal browser tab beyond `fetch` and `EventSource`.

## Removal

`src/tui/**`, `tests/tui/**`, and the dependencies only the TUI used (`ink`,
`ink-spinner`, `ink-text-input`, `cli-highlight`, `string-width`) are deleted. `react` moves
to the web build. `.interface-design/system.md` gets a new revision for the web, appended
rather than rewritten. The README is rewritten for the web app and credits pulls.review
(MIT) beside `boldsoftware/meat`.

## Testing

- core: sources (API tools against a fake Octokit), grouping (manifest, reconcile cases,
  retry, fallback never cached, small-PR skip, fold placement), rubric/prompt contents,
  verification skipping cleanup findings, session (load sequence, events, triage merge,
  draft write-through, submit) with `FakeTransport`.
- server: routes against an in-process server with a fake session; token rejection.
- web: pure modules (keymap, navigation, row building, selection → anchor) with `bun test`.
  No browser in CI; verified by hand with agent-browser.
