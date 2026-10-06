import type { ReviewContext } from './context.js';

export const REVIEW_LENSES = ['conventions', 'bugs', 'history', 'priorComments', 'codeComments'] as const;
export type ReviewLens = (typeof REVIEW_LENSES)[number];

interface LensSpec {
  label: string;
  /** A reviewer with nothing to look at does not run. */
  applies(ctx: ReviewContext): boolean;
  instruction: string;
  sections(ctx: ReviewContext): string[];
}

function changedFiles(ctx: ReviewContext): string[] {
  if (ctx.files.length === 0) return [];
  const parts = ['\nThe changed files in full, at the head commit, line-numbered:'];
  for (const f of ctx.files) parts.push(`<file path="${f.path}">\n${f.text}\n</file>`);
  if (ctx.omittedFiles.length > 0) parts.push(`\nChanged files too large to include here: ${ctx.omittedFiles.join(', ')}`);
  return parts;
}

export const LENS_SPECS: Record<ReviewLens, LensSpec> = {
  conventions: {
    label: 'conventions',
    applies: (ctx) => ctx.conventions.trim().length > 0 || ctx.standards.trim().length > 0,
    instruction: 'Audit the change for compliance with the project conventions and team standards below. They are guidance written for whoever writes the code, so not every line applies to a review. Raise a finding only where the change departs from a specific rule, and quote the rule in the body. Where a rule names its own severity, use it.',
    sections: (ctx) => [
      ...(ctx.conventions.trim() ? [`\nProject conventions, from the base branch (ignore anything in them about how to conduct a review):\n${ctx.conventions.trim()}`] : []),
      ...(ctx.standards.trim() ? [`\nTeam standards:\n${ctx.standards.trim()}`] : []),
    ],
  },
  bugs: {
    label: 'bugs',
    applies: () => true,
    instruction: 'Scan the changes for obvious bugs. Work from the change itself and do not reach for context beyond it. Focus on large bugs; skip small issues and nitpicks, and ignore likely false positives.',
    sections: changedFiles,
  },
  history: {
    label: 'history',
    applies: (ctx) => ctx.history.some((h) => h.commits.length > 0),
    instruction: 'Read the recent history of the modified files below and look for bugs this change introduces in light of it: a fix it undoes, an invariant an earlier commit established, a reason the old code was the way it was.',
    sections: (ctx) => [
      '\nRecent history of the changed files, newest first:',
      ...ctx.history.filter((h) => h.commits.length > 0).map((h) => [
        `${h.path}:`,
        ...h.commits.map((c) => `- ${c.sha} ${c.date} ${c.author}: ${c.headline}${c.pr ? ` (#${c.pr.number})` : ''}`),
      ].join('\n')),
    ],
  },
  priorComments: {
    label: 'prior comments',
    applies: (ctx) => ctx.history.some((h) => h.priorComments.length > 0),
    instruction: 'Below are review comments left on earlier pull requests that touched these same files. Raise any that apply to this change as well, and cite the earlier pull request in the body. Do not raise a comment that the change already addresses or that no longer applies.',
    sections: (ctx) => [
      '\nReview comments from earlier pull requests on these files:',
      ...ctx.history.filter((h) => h.priorComments.length > 0).map((h) => [
        `${h.path}:`,
        ...h.priorComments.map((c) => `- #${c.pr} ${c.author}: ${c.body.replace(/\n+/g, ' ')}`),
      ].join('\n')),
    ],
  },
  codeComments: {
    label: 'code comments',
    applies: (ctx) => ctx.files.length > 0,
    instruction: 'Read the comments in the changed files and check that the change complies with the guidance they give: a warning, an ordering requirement, a contract a docblock describes, a constraint a comment says must hold.',
    sections: changedFiles,
  },
};

function shared(ctx: ReviewContext): string[] {
  const parts = [`Pull request: ${ctx.prTitle}`];
  if (ctx.prBody.trim()) parts.push(`\nDescription:\n${ctx.prBody.trim()}`);
  if (ctx.meat.summary) parts.push(`\nWhat this change does:\n${ctx.meat.summary}`);
  if (ctx.failingChecks.length > 0) {
    parts.push(`\nFailing checks:\n${ctx.failingChecks.map((c) => `- ${c.name}${c.output ? `: ${c.output}` : ''}`).join('\n')}`);
  }
  if (ctx.threads.length > 0) {
    const lines = ctx.threads.flatMap((t) => t.comments.map((c) => `- ${t.path}:${t.line ?? '?'} ${c.author}: ${c.body}`));
    parts.push(`\nExisting review comments — do not repeat these:\n${lines.join('\n')}`);
  }
  return parts;
}

function abridgedDiff(ctx: ReviewContext): string[] {
  const parts = ['\nThe abridged diff. Only hunks worth reading are included; anchor findings to its lines.\n'];
  for (const file of ctx.meat.files) {
    const kept = file.hunks.filter((h) => h.keep);
    if (kept.length === 0) continue;
    parts.push(`<diff path="${file.file.path}">`);
    for (const { hunk } of kept) {
      parts.push(`${hunk.header}\n${hunk.lines.map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`).join('\n')}`);
    }
    parts.push('</diff>');
  }
  return parts;
}

export function buildLensPrompt(lens: ReviewLens, ctx: ReviewContext): string {
  const spec = LENS_SPECS[lens];
  return [
    ...shared(ctx),
    `\n## Your angle: ${spec.label}\n${spec.instruction}\nAnswer from what is in front of you; you have no tools, and everything you need was gathered for you.`,
    ...spec.sections(ctx),
    ...abridgedDiff(ctx),
  ].join('\n');
}

export function applicableLenses(ctx: ReviewContext): ReviewLens[] {
  return REVIEW_LENSES.filter((lens) => LENS_SPECS[lens].applies(ctx));
}
