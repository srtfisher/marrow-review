# marrow

A terminal tool for reviewing large pull requests: it abridges the diff to what carries
meaning, drafts findings anchored to lines, and submits one GitHub review. `README.md` is
the user-facing description — read it first for what the thing does and why.

## Commands

```bash
bun test                          # whole suite; bun test tests/core/meat/ to narrow
bun run typecheck                 # tsc over src AND tests — tests are type-checked too
bun run lint:boundary             # src/core must never import UI
bun run build                     # tsc -> dist/ (the bin is dist/cli.js)
```

Run all four before saying a change is done. `bun test` alone does not catch a type error in
a file no test imports, and `tsc -p tsconfig.json` does not cover `tests/`.

## Architecture

```
src/core/**   pure library, no UI imports, enforced by dependency-cruiser
  agent/      AgentTransport — the seam every model call goes through
  diff/       unified-diff parser -> DiffFile[] / Hunk / DiffLine
  meat/       the abridgement: rules, then a model pass, then a cache
  findings/   find -> verify (two refutation lenses) -> triage; chat
  github/     gh-based auth, Octokit client, GraphQL threads, review submit
  git/        repo detection, detached worktree for the head commit, .gitattributes
  review/     anchors, payload construction, verdicts
  store/      drafts written through to disk as you go
src/tui/**    Ink layer; layout arithmetic lives in pure modules beside components
```

The split is load-bearing, not decorative. The hard parts — diff parsing, anchoring, the
meat engine, review construction — are unit-testable without rendering, and the boundary
rule exists so a non-terminal frontend could reuse them. Put logic in `src/core`, put
drawing in `src/tui`, and when a component needs arithmetic, write it as a pure module next
to the component (`fileindex.ts`, `viewport.ts`, `hittest.ts`, `help.ts`, `hints.ts`,
`rows.ts`, `units.ts`) and test it directly. In a terminal, "the renderer and the scroll
maths disagree by one row" is a real class of bug, and the fix is to have exactly one of
them.

## Conventions

- **ESM with explicit extensions.** `import { x } from './x.js'` — including from `.ts`
  files. `nodenext` resolution; a missing `.js` fails the build.
- **`strict` plus `noUncheckedIndexedAccess`.** `arr[0]` is `T | undefined`. In tests, `!`
  after a lookup is idiomatic; in `src`, handle the absent case.
- **Tests mirror `src`.** `src/core/meat/rules.ts` → `tests/core/meat/rules.test.ts`, using
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
run. Keep it that way.

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
abridgement for those hunks forever.

## Agent tool policy

`READ_ONLY_TOOLS` and `DENIED_TOOLS` in `src/core/findings/find.ts` are the single
definition, shared by find, verify, and chat; a test asserts the sets stay disjoint. A
review tool has no business writing to the checkout, and denying `Bash` means it cannot run
commands in the repo. Do not grant a pass more than it needs.

## Interface work

`.interface-design/system.md` is the design system and the record of what was tried and
rejected. Read it before changing anything visual — the palette is deliberately terminal-
inherited rather than hardcoded, depth is tonal only, and the bottom row is verbs rather
than metadata. It is written as successive revisions after real use; append to it when a
decision changes rather than silently diverging from it.

## Plans and specs

`docs/superpowers/specs/` holds design documents, `docs/superpowers/plans/` the
implementation plans built from them, both dated. For a feature of any size, write the spec
first — the existing ones are the model for the level of detail.
