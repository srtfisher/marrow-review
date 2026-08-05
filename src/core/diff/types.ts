export type LineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: LineKind;
  /** Line content with the leading +/-/space removed. */
  text: string;
  /** Line number in the pre-image, or null for additions. */
  oldLine: number | null;
  /** Line number in the post-image, or null for deletions. */
  newLine: number | null;
  noNewlineAtEof: boolean;
}

export interface Hunk {
  /** The raw @@ line, verbatim. */
  header: string;
  /** Trailing context after the second @@, often a function signature. '' if absent. */
  section: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'binary';

export interface DiffFile {
  /** Post-image path, or the pre-image path when the file was deleted. */
  path: string;
  /** Pre-image path, set only for renames. */
  oldPath: string | null;
  status: FileStatus;
  /** Rename similarity percentage, when git reported one. */
  similarity: number | null;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}
