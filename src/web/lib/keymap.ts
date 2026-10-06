export type Action =
  | 'down' | 'up' | 'nextFile' | 'prevFile' | 'nextGroup' | 'prevGroup' | 'nextFinding' | 'prevFinding'
  | 'comment' | 'range' | 'suggest' | 'accept' | 'edit' | 'drop'
  | 'reveal' | 'revealAll' | 'fullDiff' | 'sidebar' | 'threads' | 'refuted' | 'viewed'
  | 'ask' | 'openGithub' | 'help' | 'submit' | 'retry' | 'escape';

export interface Shortcut {
  key: string;
  /** How the key is drawn on a button or in the help dialog. */
  label: string;
  action: Action;
  description: string;
  group: 'Move' | 'Comment' | 'Findings' | 'View' | 'Review';
}

/** The single list: the key handler, the help dialog, and every button's hint read from here. */
export const SHORTCUTS: readonly Shortcut[] = [
  { key: 'j', label: 'j', action: 'down', description: 'Next line', group: 'Move' },
  { key: 'k', label: 'k', action: 'up', description: 'Previous line', group: 'Move' },
  { key: ']', label: ']', action: 'nextFile', description: 'Next file', group: 'Move' },
  { key: '[', label: '[', action: 'prevFile', description: 'Previous file', group: 'Move' },
  { key: '}', label: '}', action: 'nextGroup', description: 'Next group', group: 'Move' },
  { key: '{', label: '{', action: 'prevGroup', description: 'Previous group', group: 'Move' },
  { key: 'n', label: 'n', action: 'nextFinding', description: 'Next finding or comment', group: 'Move' },
  { key: 'p', label: 'p', action: 'prevFinding', description: 'Previous finding or comment', group: 'Move' },
  { key: 'c', label: 'c', action: 'comment', description: 'Comment on the line or selection', group: 'Comment' },
  { key: 'V', label: '⇧V', action: 'range', description: 'Start or clear a block selection', group: 'Comment' },
  { key: 's', label: 's', action: 'suggest', description: 'Suggest a change (or post a finding as one)', group: 'Comment' },
  { key: 'a', label: 'a', action: 'accept', description: 'Accept the finding at the cursor', group: 'Findings' },
  { key: 'e', label: 'e', action: 'edit', description: 'Edit the finding at the cursor', group: 'Findings' },
  { key: 'x', label: 'x', action: 'drop', description: 'Drop the finding at the cursor', group: 'Findings' },
  { key: 'v', label: 'v', action: 'refuted', description: 'Show refuted findings', group: 'Findings' },
  { key: 'R', label: '⇧R', action: 'retry', description: 'Run the review pass again', group: 'Findings' },
  { key: 'z', label: 'z', action: 'reveal', description: 'Reveal folded hunks in this file', group: 'View' },
  { key: 'Z', label: '⇧Z', action: 'revealAll', description: 'Reveal everything folded', group: 'View' },
  { key: 'd', label: 'd', action: 'fullDiff', description: 'Abridged ↔ full diff', group: 'View' },
  { key: 'g', label: 'g', action: 'sidebar', description: 'Sidebar: groups ↔ files', group: 'View' },
  { key: 't', label: 't', action: 'threads', description: 'Show existing review threads', group: 'View' },
  { key: 'w', label: 'w', action: 'viewed', description: 'Mark the file viewed', group: 'View' },
  { key: 'i', label: 'i', action: 'ask', description: 'Ask Claude about this code', group: 'Review' },
  { key: 'o', label: 'o', action: 'openGithub', description: 'Open on GitHub', group: 'Review' },
  { key: '?', label: '?', action: 'help', description: 'Keyboard shortcuts', group: 'Review' },
  { key: '!', label: '!', action: 'submit', description: 'Review changes', group: 'Review' },
];

const BY_KEY = new Map(SHORTCUTS.map((s) => [s.key, s.action]));
const BY_ACTION = new Map(SHORTCUTS.map((s) => [s.action, s]));

export function actionFor(key: string): Action | null {
  if (key === 'ArrowDown') return 'down';
  if (key === 'ArrowUp') return 'up';
  if (key === 'Escape') return 'escape';
  return BY_KEY.get(key) ?? null;
}

export function keyLabel(action: Action): string {
  return BY_ACTION.get(action)?.label ?? '';
}

export function ariaKey(action: Action): string {
  const s = BY_ACTION.get(action);
  if (!s) return '';
  return s.label.startsWith('⇧') ? `Shift+${s.key}` : s.key;
}
