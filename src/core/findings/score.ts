import type { AgentTransport } from '../agent/types.js';
import type { DiffFile } from '../diff/types.js';
import { deniedFor, type AgentAccess } from '../source/index.js';
import { scoreKey, type FindingsCache } from './cache.js';
import { LENS_SPECS } from './lenses.js';
import type { Finding } from './types.js';

export interface Score {
  /** 0–100, how confident the scorer is that the issue is real. */
  score: number;
  reason: string;
}

export interface ScoredFinding extends Finding {
  /** Null when the finding was not scored: a question, scoring switched off, or the scorer failed. */
  score: number | null;
  scoreReason: string | null;
}

export const SCORE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'reason'],
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    reason: { type: 'string', description: 'One or two sentences: what you checked and what it showed.' },
  },
};

/** Scorers are cheap, but each is still a Claude Code subprocess. */
export const SCORE_CONCURRENCY = 6;

/** The prompt asks for at most three reads; this only stops a runaway. */
export const SCORE_MAX_TURNS = 8;

// /code-review's scale, given to the scorer verbatim.
const SCALE = `Score the issue on a scale from 0 to 100:
- 0: Not confident at all. This is a false positive that doesn't stand up to light scrutiny, or is a pre-existing issue.
- 25: Somewhat confident. This might be a real issue, but may also be a false positive. The agent wasn't able to verify that it's a real issue. If the issue is stylistic, it is one that was not explicitly called out in the relevant CLAUDE.md.
- 50: Moderately confident. The agent was able to verify this is a real issue, but it might be a nitpick or not happen very often in practice. Relative to the rest of the PR, it's not very important.
- 75: Highly confident. The agent double checked the issue, and verified that it is very likely it is a real issue that will be hit in practice. The existing approach in the PR is insufficient. The issue is very important and will directly impact the code's functionality, or it is an issue that is directly mentioned in the relevant CLAUDE.md.
- 100: Absolutely certain. The agent double checked the issue, and confirmed that it is definitely a real issue, that will happen frequently in practice. The evidence directly confirms this.`;

const FALSE_POSITIVES = `Score low for:
- pre-existing issues, or real issues on lines the pull request did not change
- something that looks like a bug but is not one
- pedantic nitpicks a senior engineer would not raise
- anything a linter, type checker, compiler, or CI would catch
- general advice with no line it applies to, such as "consider adding tests"
- a rule the code explicitly silences, such as a lint-ignore comment
- a change in behavior that is plainly intentional or part of the broader change`;

export interface ScoreOptions {
  /** The diff hunk the finding is anchored in. */
  excerpt?: (finding: Finding) => string | null;
  /** CLAUDE.md / AGENTS.md text, given to the scorer of a convention finding so it can check the rule exists. */
  conventions?: string;
  standards?: string;
  cache?: FindingsCache;
  /** Skip the cache lookup (the result is still stored). */
  fresh?: boolean;
  onError?: (error: unknown) => void;
  /** After each scorable finding settles, from the cache or the model. */
  onProgress?: (done: number, total: number) => void;
}

export interface ScoreResult {
  scored: ScoredFinding[];
  /** Scores that came from the cache. */
  cached: number;
}

/** Questions have no failure to be confident about; they are shown as asked. */
export function isScorable(finding: Finding): boolean {
  return finding.kind === 'issue';
}

/** The diff hunk a finding is anchored in, as diff text, or null when it is not in the diff. */
export function anchorExcerpt(files: readonly DiffFile[], finding: Finding): string | null {
  const file = files.find((f) => f.path === finding.path);
  const hunk = file?.hunks.find((h) => {
    const [start, count] = finding.side === 'LEFT' ? [h.oldStart, h.oldLines] : [h.newStart, h.newLines];
    return finding.line >= start && finding.line < start + Math.max(count, 1);
  });
  if (!hunk) return null;
  const body = hunk.lines.map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`).join('\n');
  return `${hunk.header}\n${body}`;
}

export function buildScorePrompt(finding: Finding, opts: Pick<ScoreOptions, 'conventions' | 'standards'> & { excerpt: string | null }): string {
  const fromConventions = finding.lenses.includes('conventions');
  const rules = [opts.conventions?.trim(), opts.standards?.trim()].filter((t): t is string => Boolean(t));
  return [
    'A code reviewer raised the issue below on a pull request. Decide how confident you are that it is real — not whether it is worth fixing.',
    '',
    `Issue: ${finding.title}`,
    `Location: ${finding.path}:${finding.line} (${finding.side})`,
    `Raised as: ${finding.severity} ${finding.type}, by the ${finding.lenses.map((l) => LENS_SPECS[l].label).join(' and ')} reviewer`,
    `Detail: ${finding.body}`,
    ...(finding.failureScenario ? [`Failure scenario: ${finding.failureScenario}`] : []),
    ...(opts.excerpt ? ['', 'The change it is about:', '```diff', opts.excerpt, '```'] : []),
    ...(fromConventions && rules.length > 0
      ? ['', 'It was raised against these conventions. Check that they actually say it; if they do not, score it 0:', ...rules]
      : []),
    '',
    SCALE,
    '',
    FALSE_POSITIVES,
    '',
    'You may open at most 3 files, and only to check this issue. Then answer with the score and one or two sentences on what you checked.',
  ].join('\n');
}

async function pooled<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
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
 * Scores every issue, at most `SCORE_CONCURRENCY` at a time. Never throws: a failed
 * scorer leaves its finding unscored — shown, never silently above or below the line.
 */
export async function runScore(
  transport: AgentTransport,
  model: string,
  findings: Finding[],
  access: AgentAccess,
  opts: ScoreOptions = {},
): Promise<ScoreResult> {
  let cached = 0;
  let done = 0;
  const total = findings.filter(isScorable).length;
  const settle = (score: Score | null): Score | null => {
    done += 1;
    opts.onProgress?.(done, total);
    return score;
  };

  const scores = await pooled(findings, SCORE_CONCURRENCY, async (finding): Promise<Score | null> => {
    if (!isScorable(finding)) return null;
    const prompt = buildScorePrompt(finding, { ...opts, excerpt: opts.excerpt?.(finding) ?? null });
    const key = scoreKey(model, prompt);
    if (opts.cache && !opts.fresh) {
      const hit = await opts.cache.getScore(key).catch(() => null);
      if (hit) {
        cached += 1;
        return settle(hit);
      }
    }
    try {
      const run = await transport.run({
        model,
        cwd: access.cwd,
        prompt,
        schema: SCORE_SCHEMA,
        maxTurns: SCORE_MAX_TURNS,
        effort: 'low',
        allowedTools: access.allowedTools,
        disallowedTools: deniedFor(access),
        tools: access.tools,
      });
      const s = run.structured as { score?: unknown; reason?: unknown } | null;
      if (typeof s?.score !== 'number') return settle(null);
      const score = { score: Math.max(0, Math.min(100, Math.round(s.score))), reason: typeof s.reason === 'string' ? s.reason : '' };
      await opts.cache?.setScore(key, score).catch(() => {});
      return settle(score);
    } catch (error) {
      opts.onError?.(error);
      return settle(null);
    }
  });

  return {
    scored: findings.map((finding, i) => ({ ...finding, score: scores[i]?.score ?? null, scoreReason: scores[i]?.reason ?? null })),
    cached,
  };
}

/** Shown in the default view: questions, anything unscored, and anything at or above the line. */
export function isShown(finding: ScoredFinding, threshold: number): boolean {
  return finding.score === null || finding.score >= threshold;
}
