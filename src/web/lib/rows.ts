import type { DiffLine, LayoutFile, LayoutSection, MeatFile, MeatResult, Side } from './types.js';

export interface ViewOptions {
  /** Show every hunk, including the ones the abridgement dropped. */
  fullDiff: boolean;
  revealAll: boolean;
  /** `${fileIndex}:${hunkIndex}` for a revealed hunk, `${fileIndex}:*` for a revealed dropped file. */
  revealed: ReadonlySet<string>;
  /** `${sectionKey}:${fileIndex}` for a file folded to its header. */
  collapsed: ReadonlySet<string>;
}

export interface LineRow {
  key: string;
  sectionKey: string;
  fileIndex: number;
  hunkIndex: number;
  lineIndex: number;
  path: string;
  line: DiffLine;
  /** Where a comment on this row anchors: removed lines on the left, everything else on the right. */
  side: Side;
  number: number;
}

export type Block =
  | { kind: 'hunk'; hunkIndex: number; header: string; section: string; reason: string; dropped: boolean; rows: LineRow[] }
  | { kind: 'fold'; hunkIndexes: number[]; reasons: string[]; lines: number };

export interface FileView {
  sectionKey: string;
  layout: LayoutFile;
  meatFile: MeatFile;
  collapsed: boolean;
  blocks: Block[];
}

export interface SectionView {
  section: LayoutSection;
  files: FileView[];
}

export function lineKey(fileIndex: number, hunkIndex: number, lineIndex: number): string {
  return `${fileIndex}:${hunkIndex}:${lineIndex}`;
}

function changed(meatFile: MeatFile, hunkIndex: number): number {
  return meatFile.hunks[hunkIndex]?.hunk.lines.filter((l) => l.kind !== 'context').length ?? 0;
}

function buildBlocks(sectionKey: string, layout: LayoutFile, meatFile: MeatFile, view: ViewOptions): Block[] {
  const { fileIndex } = layout;
  const wholeFileRevealed = view.fullDiff || view.revealAll || view.revealed.has(`${fileIndex}:*`);
  const blocks: Block[] = [];
  let fold: Extract<Block, { kind: 'fold' }> | null = null;

  for (const hunkIndex of layout.hunks) {
    const mh = meatFile.hunks[hunkIndex];
    if (!mh) continue;
    const shown = mh.keep || view.fullDiff || view.revealAll
      || view.revealed.has(`${fileIndex}:${hunkIndex}`)
      || (meatFile.dropped !== null && wholeFileRevealed);
    if (!shown) {
      // Consecutive dropped hunks fold into one strip, so a file of import churn
      // costs one row rather than one per hunk.
      if (!fold) { fold = { kind: 'fold', hunkIndexes: [], reasons: [], lines: 0 }; blocks.push(fold); }
      fold.hunkIndexes.push(hunkIndex);
      if (!fold.reasons.includes(mh.reason)) fold.reasons.push(mh.reason);
      fold.lines += changed(meatFile, hunkIndex);
      continue;
    }
    fold = null;
    blocks.push({
      kind: 'hunk',
      hunkIndex,
      header: mh.hunk.header,
      section: mh.hunk.section,
      reason: mh.reason,
      dropped: !mh.keep,
      rows: mh.hunk.lines.map((line, lineIndex) => {
        const left = line.kind === 'del';
        return {
          key: lineKey(fileIndex, hunkIndex, lineIndex),
          sectionKey,
          fileIndex,
          hunkIndex,
          lineIndex,
          path: meatFile.file.path,
          line,
          side: left ? 'LEFT' : 'RIGHT',
          number: (left ? line.oldLine : line.newLine) ?? 0,
        };
      }),
    });
  }
  return blocks;
}

/** The whole page as the renderer and the keyboard both see it — one model, so they cannot disagree. */
export function buildPage(meat: MeatResult, sections: LayoutSection[], view: ViewOptions): SectionView[] {
  return sections.map((section) => ({
    section,
    files: section.files.flatMap((layout) => {
      const meatFile = meat.files[layout.fileIndex];
      if (!meatFile) return [];
      const collapsed = view.collapsed.has(`${section.key}:${layout.fileIndex}`);
      return [{ sectionKey: section.key, layout, meatFile, collapsed, blocks: buildBlocks(section.key, layout, meatFile, view) }];
    }),
  }));
}

/** Every line the cursor can rest on, in page order. Folded files contribute nothing. */
export function navRows(page: SectionView[]): LineRow[] {
  return page.flatMap((s) => s.files.flatMap((f) => (f.collapsed ? [] : f.blocks.flatMap((b) => (b.kind === 'hunk' ? b.rows : [])))));
}
