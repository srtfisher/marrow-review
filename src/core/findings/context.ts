import type { CheckRun, ReviewThread } from '../github/types.js';
import type { FileHistory } from '../github/history.js';
import type { MeatResult } from '../meat/index.js';
import type { Effort } from '../review/rubric.js';

export interface ChangedFile {
  path: string;
  /** The head version, every line numbered so a reviewer can anchor without opening it. */
  text: string;
}

/** Everything the reviewers read, gathered once before any of them starts. */
export interface ReviewContext {
  prTitle: string;
  prBody: string;
  meat: MeatResult;
  threads: ReviewThread[];
  failingChecks: CheckRun[];
  effort: Effort;
  /** Team standards from `--standards`. '' for none. */
  standards: string;
  /** CLAUDE.md / AGENTS.md at the base ref, root and changed directories. '' for none. */
  conventions: string;
  files: ChangedFile[];
  /** Changed files left out of `files` for the size budget; reviewers with tools may open them. */
  omittedFiles: string[];
  history: FileHistory[];
}

export const FILE_CHARS = 40_000;
export const FILES_TOTAL_CHARS = 150_000;

export function numbered(text: string): string {
  const lines = text.split('\n');
  const width = String(lines.length).length;
  return lines.map((line, i) => `${String(i + 1).padStart(width)}  ${line}`).join('\n');
}

/** Files with kept hunks, largest kept change first, so the budget goes where the review is. */
export function filesToRead(meat: MeatResult): string[] {
  return meat.files
    .filter((f) => f.file.status !== 'deleted' && f.file.status !== 'binary')
    .map((f) => ({
      path: f.file.path,
      kept: f.hunks.filter((h) => h.keep).reduce((n, h) => n + h.hunk.lines.filter((l) => l.kind !== 'context').length, 0),
    }))
    .filter((f) => f.kept > 0)
    .sort((a, b) => b.kept - a.kept)
    .map((f) => f.path);
}

/**
 * The head contents of the changed files, inside the size budget. A file too big for
 * its own cap, or for what is left of the total, is listed rather than cut: half a file
 * reads as the whole file, and a reviewer would judge code it never saw.
 */
export async function readChangedFiles(
  paths: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<{ files: ChangedFile[]; omitted: string[] }> {
  const texts = await Promise.all(paths.map((p) => read(p).catch(() => null)));
  const files: ChangedFile[] = [];
  const omitted: string[] = [];
  let total = 0;
  paths.forEach((path, i) => {
    const text = texts[i];
    if (text === null || text === undefined) return;
    if (text.length > FILE_CHARS || total + text.length > FILES_TOTAL_CHARS) {
      omitted.push(path);
      return;
    }
    total += text.length;
    files.push({ path, text: numbered(text) });
  });
  return { files, omitted };
}
