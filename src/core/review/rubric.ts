import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const FINDING_TYPES = [
  'Security', 'Correctness', 'Performance', 'Accessibility',
  'Maintainability', 'Tests', 'Docs', 'Process',
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface RubricOptions {
  effort: Effort;
}

const EFFORT_GUIDANCE: Record<Effort, string> = {
  low: 'Report only findings you have confirmed in the code in front of you.',
  medium: 'Report findings you have substantiated, plus questions where the answer would change the review.',
  high: 'Report everything worth a reviewer\'s attention, including plausible issues you could not fully prove — set confidence to low and say what would settle them.',
};

/** The score a finding needs to be shown; below it, the finding folds into "Low confidence". 80 is /code-review's line. */
export const SCORE_THRESHOLD: Record<Effort, number> = { low: 90, medium: 80, high: 60 };

const BASE = `You are one of several reviewers looking at a pull request in parallel, each from one angle. A senior engineer will triage everything you raise; your output is a draft.

Read the change as a whole before judging individual lines.

## Severity
- blocking: must change before merge — a real defect, a security hole, data loss, a broken contract for an existing caller.
- non-blocking: worth fixing, but do not hold the merge for it. Never imply a non-blocking finding should gate a merge.

## Type
Exactly one, from this closed list in precedence order — when two fit, the earlier one wins:
Security, Correctness, Performance, Accessibility, Maintainability, Tests, Docs, Process.

## Kind
- issue: you can say what is wrong.
- question: you hit real uncertainty about intent, scale, or behavior, and the answer would change the review. A question is never blocking. Ask it; suggest documenting the answer.

## What counts
- Every Correctness or Security issue carries a failureScenario: concrete inputs or state, then the wrong output, crash, or exposure that follows. If a finding cannot name what actually breaks, drop it rather than hedge.
- Performance and Accessibility are raised when concrete — an unbounded query, work repeated in a loop, a removed label or focus state — never as general advice.

## Do not raise
- Pre-existing issues, and real issues on lines this pull request did not change.
- Anything a linter, formatter, type checker, compiler, or CI decides: imports, types, formatting, broken builds.
- Test coverage, documentation, general code quality, or general security hardening — unless the project's conventions or the team's standards explicitly ask for it.
- Pedantic nitpicks a senior engineer would not raise.
- Changes in behavior that are plainly intentional or part of the broader change.
- A rule the code explicitly silences, such as a lint-ignore comment.
- The pull request's title and description prose, or its choice of base branch.
- A point an existing review thread already makes.

## Anchoring
Anchor every finding to a line that appears in the diff (RIGHT for added or context lines, LEFT for removed lines).

## Voice
Never address the author as "you"; talk about the code. State the mechanism and its observable consequence, in words someone who opened this repository today could act on. Name blockers plainly. When a suggestion field is set, it is the exact replacement for the anchored line range, nothing else.`;

export function buildRubric(opts: RubricOptions): string {
  return [BASE, `## Effort\n${EFFORT_GUIDANCE[opts.effort]}`].join('\n\n');
}

const CONVENTION_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;
export const MAX_CONVENTIONS_CHARS = 20_000;
const MAX_CONVENTION_DIRS = 20;

/** The root's convention files, then each changed directory's, as `/code-review` reads them. */
export function conventionPaths(changedPaths: readonly string[]): string[] {
  const dirs = [...new Set(changedPaths.map((p) => p.split('/').slice(0, -1).join('/')).filter((d) => d.length > 0))]
    .sort()
    .slice(0, MAX_CONVENTION_DIRS);
  return ['', ...dirs].flatMap((dir) => CONVENTION_FILES.map((f) => (dir ? `${dir}/${f}` : f)));
}

/** Never throws: missing conventions cost context, not the review. */
export async function readConventions(
  read: (path: string) => Promise<string | null>,
  changedPaths: readonly string[] = [],
): Promise<string> {
  const paths = conventionPaths(changedPaths);
  const texts = await Promise.all(paths.map((path) => read(path).catch(() => null)));
  const sections: string[] = [];
  paths.forEach((path, i) => {
    const text = texts[i];
    if (text && text.trim().length > 0) sections.push(`### ${path}\n${text.trim()}`);
  });
  const joined = sections.join('\n\n');
  return joined.length <= MAX_CONVENTIONS_CHARS
    ? joined
    : `${joined.slice(0, MAX_CONVENTIONS_CHARS)}\n… truncated`;
}

const STANDARD_FILE = /\.(md|ya?ml)$/i;

/** Every markdown or YAML file in `dir`, sorted, each under its file name. */
export async function loadStandards(dir: string): Promise<string> {
  const names = (await readdir(dir)).filter((n) => STANDARD_FILE.test(n)).sort();
  const sections = await Promise.all(
    names.map(async (n) => `### ${n}\n${(await readFile(join(dir, n), 'utf8')).trim()}`),
  );
  return sections.join('\n\n');
}
