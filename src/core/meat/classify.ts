import type { AgentTransport } from '../agent/types.js';
import type { Hunk } from '../diff/types.js';
import type { CachedVerdict } from './cache.js';

export interface ClassifyItem {
  /** Stable id used to correlate the model's verdict back to the hunk. */
  id: string;
  filePath: string;
  hunk: Hunk;
}

export interface ClassifyResult {
  summary: string;
  verdicts: Map<string, CachedVerdict>;
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

function renderHunk(item: ClassifyItem): string {
  const body = item.hunk.lines
    .map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`)
    .join('\n');
  return `<hunk id="${item.id}" file="${item.filePath}">\n${item.hunk.header}\n${body}\n</hunk>`;
}

/**
 * Groups hunks into chunks under a character budget, never splitting a hunk. A
 * single hunk larger than the budget gets its own chunk rather than being cut.
 */
export function chunkHunks(items: ClassifyItem[], maxChars: number): ClassifyItem[][] {
  const chunks: ClassifyItem[][] = [];
  let current: ClassifyItem[] = [];
  let size = 0;

  for (const item of items) {
    const rendered = renderHunk(item).length;
    if (current.length > 0 && size + rendered > maxChars) {
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
  maxChars = 40_000,
): Promise<ClassifyResult> {
  const verdicts = new Map<string, CachedVerdict>();
  if (items.length === 0) return { summary: '', verdicts };

  const chunks = chunkHunks(items, maxChars);

  const runs = await Promise.all(
    chunks.map((chunk) =>
      transport.run({
        model,
        systemPrompt: SYSTEM_PROMPT,
        schema: CLASSIFY_SCHEMA,
        disallowedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash'],
        prompt: [
          `Pull request: ${prTitle}`,
          prBody.trim().length > 0 ? `\nDescription:\n${prBody.trim()}` : '',
          '\nClassify every hunk below. Return one verdict per hunk id.\n',
          chunk.map(renderHunk).join('\n\n'),
        ].join('\n'),
      }),
    ),
  );

  let summary = '';
  for (const run of runs) {
    const structured = run.structured as
      | { summary?: string; verdicts?: RawVerdict[] }
      | null;
    if (!structured) continue;

    if (summary.length === 0 && typeof structured.summary === 'string') {
      summary = structured.summary;
    }
    for (const v of structured.verdicts ?? []) {
      verdicts.set(v.id, { keep: v.keep, reason: v.reason });
    }
  }

  // Anything the model failed to classify is kept — never silently hidden.
  for (const item of items) {
    if (!verdicts.has(item.id)) {
      verdicts.set(item.id, { keep: true, reason: 'not classified; kept by default' });
    }
  }

  return { summary, verdicts };
}
