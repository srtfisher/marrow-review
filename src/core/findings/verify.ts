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
 * Runs both lenses against every finding. Never throws: a per-lens failure
 * yields no refutation for that lens, and the finding survives with whatever
 * verdict the remaining evidence supports.
 */
export async function runVerify(
  transport: AgentTransport,
  model: string,
  findings: Finding[],
  cwd: string,
): Promise<VerifiedFinding[]> {
  return Promise.all(
    findings.map(async (finding) => {
      const results = await Promise.all(
        LENSES.map(async (lens): Promise<Refutation | null> => {
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
          } catch {
            return null;
          }
        }),
      );

      const refutations = results.filter((r): r is Refutation => r !== null);
      return { ...finding, verdict: scoreVerdict(refutations), refutations };
    }),
  );
}
