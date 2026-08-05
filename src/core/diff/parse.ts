import type { DiffFile, DiffLine, FileStatus, Hunk } from './types.js';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

interface Draft {
  path: string | null;
  oldPath: string | null;
  status: FileStatus;
  similarity: number | null;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

function newDraft(): Draft {
  return {
    path: null,
    oldPath: null,
    status: 'modified',
    similarity: null,
    hunks: [],
    additions: 0,
    deletions: 0,
  };
}

function finish(draft: Draft, out: DiffFile[]): void {
  if (draft.path === null) return;
  out.push({
    path: draft.path,
    oldPath: draft.oldPath,
    status: draft.status,
    similarity: draft.similarity,
    hunks: draft.hunks,
    additions: draft.additions,
    deletions: draft.deletions,
  });
}

/** Strips git's a/ or b/ prefix. Leaves /dev/null alone. */
function stripPrefix(p: string): string {
  if (p === '/dev/null') return p;
  return p.replace(/^[ab]\//, '');
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const out: DiffFile[] = [];
  let draft = newDraft();
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      finish(draft, out);
      draft = newDraft();
      hunk = null;
      // Fall back to the paths on the diff --git line; ---/+++ overrides below.
      const parts = raw.slice('diff --git '.length).split(' ');
      if (parts.length === 2) {
        draft.oldPath = stripPrefix(parts[0]!);
        draft.path = stripPrefix(parts[1]!);
      }
      continue;
    }

    if (raw.startsWith('new file mode')) {
      draft.status = 'added';
      continue;
    }
    if (raw.startsWith('deleted file mode')) {
      draft.status = 'deleted';
      continue;
    }
    if (raw.startsWith('similarity index ')) {
      const pct = Number.parseInt(raw.slice('similarity index '.length), 10);
      draft.similarity = Number.isNaN(pct) ? null : pct;
      continue;
    }
    if (raw.startsWith('rename from ')) {
      draft.status = 'renamed';
      draft.oldPath = raw.slice('rename from '.length);
      continue;
    }
    if (raw.startsWith('rename to ')) {
      draft.status = 'renamed';
      draft.path = raw.slice('rename to '.length);
      continue;
    }
    if (raw.startsWith('Binary files ')) {
      draft.status = 'binary';
      continue;
    }
    if (raw.startsWith('index ') || raw.startsWith('old mode') || raw.startsWith('new mode')) {
      continue;
    }

    if (raw.startsWith('--- ')) {
      const p = stripPrefix(raw.slice(4));
      if (p !== '/dev/null') draft.oldPath = p;
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = stripPrefix(raw.slice(4));
      if (p !== '/dev/null') draft.path = p;
      else if (draft.oldPath !== null) draft.path = draft.oldPath;
      continue;
    }

    const m = HUNK_RE.exec(raw);
    if (m) {
      oldNo = Number.parseInt(m[1]!, 10);
      newNo = Number.parseInt(m[3]!, 10);
      hunk = {
        header: raw,
        section: m[5] ?? '',
        oldStart: oldNo,
        // An omitted count means exactly 1 line.
        oldLines: m[2] === undefined ? 1 : Number.parseInt(m[2], 10),
        newStart: newNo,
        newLines: m[4] === undefined ? 1 : Number.parseInt(m[4], 10),
        lines: [],
      };
      draft.hunks.push(hunk);
      continue;
    }

    if (hunk === null) continue;

    if (raw.startsWith('\\')) {
      // "\ No newline at end of file" annotates the line above it.
      const last = hunk.lines[hunk.lines.length - 1];
      if (last) last.noNewlineAtEof = true;
      continue;
    }

    const marker = raw[0];
    const text = raw.slice(1);
    let line: DiffLine | null = null;

    if (marker === '+') {
      line = { kind: 'add', text, oldLine: null, newLine: newNo++, noNewlineAtEof: false };
      draft.additions += 1;
    } else if (marker === '-') {
      line = { kind: 'del', text, oldLine: oldNo++, newLine: null, noNewlineAtEof: false };
      draft.deletions += 1;
    } else if (marker === ' ') {
      line = { kind: 'context', text, oldLine: oldNo++, newLine: newNo++, noNewlineAtEof: false };
    }
    // Any other leading character is not part of a hunk body; ignore it.

    if (line) hunk.lines.push(line);
  }

  finish(draft, out);
  return out;
}
