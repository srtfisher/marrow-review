import { describeAgentFailure } from '../agent/errors.js';
import { toolName, type AgentTool, type AgentTransport } from '../agent/types.js';
import type { MeatResult } from '../meat/index.js';
import { DENIED_TOOLS } from '../source/index.js';
import { groupingKey, type GroupCache } from './cache.js';
import { groupByDirectory, singleGroup } from './fallback.js';
import { keptHunks, type KeptHunk } from './ids.js';
import {
  checkCoverage, describeCoverage, isComplete, reconcile, type RawGroup,
} from './reconcile.js';
import { GROUP_CATEGORIES, type GroupingResult } from './types.js';

export * from './types.js';
export { hunkId, keptHunks, type KeptHunk } from './ids.js';
export { groupHunkIds } from './reconcile.js';

/** Hunk bodies go inline below this; above it the model reads them on demand. */
export const INLINE_LIMIT = 150_000;
export const READ_CALL_LIMIT = 40_000;
export const READ_BUDGET = 200_000;
/** A change this small reads fine as one group; the model call would be ceremony. */
export const SMALL_PR_FILES = 3;

const GROUP_FIELDS = {
  key: { type: 'string', description: 'Short kebab-case identifier, unique across all groups.' },
  label: { type: 'string', description: 'At most 4 words, naming the intent (e.g. "Retry on 5xx").' },
  summary: { type: 'string', description: 'One or two sentences of markdown on WHY this change exists, not a list of what it touches.' },
  category: { type: 'string', enum: [...GROUP_CATEGORIES], description: 'The part of the system this group touches, not whether it is a feature or a fix.' },
  hunkIds: {
    type: 'array',
    items: { type: 'string' },
    description: 'Every hunk id given to you MUST end up in exactly one group or child — never both, never omitted.',
  },
} as const;

