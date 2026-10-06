import { GROUP_CATEGORIES, UNGROUPED_KEY, type Group, type GroupCategory } from './types.js';

export interface RawGroup {
  key?: string;
  label?: string;
  summary?: string;
  category?: string;
  hunkIds?: string[];
  children?: RawGroup[];
}

export interface CoverageReport {
  missing: string[];
  duplicated: string[];
  unknown: string[];
}

function allIds(groups: RawGroup[]): string[] {
  return groups.flatMap((g) => [...(g.hunkIds ?? []), ...allIds(g.children ?? [])]);
}

export function checkCoverage(groups: RawGroup[], expected: readonly string[]): CoverageReport {
  const known = new Set(expected);
  const seen = new Map<string, number>();
  for (const id of allIds(groups)) seen.set(id, (seen.get(id) ?? 0) + 1);
  return {
    missing: expected.filter((id) => !seen.has(id)),
    duplicated: [...seen].filter(([id, n]) => n > 1 && known.has(id)).map(([id]) => id),
    unknown: [...seen.keys()].filter((id) => !known.has(id)),
  };
}

export function isComplete(report: CoverageReport): boolean {
  return report.missing.length === 0 && report.duplicated.length === 0 && report.unknown.length === 0;
}

export function describeCoverage(report: CoverageReport): string {
  const parts: string[] = [];
  if (report.missing.length > 0) parts.push(`Missing from every group: ${report.missing.join(', ')}`);
  if (report.duplicated.length > 0) parts.push(`In more than one group: ${report.duplicated.join(', ')}`);
  if (report.unknown.length > 0) parts.push(`Not hunk ids from this pull request: ${report.unknown.join(', ')}`);
  return parts.join('\n');
}

function category(value: string | undefined): GroupCategory {
  return (GROUP_CATEGORIES as readonly string[]).includes(value ?? '') ? (value as GroupCategory) : 'other';
}

/**
 * Turns whatever the model returned into groups that place every hunk exactly
 * once: invented ids are dropped, a duplicate stays in the first group that
 * claimed it, empty groups disappear, and anything still unplaced lands in a
 * visible Ungrouped group — never silently off the page.
 */
export function reconcile(raw: RawGroup[], expected: readonly string[]): Group[] {
  const known = new Set(expected);
  const placed = new Set<string>();
  let counter = 0;

  function build(g: RawGroup, depth: number): Group | null {
    counter += 1;
    const hunkIds = (g.hunkIds ?? []).filter((id) => {
      if (!known.has(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    });
    // Two levels at most: a grandchild's hunks are folded into its parent.
    const children = (g.children ?? [])
      .map((c) => (depth === 0 ? build(c, 1) : null))
      .filter((c): c is Group => c !== null);
    if (depth > 0) {
      for (const c of g.children ?? []) {
        for (const id of allIds([c])) {
          if (known.has(id) && !placed.has(id)) { placed.add(id); hunkIds.push(id); }
        }
      }
    }
    if (hunkIds.length === 0 && children.length === 0) return null;
    return {
      key: g.key?.trim() || `group-${counter}`,
      label: g.label?.trim() || 'Untitled',
      summary: g.summary?.trim() ?? '',
      category: category(g.category),
      hunkIds,
      children,
    };
  }

  const groups = raw.map((g) => build(g, 0)).filter((g): g is Group => g !== null);
  const missing = expected.filter((id) => !placed.has(id));
  if (missing.length > 0) {
    groups.push({
      key: UNGROUPED_KEY,
      label: 'Ungrouped',
      summary: 'Hunks the grouping did not place.',
      category: 'other',
      hunkIds: missing,
      children: [],
    });
  }
  return groups;
}

/** Every hunk id in a group and its children, in reading order. */
export function groupHunkIds(group: Group): string[] {
  return [...group.hunkIds, ...group.children.flatMap(groupHunkIds)];
}
