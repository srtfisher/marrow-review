import type { KeptHunk } from './ids.js';
import type { Group, GroupCategory } from './types.js';

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[^/]+$/;
const DOC_PATH = /\.(md|mdx|rst|txt)$/i;
const CONFIG_PATH = /(^|\/)\.[^/]+$|\.(json|ya?ml|toml|ini)$/i;

export function categorize(path: string): GroupCategory {
  if (TEST_PATH.test(path)) return 'tests';
  if (DOC_PATH.test(path)) return 'docs';
  if (CONFIG_PATH.test(path)) return 'config';
  return 'other';
}

/** Monorepo-shaped prefixes are one level too shallow to tell areas apart. */
const CONTAINERS = new Set(['src', 'packages', 'apps', 'lib', 'app', 'libs', 'modules']);

export function areaOf(path: string): string {
  const parts = path.split('/');
  if (parts.length === 1) return '(root)';
  if (CONTAINERS.has(parts[0]!) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0]!;
}

/**
 * Deterministic grouping by directory, for when the model could not group.
 * Worse than intent, but it still breaks a large change into areas, and
 * every hunk lands somewhere.
 */
export function groupByDirectory(hunks: KeptHunk[]): Group[] {
  const byArea = new Map<string, KeptHunk[]>();
  for (const h of hunks) {
    const area = areaOf(h.path);
    byArea.set(area, [...(byArea.get(area) ?? []), h]);
  }
  return [...byArea].map(([area, list]) => {
    const categories = new Set(list.map((h) => categorize(h.path)));
    return {
      key: `dir:${area}`,
      label: area,
      summary: '',
      category: categories.size === 1 ? [...categories][0]! : 'other',
      hunkIds: list.map((h) => h.id),
      children: [],
    };
  });
}

export function singleGroup(hunks: KeptHunk[], summary: string): Group[] {
  if (hunks.length === 0) return [];
  return [{
    key: 'all',
    label: 'All changes',
    summary,
    category: 'other',
    hunkIds: hunks.map((h) => h.id),
    children: [],
  }];
}