export const GROUPING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['overallSummary', 'groups'],
  properties: {
    overallSummary: { type: 'string', description: 'Two or three sentences: what this pull request does and why, for a reviewer about to read it.' },
    groups: {
      type: 'array',
      description: 'Ordered for reading: the core change first, supporting changes next, mechanical changes last. Typically 1–5 groups.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label', 'summary', 'category', 'hunkIds'],
        properties: {
          ...GROUP_FIELDS,
          children: {
            type: 'array',
            description: 'Split a group of more than ~5 files into children. Children have no children. Tests go in a "tests" child of the feature they cover.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'label', 'summary', 'category', 'hunkIds'],
              properties: GROUP_FIELDS,
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You organize a pull request's changes into groups a reviewer can read one at a time.

Group by intent, not by directory: one feature touching several modules is ONE group. Put each hunk where a reviewer would want to read it. Order groups for reading — the core change first, supporting changes next, mechanical changes last.

Every hunk id you are given must appear in exactly one group or child. Use only ids you were given.`;

function body(h: KeptHunk): string {
  return h.hunk.lines.map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`).join('\n');
}

function renderHunk(h: KeptHunk): string {
  return `<hunk id="${h.id}" path="${h.path}">\n${h.hunk.header}\n${body(h)}\n</hunk>`;
}

export function buildManifest(meat: MeatResult, hunks: KeptHunk[]): string {
  const byFile = new Map<string, KeptHunk[]>();
  for (const h of hunks) byFile.set(h.path, [...(byFile.get(h.path) ?? []), h]);

  const byDir = new Map<string, string[]>();
  for (const f of meat.files) {
    const list = byFile.get(f.file.path);
    if (!list) continue;
    const slash = f.file.path.lastIndexOf('/');
    const dir = slash === -1 ? '.' : f.file.path.slice(0, slash);
    const name = f.file.path.slice(slash + 1);
    const lines = [`  ${name}  ${f.file.status}  +${f.file.additions}/-${f.file.deletions}`];
    for (const h of list) {
      lines.push(`    ${h.id}  ${h.hunk.section || h.hunk.header}  +${h.additions}/-${h.deletions}`);
    }
    byDir.set(dir, [...(byDir.get(dir) ?? []), ...lines]);
  }
  return [...byDir].map(([dir, lines]) => `${dir}/\n${lines.join('\n')}`).join('\n');
}

export interface GroupingInput {
  prTitle: string;
  prBody: string;
  commits: string[];
  meat: MeatResult;
}

export function buildGroupingPrompt(input: GroupingInput, hunks: KeptHunk[]): { prompt: string; inline: boolean } {
  const parts = [`Pull request: ${input.prTitle}`];
  if (input.prBody.trim()) parts.push(`\nDescription:\n${input.prBody.trim()}`);
  if (input.commits.length > 1) {
    parts.push(`\nCommits (they hint at intent; group by the final change, not by commit):\n${input.commits.map((c) => `- ${c}`).join('\n')}`);
  }
  parts.push(`\nManifest (directory, then file status +added/-deleted, then hunk id and context):\n${buildManifest(input.meat, hunks)}`);

  const rendered = hunks.map(renderHunk).join('\n');
  const inline = rendered.length <= INLINE_LIMIT;
  parts.push(inline
    ? `\nThe hunks:\n${rendered}`
    : `\nThe hunks are too large to include. Call read_hunks with the ids you need; your reading budget is ${READ_BUDGET} characters. Read the ones whose context lines do not tell you enough, then submit.`);
  return { prompt: parts.join('\n'), inline };
}

/** Serves hunk bodies by id under a per-call and a total budget. */
export function readHunksTool(hunks: KeptHunk[]): AgentTool {
  const byId = new Map(hunks.map((h) => [h.id, h]));
  const shown = new Set<string>();
  let spent = 0;
  return {
    name: 'read_hunks',
    description: 'Returns the full text of the hunks with these ids.',
    params: { ids: { type: 'string[]', description: 'Hunk ids from the manifest.' } },
    handler: async ({ ids }) => {
      if (spent >= READ_BUDGET) return 'Reading budget exhausted. Submit your grouping now.';
      const out: string[] = [];
      const deferred: string[] = [];
      let call = 0;
      for (const id of Array.isArray(ids) ? ids : [String(ids)]) {
        const h = byId.get(id);
        if (!h) { out.push(`${id}: not a hunk id from this pull request`); continue; }
        if (shown.has(id)) { out.push(`${id}: already shown above`); continue; }
        const text = renderHunk(h);
        if (call + text.length > READ_CALL_LIMIT || spent + text.length > READ_BUDGET) { deferred.push(id); continue; }
        call += text.length;
        spent += text.length;
        shown.add(id);
        out.push(text);
      }
      if (deferred.length > 0) {
        out.push(spent >= READ_BUDGET
          ? `Reading budget exhausted; not returned: ${deferred.join(', ')}. Submit your grouping now.`
          : `Not returned (per-call limit), request again: ${deferred.join(', ')}`);
      }
      return out.join('\n');
    },
  };
}

export interface RunGroupingOptions extends GroupingInput {
  transport: AgentTransport;
  model: string;
  cache: GroupCache;
  /** Any directory; grouping reads nothing from disk. */
  cwd: string;
}

/**
 * Groups the kept hunks by intent. Never throws: a failed model call falls back
 * to grouping by directory and says why, and the fallback is never cached —
 * the cache has no expiry, so one degraded run would pin it forever.
 */
export async function runGrouping(opts: RunGroupingOptions): Promise<GroupingResult> {
  const hunks = keptHunks(opts.meat);
  const ids = hunks.map((h) => h.id);
  const files = new Set(hunks.map((h) => h.path));

  if (files.size <= SMALL_PR_FILES) {
    return { overallSummary: opts.meat.summary, groups: singleGroup(hunks, ''), source: 'single', error: null };
  }

  const key = groupingKey(ids, opts.prTitle, opts.prBody);
  const cached = await opts.cache.get(key).catch(() => null);
  if (cached) {
    // Reconciled again so a cache written by an older marrow still places every hunk.
    return { overallSummary: cached.overallSummary, groups: reconcile(cached.groups, ids), source: 'cache', error: null };
  }

  const { prompt, inline } = buildGroupingPrompt(opts, hunks);
  const tools = inline ? [] : [readHunksTool(hunks)];
  const request = {
    model: opts.model,
    cwd: opts.cwd,
    systemPrompt: SYSTEM_PROMPT,
    schema: GROUPING_SCHEMA,
    allowedTools: tools.map((t) => toolName(t.name)),
    disallowedTools: [...DENIED_TOOLS, 'Read', 'Grep', 'Glob'],
    tools,
  };

  try {
    let run = await opts.transport.run({ ...request, prompt });
    let raw = run.structured as { overallSummary?: string; groups?: RawGroup[] } | null;
    const report = checkCoverage(raw?.groups ?? [], ids);
    if (!isComplete(report)) {
      // One correction, then accept whatever comes back: reconcile places the rest.
      try {
        run = await opts.transport.run({
          ...request,
          resume: run.sessionId,
          prompt: `Your grouping has problems:\n${describeCoverage(report)}\n\nSubmit the corrected grouping in full.`,
        });
        raw = (run.structured as typeof raw) ?? raw;
      } catch {
        // The first answer is still better than the directory fallback.
      }
    }
    const groups = reconcile(raw?.groups ?? [], ids);
    const overallSummary = raw?.overallSummary?.trim() || opts.meat.summary;
    await opts.cache.set(key, { overallSummary, groups }).catch(() => {});
    return { overallSummary, groups, source: 'model', error: null };
  } catch (error) {
    return {
      overallSummary: opts.meat.summary,
      groups: groupByDirectory(hunks),
      source: 'directory',
      error: describeAgentFailure(error),
    };
  }
}
