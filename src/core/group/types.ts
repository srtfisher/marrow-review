import type { AgentFailure } from '../agent/errors.js';

export const GROUP_CATEGORIES = [
  'ui', 'api', 'core', 'data', 'cli', 'security', 'tests', 'docs', 'examples',
  'deps', 'build', 'scripts', 'config', 'i18n', 'assets', 'other',
] as const;
export type GroupCategory = (typeof GROUP_CATEGORIES)[number];

export interface Group {
  key: string;
  label: string;
  summary: string;
  category: GroupCategory;
  hunkIds: string[];
  children: Group[];
}

export const UNGROUPED_KEY = '__ungrouped';

export interface GroupingResult {
  overallSummary: string;
  groups: Group[];
  /**
   * `directory` is the fallback when the model could not group, `single` the
   * deliberate skip for a change too small to need groups. Neither is ever
   * cached.
   */
  source: 'model' | 'cache' | 'directory' | 'single';
  /** Why the model grouping did not happen, when `source` is `directory`. */
  error: AgentFailure | null;
}
