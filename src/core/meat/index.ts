import type { AgentTransport } from '../agent/types.js';
import type { DiffFile, Hunk } from '../diff/types.js';
import { hunkKey, type CachedVerdict, type VerdictCache } from './cache.js';
import { classifyHunks, type ClassifyItem, type ClassifyResult } from './classify.js';
import { evaluateFile, evaluateHunk, type RuleContext, type RuleVerdict } from './rules.js';

export interface MeatHunk {
  hunk: Hunk;
  keep: boolean;
  reason: string;
  source: 'rule' | 'model' | 'cache';
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
  keptFiles: number;
  totalFiles: number;
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

function changedLineCount(hunk: Hunk): number {
  return hunk.lines.filter((l) => l.kind !== 'context').length;
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
  let keptFiles = 0;

  for (const meatFile of staged) {
    let fileKept = 0;
    for (const h of meatFile.hunks) {
      const count = changedLineCount(h.hunk);
      totalLines += count;
      if (h.keep) {
        keptLines += count;
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
    keptFiles,
    totalFiles: staged.length,
  };
}
