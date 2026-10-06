import type { MeatResult } from '../meat/index.js';
import { hunkId } from './ids.js';
import { UNGROUPED_KEY, type Group, type GroupCategory } from './types.js';

export interface LayoutFile {
  path: string;
  /** Index into `meat.files`. */
  fileIndex: number;
  /** Indexes into that file's hunks, ascending: kept hunks of this group plus folds placed here. */
  hunks: number[];
  /** Keys of the other sections this file also appears in. */
  alsoIn: string[];
}

export interface LayoutSection {
  key: string;
  label: string;
  summary: string;
  category: GroupCategory;
  kind: 'group' | 'ungrouped' | 'dropped';
  depth: 0 | 1;
  files: LayoutFile[];
}

export const DROPPED_KEY = '__dropped';

/**
 * Lays groups out as reading-order sections, and places every hunk the
 * abridgement dropped so nothing goes missing: a dropped hunk sits beside the
 * nearest kept hunk of its file, in that hunk's group; a file with nothing kept
 * goes to a final "Dropped by abridgement" section.
 */
export function layoutSections(meat: MeatResult, groups: Group[]): LayoutSection[] {
  const owner = new Map<string, string>();
  const flat: Array<{ group: Group; depth: 0 | 1 }> = [];
  for (const g of groups) {
    flat.push({ group: g, depth: 0 });
    for (const c of g.children) flat.push({ group: c, depth: 1 });
  }
  for (const { group } of flat) for (const id of group.hunkIds) owner.set(id, group.key);

  // section key -> fileIndex -> hunk indexes
  const placed = new Map<string, Map<number, number[]>>();
  const place = (key: string, fileIndex: number, hunkIndex: number) => {
    const files = placed.get(key) ?? new Map<number, number[]>();
    files.set(fileIndex, [...(files.get(fileIndex) ?? []), hunkIndex]);
    placed.set(key, files);
  };

  meat.files.forEach((file, fileIndex) => {
    const keptAt: Array<{ index: number; key: string }> = [];
    file.hunks.forEach((h, index) => {
      if (!h.keep) return;
      const key = owner.get(hunkId(file.file.path, h.hunk)) ?? UNGROUPED_KEY;
      keptAt.push({ index, key });
      place(key, fileIndex, index);
    });

    file.hunks.forEach((h, index) => {
      if (h.keep) return;
      if (keptAt.length === 0) { place(DROPPED_KEY, fileIndex, index); return; }
      let best = keptAt[0]!;
      for (const k of keptAt) if (Math.abs(k.index - index) < Math.abs(best.index - index)) best = k;
      place(best.key, fileIndex, index);
    });

    // A file with no hunks at all (a binary, a pure rename) still belongs on the page.
    if (file.hunks.length === 0) place(DROPPED_KEY, fileIndex, -1);
  });

  const sectionsOf = new Map<number, string[]>();
  for (const [key, files] of placed) {
    for (const fileIndex of files.keys()) sectionsOf.set(fileIndex, [...(sectionsOf.get(fileIndex) ?? []), key]);
  }

  const toFiles = (key: string): LayoutFile[] =>
    [...(placed.get(key) ?? new Map<number, number[]>())]
      .sort(([a], [b]) => a - b)
      .map(([fileIndex, hunks]) => ({
        path: meat.files[fileIndex]!.file.path,
        fileIndex,
        hunks: hunks.filter((i) => i >= 0).sort((a, b) => a - b),
        alsoIn: (sectionsOf.get(fileIndex) ?? []).filter((k) => k !== key),
      }));

  const sections: LayoutSection[] = flat.map(({ group, depth }) => ({
    key: group.key,
    label: group.label,
    summary: group.summary,
    category: group.category,
    kind: group.key === UNGROUPED_KEY ? 'ungrouped' : 'group',
    depth,
    files: toFiles(group.key),
  }));

  // Kept hunks whose ids no group claimed — a grouping still in flight.
  if (!flat.some(({ group }) => group.key === UNGROUPED_KEY) && placed.has(UNGROUPED_KEY)) {
    sections.push({
      key: UNGROUPED_KEY, label: groups.length === 0 ? 'All changes' : 'Ungrouped', summary: '',
      category: 'other', kind: 'ungrouped', depth: 0, files: toFiles(UNGROUPED_KEY),
    });
  }

  if (placed.has(DROPPED_KEY)) {
    sections.push({
      key: DROPPED_KEY, label: 'Dropped by abridgement', summary: '',
      category: 'other', kind: 'dropped', depth: 0, files: toFiles(DROPPED_KEY),
    });
  }
  return sections;
}
