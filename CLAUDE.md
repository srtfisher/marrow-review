# marrow

A local web app for reviewing large pull requests: it abridges the diff to what carries
meaning, groups it by intent, drafts findings anchored to lines, and submits one GitHub
review. `README.md` is the user-facing description — read it first for what the thing does
and why.

## Commands

```bash
bun test                          # whole suite; bun test tests/core/meat/ to narrow
bun run typecheck                 # tsc over src + tests, then over src/web (DOM, JSX)
bun run lint:boundary             # core imports no UI/HTTP; web imports core types only
bun run build                     # tsc -> dist/ (bin: dist/cli.js), vite -> dist/web
node dist/cli.js <pr> --no-open   # run it; prints `marrow: <url>`
```

Run all four before saying a change is done. `bun test` alone does not catch a type error in
a file no test imports, and `tsc -p tsconfig.json` does not cover `tests/`.

## Architecture

```
src/core/**   pure library, no UI or HTTP imports, enforced by dependency-cruiser
  agent/      AgentTransport — the seam every model call goes through; AgentTool for in-process tools
  source/     where the agent reads: checkout | worktree | GitHub API; the tool policy lives here
  diff/       unified-diff parser -> DiffFile[] / Hunk / DiffLine
  meat/       the abridgement: rules, then a model pass, then a cache
  group/      hunk grouping by intent: manifest -> model -> coverage repair -> fallback; layout
  findings/   find (generic rubric) -> verify (two refutation lenses) -> triage; chat
  review/     anchors, payload construction, verdicts, rubric.ts
  session/    ReviewSession: load sequence, passes, draft, triage, chat, submit — as patches
  github/     gh-based auth, Octokit client, GraphQL threads, contents, markdown/emoji, submit
  git/        repo detection, detached worktree for the head commit, .gitattributes
  store/      drafts written through to disk as you go
src/server/** node:http + SSE over ReviewSession; startServer() is the desktop-shell seam
src/web/**    React + Vite + Tailwind; page-model arithmetic lives in src/web/lib
src/cli.ts    args -> startServer -> open browser; --dry-run prints text
skills/       the Claude Code skill that launches marrow (plugin in .claude-plugin/)
```

The split is load-bearing, not decorative. The hard parts — diff parsing, anchoring, the
meat engine, grouping, review construction, the session — are unit-testable without
rendering, and the boundary rules exist so another frontend (a desktop shell) can reuse
them. Put logic in `src/core`, HTTP in `src/server`, drawing in `src/web`. When a component
needs arithmetic, write it as a pure module in `src/web/lib` (`rows.ts`, `anchor.ts`,
`nav.ts`, `keymap.ts`, `autocomplete.ts`) and test it in `tests/web`. The renderer and the
keyboard both read `buildPage`/`navRows`, so "the cursor and the page disagree by one row"
cannot happen; keep it that way.

`src/web` may import from `src/core` only with `import type` — the rule fires on a value
import. The page talks to the server over `fetch` and `EventSource` only.

## Conventions

- **ESM with explicit extensions.** `import { x } from './x.js'` — including from `.ts`
  files. `nodenext` resolution; a missing `.js` fails the build.
- **`strict` plus `noUncheckedIndexedAccess`.** `arr[0]` is `T | undefined`. In tests, `!`
  after a lookup is idiomatic; in `src`, handle the absent case.
- **Tests mirror `src`.** `src/core/meat/rules.ts` → `tests/core/meat/rules.test.ts`,
  `src/web/lib/rows.ts` → `tests/web/rows.test.ts`, using
  `bun:test` (`test`, `expect`, `describe`). Test names are sentences about behaviour
  ("keeps a rename that also changed content"), not "should" statements.
- **Never hit the network or a model in a test.** Use `FakeTransport` from
  `src/core/agent/fake.ts`, or a hand-written class implementing `AgentTransport` for
  failure paths. Diff fixtures live in `tests/fixtures/`.
- **Comments say why, not what.** This codebase's comments record the reasoning and the
  rejected alternative — usually because something once went wrong. Match that: if a line
  of code encodes a judgement, say what would break without it. Do not add comments that
  restate the code.

## Two invariants worth knowing before you change anything

**The model passes are additive.** A dead subprocess, a rate limit, or malformed output must
cost findings — never the diff, navigation, the user's own comments, or the ability to
submit. Every agent call is wrapped so failure degrades the result instead of failing the
run: a failed grouping falls back to directories, a failed review leaves the diff, a failed
checkout falls back to the API source. Keep it that way.

**Nothing is ever hidden.** Every dropped hunk collapses into a visible fold naming the rule
that dropped it, and one key expands it. When you add a way to omit something, add the fold
and the attribution in the same change. Relatedly: a shortfall must never be presentable as
a judgement — `MeatResult.unclassified` exists because "kept 244/245 lines" once meant the
classifier returned nothing, and looked like an opinion.

## The meat engine

`src/core/meat/rules.ts` holds every deterministic rule, split into `evaluateFile` (drops a
whole file) and `evaluateHunk` (drops one hunk). Adding a rule means: the check, its name in
`FILE_RULE_NAMES` or `HUNK_RULE_NAMES`, a test that it fires, and a test that it does *not*
fire on the nearest innocent case — that second test is the point. `scripts/build` is not
build output; `$_GET['copyright']` is not a licence header; a re-parented YAML key is not
whitespace.

Order in `evaluateFile` is priority order, and `linguist-generated` is first deliberately:
`.gitattributes` is the maintainers' own statement about what is noise.

The cache (`cache.ts`) is content-addressed and has **no expiry**, which is why a synthetic
"kept by default" verdict must never be written to it — one degraded run would disable
abridgement for those hunks forever. The grouping cache (`group/cache.ts`) follows the same
rule: the directory fallback is never cached.

## Agent tool policy

`READ_ONLY_TOOLS` and `DENIED_TOOLS` in `src/core/source/index.ts` are the single
definition (re-exported from `findings/find.ts`), shared by find, verify, and chat through
an `AgentAccess`; tests assert the sets stay disjoint, including the API-mode tool names. A
review tool has no business writing to the checkout, and denying `Bash` means it cannot run
commands in the repo. API mode's `read_file`/`list_dir` are GET-only by construction. Do
not grant a pass more than it needs.

The review rubric (`src/core/review/rubric.ts`) is generic on purpose — nothing
team-internal ships in the package. Teams add their own rules with `--standards <dir>`.

## Interface work

`.interface-design/system.md` is the design system and the record of what was tried and
rejected. Read it before changing anything visual — the palette is GitHub's Primer tokens,
purple is only ever the model, and every action button shows its key from the one keymap.
It is written as successive revisions after real use; append to it when a decision changes
rather than silently diverging from it. Verify UI changes in a browser (agent-browser)
before calling them done.

## Specs

`docs/design/` holds the dated design document behind each feature. For a feature of any
size, write the spec first — the existing ones are the model for the level of detail. The
step-by-step implementation plans built from them are not kept; the git log covers what was
actually done.
