import type { MeatResult } from '../meat/index.js';
import type { DiffLine } from '../diff/types.js';

function marker(line: DiffLine): string {
  if (line.kind === 'add') return '+';
  if (line.kind === 'del') return '-';
  return ' ';
}

/** Plain-text rendering of a meat result. Plan 2 replaces this with the TUI. */
export function renderMeat(result: MeatResult): string {
  const out: string[] = [];

  if (result.summary.length > 0) {
    out.push(result.summary, '');
  }

  out.push(
    `kept ${result.keptLines}/${result.totalLines} changed lines in ${result.keptFiles}/${result.totalFiles} files`,
    '',
  );

  for (const file of result.files) {
    if (file.dropped) {
      out.push(`── ${file.file.path}  (dropped: ${file.dropped.rule})`, '');
      continue;
    }

    const kept = file.hunks.filter((h) => h.keep);
    const droppedCount = file.hunks.length - kept.length;

    const suffix = droppedCount > 0 ? `  (${droppedCount} hunk(s) dropped)` : '';
    out.push(`── ${file.file.path}${suffix}`);

    if (kept.length === 0) {
      out.push('   (nothing kept)', '');
      continue;
    }

    for (const meatHunk of kept) {
      out.push(`   ${meatHunk.hunk.header}    [${meatHunk.reason}]`);
      for (const line of meatHunk.hunk.lines) {
        out.push(`   ${marker(line)}${line.text}`);
      }
      out.push('');
    }
  }

  return out.join('\n');
}
