import type { AgentTransport } from '../agent/types.js';
import type { DiffFile, Hunk } from '../diff/types.js';
import { hunkKey, type CachedVerdict, type VerdictCache } from './cache.js';
import { classifyHunks, type ClassifyItem, type ClassifyResult } from './classify.js';
import { evaluateFile, evaluateHunk, type RuleContext, type RuleVerdict } from './rules.js';

export interface MeatHunk {
  hunk: Hunk;
  keep: boolean;
  reason: string;
  /**
   * `fallback` means no verdict came back for this hunk and it was kept
   * because keeping is the safe default — not because anything judged it
   * worth reading. Distinct from `model` so the pane can say how much of an
   * abridgement is real.
   */
  source: 'rule' | 'model' | 'cache' | 'fallback';
}

export interface MeatFile {
  file: DiffFile;
  /** Set when a file-level rule dropped the whole file. */
  dropped: RuleVerdict | null;
  hunks: MeatHunk[];
}

export interface MeatResult {
  summary: string;
  files: MeatFile[];
  keptLines: number;
  totalLines: number;
  /**
   * The same two totals split by direction, so the header can say `+98 −26`
   * beside them. Each pair sums to its total — see `changedLineCounts`.
   */
  keptAdditions: number;
  keptDeletions: number;
  totalAdditions: number;
  totalDeletions: number;
  keptFiles: number;
  totalFiles: number;
  /**
   * Hunks kept because no verdict came back for them.
   *
   * A run that succeeds but returns fewer verdicts than it was asked for
   * leaves these behind, and the result — nearly every line "kept" — is
   * indistinguishable from a pull request the classifier judged to be entirely
   * meaningful. It read as the abridgement being broken. Counted here so the
   * pane can say so out loud instead.
   */
  unclassified: number;
}

export interface ComputeMeatOptions {
  files: DiffFile[];
  ruleContext: RuleContext;
  transport: AgentTransport;
  cache: VerdictCache;
  model: string;
  prTitle: string;
  prBody: string;
}

/**
 * Additions and deletions in a hunk, counted separately.
 *
 * The single place that decides what "a changed line" is. `changedLineCount` is
 * the sum of these rather than its own filter, so the split shown in the header
 * can never disagree with the total shown beside it.
 */
export function changedLineCounts(hunk: Hunk): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of hunk.lines) {
    if (line.kind === 'add') additions += 1;
    else if (line.kind === 'del') deletions += 1;
  }
  return { additions, deletions };
}

function changedLineCount(hunk: Hunk): number {
  const { additions, deletions } = changedLineCounts(hunk);
  return additions + deletions;
}

export async function computeMeat(opts: ComputeMeatOptions): Promise<MeatResult> {
  const staged: MeatFile[] = [];
  const toClassify: ClassifyItem[] = [];
  const pendingKeys = new Map<string, MeatHunk>();

  for (const file of opts.files) {
    const fileVerdict = evaluateFile(file, opts.ruleContext);
    if (fileVerdict) {
      staged.push({
        file,
        dropped: fileVerdict,
        hunks: file.hunks.map((hunk) => ({
          hunk,
          keep: false,
          reason: fileVerdict.rule,
          source: 'rule' as const,
        })),
      });
      continue;
    }

    const hunks: MeatHunk[] = [];
    for (const hunk of file.hunks) {
      const hunkVerdict = evaluateHunk(hunk, file.path);
      if (hunkVerdict) {
        hunks.push({ hunk, keep: false, reason: hunkVerdict.rule, source: 'rule' });
        continue;
      }

      const key = hunkKey(file.path, hunk);
      const cached = await opts.cache.get(key);
      if (cached) {
        hunks.push({ hunk, keep: cached.keep, reason: cached.reason, source: 'cache' });
        continue;
      }

      const entry: MeatHunk = {
        hunk,
        keep: true,
        reason: 'pending classification',
        source: 'model',
      };
      hunks.push(entry);
      pendingKeys.set(key, entry);
      toClassify.push({ id: key, filePath: file.path, hunk });
    }

    staged.push({ file, dropped: null, hunks });
  }

  let summary = '';
  if (toClassify.length > 0) {
    // A model failure never makes the app unusable: the classification pass is
    // additive, so anything it could not judge stays kept.
    let classified: ClassifyResult;
    try {
      classified = await classifyHunks(
        opts.transport,
        opts.model,
        opts.prTitle,
        opts.prBody,
        toClassify,
      );
    } catch {
      classified = {
        summary: '',
        verdicts: new Map(
          toClassify.map((item) => [
            item.id,
            { keep: true, reason: 'classification failed', synthetic: true },
          ]),
        ),
      };
    }
    summary = classified.summary;

    for (const [key, verdict] of classified.verdicts) {
      const entry = pendingKeys.get(key);
      if (!entry) continue;
      entry.keep = verdict.keep;
      entry.reason = verdict.reason;
      if (verdict.synthetic === true) entry.source = 'fallback';
      // Synthetic verdicts are fallbacks, not judgments. The cache is permanent
      // and has no expiry, so persisting one would disable abridgement for this
      // hunk forever on the strength of a single degraded run.
      if (verdict.synthetic === true) continue;
      const stored: CachedVerdict = { keep: verdict.keep, reason: verdict.reason };
      await opts.cache.set(key, stored);
    }
  }

  let keptLines = 0;
  let totalLines = 0;
  let keptAdditions = 0;
  let keptDeletions = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;
  let keptFiles = 0;
  let unclassified = 0;

  for (const meatFile of staged) {
    let fileKept = 0;
    for (const h of meatFile.hunks) {
      const { additions, deletions } = changedLineCounts(h.hunk);
      const count = additions + deletions;
      totalLines += count;
      totalAdditions += additions;
      totalDeletions += deletions;
      if (h.source === 'fallback') unclassified += 1;
      if (h.keep) {
        keptLines += count;
        keptAdditions += additions;
        keptDeletions += deletions;
        fileKept += count;
      }
    }
    if (fileKept > 0) keptFiles += 1;
  }

  return {
    summary,
    files: staged,
    keptLines,
    totalLines,
    keptAdditions,
    keptDeletions,
    totalAdditions,
    totalDeletions,
    keptFiles,
    totalFiles: staged.length,
    unclassified,
  };
}
