import { createHash } from 'node:crypto';
import type { AgentTransport } from '../agent/types.js';
import type { CheckRun, ReviewThread } from '../github/types.js';
import type { MeatResult } from '../meat/index.js';
import { buildRubric, type Effort } from '../review/rubric.js';
import { DENIED_TOOLS, READ_ONLY_TOOLS, type AgentAccess } from '../source/index.js';
import { FINDINGS_SCHEMA } from './schema.js';
import type { Finding, RawFinding } from './types.js';

export { FINDINGS_SCHEMA };
export type { Finding, RawFinding };
// Defined with the sources, which own what an agent may read; re-exported here
// because find is where a reader auditing the tool policy looks first.
export { DENIED_TOOLS, READ_ONLY_TOOLS };

export interface FindingsInput {
  prTitle: string;
  prBody: string;
  meat: MeatResult;
  threads: ReviewThread[];
  failingChecks: CheckRun[];
  effort: Effort;
  standards: string;
  conventions: string;
}

export function buildFindingsPrompt(input: FindingsInput): string {
  const parts: string[] = [`Pull request: ${input.prTitle}`];

  if (input.prBody.trim().length > 0) parts.push(`\nDescription:\n${input.prBody.trim()}`);
  if (input.meat.summary.length > 0) parts.push(`\nWhat this change does:\n${input.meat.summary}`);

  if (input.failingChecks.length > 0) {
    const lines = input.failingChecks.map(
      (c) => `- ${c.name}${c.output ? `: ${c.output}` : ''}`,
    );
    parts.push(`\nFailing checks:\n${lines.join('\n')}`);
  }

  if (input.threads.length > 0) {
    const lines = input.threads.flatMap((t) =>
      t.comments.map((c) => `- ${t.path}:${t.line ?? '?'} ${c.author}: ${c.body}`),
    );
    parts.push(`\nExisting review comments — do not repeat these:\n${lines.join('\n')}`);
  }

  parts.push('\nThe abridged diff follows. Only hunks worth reading are included.\n');

  for (const file of input.meat.files) {
    const kept = file.hunks.filter((h) => h.keep);
    if (kept.length === 0) continue;
    parts.push(`<file path="${file.file.path}">`);
    for (const meatHunk of kept) {
      const body = meatHunk.hunk.lines
        .map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`)
        .join('\n');
      parts.push(`${meatHunk.hunk.header}\n${body}`);
    }
    parts.push('</file>');
  }

  return parts.join('\n');
}

export function findingId(raw: RawFinding): string {
  return createHash('sha256')
    .update(`${raw.path}:${raw.side}:${raw.line}:${raw.title}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Runs the findings pass. Never throws: the agent passes are additive, and a
 * model failure must leave the reviewer with a fully usable manual review.
 *
 * `onError` exists because "ran and found nothing" and "never ran" both used to
 * come back as `[]`, so a dead transport was indistinguishable from a clean
 * pull request. The caller decides what to say about it; this function still
 * never throws.
 */
export async function runFindings(
  transport: AgentTransport,
  model: string,
  input: FindingsInput,
  access: AgentAccess,
  onError?: (error: unknown) => void,
): Promise<Finding[]> {
  let structured: unknown;
  try {
    const run = await transport.run({
      model,
      cwd: access.cwd,
      systemPrompt: buildRubric(input),
      prompt: buildFindingsPrompt(input),
      schema: FINDINGS_SCHEMA,
      allowedTools: access.allowedTools,
      disallowedTools: [...DENIED_TOOLS],
      tools: access.tools,
    });
    structured = run.structured;
  } catch (error) {
    onError?.(error);
    return [];
  }

  const raw = (structured as { findings?: RawFinding[] } | null)?.findings ?? [];
  return raw.map((f) => ({
    ...f,
    startLine: f.startLine ?? null,
    suggestion: f.suggestion ?? null,
    failureScenario: f.failureScenario ?? null,
    // The schema allows a blocking question; the rubric does not.
    severity: f.kind === 'question' ? 'non-blocking' : f.severity,
    id: findingId(f),
  }));
}
