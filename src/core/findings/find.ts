import { createHash } from 'node:crypto';
import type { AgentTransport } from '../agent/types.js';
import type { CheckRun, ReviewThread } from '../github/types.js';
import type { MeatResult } from '../meat/index.js';
import { FINDINGS_SCHEMA } from './schema.js';
import type { Finding, RawFinding } from './types.js';

export { FINDINGS_SCHEMA };
export type { Finding, RawFinding };

/** The agent may read the worktree. It may not change it or run commands in it. */
export const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'] as const;
/**
 * Named explicitly rather than left to the SDK's default-deny for tools absent
 * from `allowedTools`: the deny list is the thing a reader audits, and a future
 * default that opens up — or a subagent that inherits a wider set — must not be
 * able to quietly hand untrusted code a shell (`Bash`), a way to spawn an agent
 * outside these limits (`Task`), or a way to exfiltrate what it read
 * (`WebFetch`, `WebSearch`).
 */
export const DENIED_TOOLS = [
  'Write', 'Edit', 'NotebookEdit', 'Bash', 'Task', 'WebFetch', 'WebSearch',
] as const;

export const FINDINGS_SYSTEM_PROMPT = `You are reviewing a pull request for a senior engineer who will decide what to do with each of your findings.

You have read-only access to the repository at the pull request's head commit. Use it: open the whole file when a hunk is not self-explanatory, grep for other callers before claiming a signature change is safe, and read the tests.

Report a finding only when you can name a concrete consequence — wrong output, a crash, a security hole, data loss, a broken contract for an existing caller. "Consider extracting this" is not a finding.

Anchor every finding to a line that appears in the diff you were given. A concern about code the diff does not touch still belongs in the report; anchor it to the nearest changed line and say so in the body.

Do not repeat a point an existing review thread already makes.

Be honest about confidence. A high-confidence finding you cannot substantiate costs the reviewer more than a low-confidence one you flag as uncertain.`;

export interface FindingsInput {
  prTitle: string;
  prBody: string;
  meat: MeatResult;
  threads: ReviewThread[];
  failingChecks: CheckRun[];
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
 */
export async function runFindings(
  transport: AgentTransport,
  model: string,
  input: FindingsInput,
  cwd: string,
): Promise<Finding[]> {
  let structured: unknown;
  try {
    const run = await transport.run({
      model,
      cwd,
      systemPrompt: FINDINGS_SYSTEM_PROMPT,
      prompt: buildFindingsPrompt(input),
      schema: FINDINGS_SCHEMA,
      allowedTools: [...READ_ONLY_TOOLS],
      disallowedTools: [...DENIED_TOOLS],
    });
    structured = run.structured;
  } catch {
    return [];
  }

  const raw = (structured as { findings?: RawFinding[] } | null)?.findings ?? [];
  return raw.map((f) => ({ ...f, id: findingId(f) }));
}
