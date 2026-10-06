import { createHash } from 'node:crypto';
import type { AgentTransport } from '../agent/types.js';
import { buildRubric } from '../review/rubric.js';
import { DENIED_TOOLS, READ_ONLY_TOOLS, type AgentAccess } from '../source/index.js';
import { findingsKey, type FindingsCache } from './cache.js';
import type { ReviewContext } from './context.js';
import { applicableLenses, buildLensPrompt, LENS_SPECS, type ReviewLens } from './lenses.js';
import { mergeFindings } from './merge.js';
import { FINDINGS_SCHEMA } from './schema.js';
import type { Finding, RawFinding } from './types.js';

export { FINDINGS_SCHEMA };
export type { Finding, RawFinding };
// Defined with the sources, which own what an agent may read; re-exported here
// because find is where a reader auditing the tool policy looks first.
export { DENIED_TOOLS, READ_ONLY_TOOLS };

export function findingId(raw: RawFinding): string {
  return createHash('sha256')
    .update(`${raw.path}:${raw.side}:${raw.line}:${raw.title}`)
    .digest('hex')
    .slice(0, 16);
}

export interface ReviewProgress {
  /** Reviewers finished, from the model or the cache. */
  done: number;
  total: number;
  /** The reviewers still running, once most are done: "waiting on bugs". */
  activity: string | null;
}

export interface FindOptions {
  cache?: FindingsCache;
  /** Skip the cache lookup (results are still stored). */
  fresh?: boolean;
  /** Once per reviewer that failed; the others still land. */
  onError?: (lens: ReviewLens, error: unknown) => void;
  onProgress?: (progress: ReviewProgress) => void;
}

export interface FindResult {
  findings: Finding[];
  /** Reviewers that ran (or came from the cache), in lens order. */
  ran: ReviewLens[];
  failed: ReviewLens[];
  /** Reviewers answered from the cache. */
  cached: number;
}

function toFindings(structured: unknown, lens: ReviewLens): Finding[] {
  const raw = (structured as { findings?: RawFinding[] } | null)?.findings ?? [];
  return raw.map((f) => ({
    ...f,
    startLine: f.startLine ?? null,
    suggestion: f.suggestion ?? null,
    failureScenario: f.failureScenario ?? null,
    // The schema allows a blocking question; the rubric does not.
    severity: f.kind === 'question' ? 'non-blocking' : f.severity,
    id: findingId(f),
    lenses: [lens],
  }));
}

/**
 * Runs every reviewer whose lens has something to look at, all at once, then merges
 * what they raised. Never throws: the agent passes are additive. A failed reviewer
 * costs its own findings and is reported through `onError`; it is never cached, and
 * neither is anything else that failed — the cache has no expiry.
 */
export async function runFindings(
  transport: AgentTransport,
  model: string,
  ctx: ReviewContext,
  access: AgentAccess,
  opts: FindOptions = {},
): Promise<FindResult> {
  const lenses = applicableLenses(ctx);
  const systemPrompt = buildRubric({ effort: ctx.effort });
  // The summary is model prose that differs between a classified run and a fully
  // cached one; keyed on it, a restart would never hit.
  const keyCtx = { ...ctx, meat: { ...ctx.meat, summary: '' } };
  let done = 0;
  let cached = 0;
  const failed: ReviewLens[] = [];
  const pending = new Set(lenses);
  const report = () => {
    const waiting = done > 0 && pending.size > 0 && pending.size <= 2
      ? `waiting on ${[...pending].map((l) => LENS_SPECS[l].label).join(', ')}`
      : null;
    opts.onProgress?.({ done, total: lenses.length, activity: waiting });
  };
  report();

  const results = await Promise.all(lenses.map(async (lens): Promise<Finding[]> => {
    const spec = LENS_SPECS[lens];
    const prompt = buildLensPrompt(lens, ctx);
    const key = findingsKey(model, systemPrompt, buildLensPrompt(lens, keyCtx));
    const finish = (findings: Finding[]) => {
      done += 1;
      pending.delete(lens);
      report();
      return findings;
    };
    if (opts.cache && !opts.fresh) {
      const hit = await opts.cache.getFindings(key).catch(() => null);
      if (hit) {
        cached += 1;
        return finish(hit);
      }
    }
    try {
      const run = await transport.run({
        model,
        cwd: access.cwd,
        systemPrompt,
        prompt,
        schema: FINDINGS_SCHEMA,
        // Every reviewer answers from what it was handed, in one turn: the context it
        // would go looking for was gathered before it started, and a reviewer with
        // tools once spent five minutes wandering and then lost everything to its turn cap.
        allowedTools: [],
        disallowedTools: [...DENIED_TOOLS, ...READ_ONLY_TOOLS],
        tools: [],
        effort: ctx.effort,
      });
      const findings = toFindings(run.structured, lens);
      await opts.cache?.setFindings(key, findings).catch(() => {});
      return finish(findings);
    } catch (error) {
      failed.push(lens);
      opts.onError?.(lens, error);
      return finish([]);
    }
  }));

  return { findings: mergeFindings(results.flat()), ran: lenses, failed, cached };
}
