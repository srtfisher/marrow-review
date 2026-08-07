import { describeAgentFailure, type AgentFailure } from '../agent/errors.js';
import type { AgentTransport } from '../agent/types.js';
import type { Hunk } from '../diff/types.js';
import type { CachedVerdict } from './cache.js';

export interface ClassifyItem {
  /** Stable id used to correlate the model's verdict back to the hunk. */
  id: string;
  filePath: string;
  hunk: Hunk;
}

export interface ClassifiedVerdict extends CachedVerdict {
  /**
   * True when no model verdict was received for this hunk — it was kept by
   * fallback, not judged. Callers must not persist a synthetic verdict: the
   * cache has no expiry, so one degraded run would disable abridgement for
   * these hunks forever.
   */
  synthetic?: boolean;
}

export interface ClassifyResult {
  summary: string;
  verdicts: Map<string, ClassifiedVerdict>;
  /**
   * Why a chunk never came back; null when every chunk answered. Chunks fail
   * independently and this function never throws, so without it the only trace
   * of a dead subprocess was hunks marked `classification failed` — a
   * verdict-shaped string that names no cause.
   */
  error: AgentFailure | null;
}

export const CLASSIFY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'verdicts'],
  properties: {
    summary: {
      type: 'string',
      description: 'One or two sentences on what this pull request actually does.',
    },
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'keep', 'reason'],
        properties: {
          id: { type: 'string' },
          keep: { type: 'boolean' },
          reason: { type: 'string', description: 'One short clause.' },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You abridge code diffs for human review.

For each hunk decide whether a reviewer who wants to understand the concepts,
algorithm choices, and architecture of this change needs to read it.

Keep a hunk when it changes behavior, logic, control flow, data shape, a public
interface, or a security- or correctness-relevant detail.

Drop a hunk when it is mechanical: pure renames, boilerplate, test fixtures that
restate the obvious, formatting, or changes whose meaning is fully implied by
another hunk you kept.

Bias toward keeping when genuinely uncertain — a reviewer can skim an extra hunk,
but cannot review one they never saw. Give every verdict a short reason.`;

/**
 * Lines of a hunk the classifier is shown before it is elided.
 *
 * The question here is "does a reviewer need to read this", and a nine-hundred
 * line prose hunk answers that in its first forty lines. Sending the rest costs
 * tokens and latency on every run, and crowds out the hunks after it.
 */
export const MAX_HUNK_LINES = 80;

export function renderHunk(item: ClassifyItem): string {
  const lines = item.hunk.lines.map(
    (l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`,
  );

  const body = lines.length <= MAX_HUNK_LINES
    ? lines
    : [
      ...lines.slice(0, MAX_HUNK_LINES - 20),
      `… ${lines.length - MAX_HUNK_LINES} more lines of this hunk elided …`,
      ...lines.slice(-20),
    ];

  return `<hunk id="${item.id}" file="${item.filePath}">\n${item.hunk.header}\n${body.join('\n')}\n</hunk>`;
}

/**
 * Groups hunks into chunks under a character budget AND a count, never
 * splitting a hunk. A single hunk larger than the budget gets its own chunk
 * rather than being cut.
 *
 * The count is the part that was missing. One run asked to return sixty
 * verdicts came back with a handful and no error, so every hunk it skipped was
 * kept by fallback — a real seventeen-file pull request abridged to
 * 1038 of 1040 lines, which is no abridgement at all, and reads as the meat
 * pass being broken rather than incomplete. Smaller asks come back complete,
 * and they run concurrently, so the wall clock improves too.
 */
export function chunkHunks(
  items: ClassifyItem[],
  maxChars: number,
  maxItems = 15,
): ClassifyItem[][] {
  const chunks: ClassifyItem[][] = [];
  let current: ClassifyItem[] = [];
  let size = 0;

  for (const item of items) {
    const rendered = renderHunk(item).length;
    const full = current.length >= Math.max(1, maxItems) || size + rendered > maxChars;
    if (current.length > 0 && full) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += rendered;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

interface RawVerdict {
  id: string;
  keep: boolean;
  reason: string;
}

export async function classifyHunks(
  transport: AgentTransport,
  model: string,
  prTitle: string,
  prBody: string,
  items: ClassifyItem[],
  maxChars = 12_000,
  maxItems = 15,
): Promise<ClassifyResult> {
  const verdicts = new Map<string, ClassifiedVerdict>();
  if (items.length === 0) return { summary: '', verdicts, error: null };

  const chunks = chunkHunks(items, maxChars, maxItems);

  // allSettled, not all: one chunk whose run rejects must not discard the
  // verdicts its siblings returned. The agent pass is additive — a model
  // failure degrades the abridgement, it does not fail the review.
  const runs = await Promise.allSettled(
    chunks.map((chunk) =>
      transport.run({
        model,
        systemPrompt: SYSTEM_PROMPT,
        schema: CLASSIFY_SCHEMA,
        disallowedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash'],
        prompt: [
          `Pull request: ${prTitle}`,
          prBody.trim().length > 0 ? `\nDescription:\n${prBody.trim()}` : '',
          // Naming the count and the ids is what makes a short return
          // detectable by the model itself. A run that quietly omitted verdicts
          // left those hunks kept by fallback, which looks like no abridgement.
          `\nThere are ${chunk.length} hunks below, with these ids:`,
          chunk.map((item) => item.id).join(', '),
          `\nReturn exactly ${chunk.length} verdicts — one for every id above, `
            + 'and no ids that are not above.\n',
          chunk.map(renderHunk).join('\n\n'),
        ].join('\n'),
      }),
    ),
  );

  let summary = '';
  let error: AgentFailure | null = null;
  const failedChunks = new Set<number>();

  runs.forEach((result, i) => {
    if (result.status === 'rejected') {
      failedChunks.add(i);
      // The first is enough: chunks are the same call with different hunks, so
      // when one dies because Claude Code cannot start, they all say that.
      error ??= describeAgentFailure(result.reason);
      return;
    }

    const structured = result.value.structured as
      | { summary?: string; verdicts?: RawVerdict[] }
      | null;
    if (!structured) return;

    if (summary.length === 0 && typeof structured.summary === 'string') {
      summary = structured.summary;
    }
    for (const v of structured.verdicts ?? []) {
      verdicts.set(v.id, { keep: v.keep, reason: v.reason });
    }
  });

  // Anything the model failed to classify is kept — never silently hidden — but
  // marked synthetic so it is not cached as if it were a judgment.
  chunks.forEach((chunk, i) => {
    const reason = failedChunks.has(i)
      ? 'classification failed'
      : 'not classified; kept by default';
    for (const item of chunk) {
      if (!verdicts.has(item.id)) {
        verdicts.set(item.id, { keep: true, reason, synthetic: true });
      }
    }
  });

  return { summary, verdicts, error };
}
