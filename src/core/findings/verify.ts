import type { AgentTransport } from '../agent/types.js';
import { DENIED_TOOLS, READ_ONLY_TOOLS } from './find.js';
import type { Finding } from './types.js';

export type Lens = 'reachability' | 'reproduction';
export type Verdict = 'confirmed' | 'plausible' | 'refuted';

export interface Refutation {
  lens: Lens;
  refuted: boolean;
  reasoning: string;
}

export interface VerifiedFinding extends Finding {
  verdict: Verdict;
  refutations: Refutation[];
}

export const LENSES: readonly Lens[] = ['reachability', 'reproduction'];

export const VERIFY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string', description: 'One or two sentences.' },
  },
};

const LENS_INSTRUCTION: Record<Lens, string> = {
  reachability:
    'Determine whether the code path this claim depends on is reachable at all. Read the callers. If nothing can reach it — dead code, an impossible branch, a guard upstream — the claim is refuted.',
  reproduction:
    'Determine whether the described failure actually occurs when the path runs. Read the surrounding code and the tests. If the failure cannot reproduce — the value is always validated, the error is caught, the case is already handled — the claim is refuted.',
};

export function buildVerifyPrompt(finding: Finding, lens: Lens): string {
  return [
    'Your job is to REFUTE the claim below, not to agree with it. Assume it is wrong and look for the evidence.',
    '',
    `Claim: ${finding.title}`,
    `Location: ${finding.path}:${finding.line} (${finding.side})`,
    `Detail: ${finding.body}`,
    '',
    LENS_INSTRUCTION[lens],
    '',
    'If you cannot find evidence that refutes it, say so — do not manufacture a refutation. Answer with refuted true or false and one or two sentences of reasoning.',
  ].join('\n');
}

/**
 * Both lenses must refute to call a finding refuted; a split is `plausible`.
 * Zero refutations means verification did not run, which is NOT the same as
 * being confirmed — it must never silently promote a finding.
 */
export function scoreVerdict(refutations: Refutation[]): Verdict {
  if (refutations.length === 0) return 'plausible';
  const refuting = refutations.filter((r) => r.refuted).length;
  if (refuting === 0) return 'confirmed';
  if (refuting === refutations.length) return 'refuted';
  return 'plausible';
}

/**
 * Every lens on every finding is one Claude Code subprocess. Unbounded, twenty
 * findings meant forty of them at once — enough to make the reviewer's machine
 * unusable during the pass that is supposed to run quietly behind the diff.
 */
export const VERIFY_CONCURRENCY = 4;

/** Runs `worker` over `items` with at most `limit` in flight, results in order. */
async function pooled<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Runs both lenses against every finding, at most `VERIFY_CONCURRENCY` model
 * calls at a time. Never throws: a per-lens failure yields no refutation for
 * that lens, and the finding survives with whatever verdict the remaining
 * evidence supports.
 */
export async function runVerify(
  transport: AgentTransport,
  model: string,
  findings: Finding[],
  cwd: string,
  onError?: (error: unknown) => void,
): Promise<VerifiedFinding[]> {
  const tasks = findings.flatMap((finding, index) =>
    LENSES.map((lens) => ({ finding, index, lens })),
  );

  const results = await pooled(tasks, VERIFY_CONCURRENCY, async ({ finding, lens }) => {
    try {
      const run = await transport.run({
        model,
        cwd,
        prompt: buildVerifyPrompt(finding, lens),
        schema: VERIFY_SCHEMA,
        allowedTools: [...READ_ONLY_TOOLS],
        disallowedTools: [...DENIED_TOOLS],
      });
      const s = run.structured as { refuted?: boolean; reasoning?: string } | null;
      if (!s) return null;
      return { lens, refuted: s.refuted === true, reasoning: s.reasoning ?? '' };
    } catch (error) {
      onError?.(error);
      return null;
    }
  });

  // Grouped from the task list rather than from completion order, so a
  // finding's refutations stay in LENSES order however the pool interleaves.
  const byFinding: Refutation[][] = findings.map(() => []);
  tasks.forEach((task, i) => {
    const refutation = results[i];
    if (refutation) byFinding[task.index]!.push(refutation);
  });

  return findings.map((finding, i) => {
    const refutations = byFinding[i] ?? [];
    return { ...finding, verdict: scoreVerdict(refutations), refutations };
  });
}
