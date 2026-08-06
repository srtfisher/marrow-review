import type { PullFilter } from '../core/github/types.js';

export type Mode = 'list' | 'detail' | 'comment' | 'submit' | 'help' | 'search' | 'chat';

export type Action =
  | { type: 'move'; delta: number }
  | { type: 'half-page'; dir: -1 | 1 }
  | { type: 'file'; dir: -1 | 1 }
  | { type: 'finding'; dir: -1 | 1 }
  | { type: 'accept-finding' }
  | { type: 'drop-finding' }
  | { type: 'edit-finding' }
  | { type: 'toggle-finding-suggestion' }
  | { type: 'toggle-refuted' }
  | { type: 'chat' }
  | { type: 'open' }
  | { type: 'back' }
  | { type: 'toggle-dropped' }
  | { type: 'toggle-dropped-all' }
  | { type: 'toggle-fold' }
  | { type: 'toggle-full-diff' }
  | { type: 'toggle-reviewed' }
  | { type: 'toggle-threads' }
  | { type: 'open-browser' }
  | { type: 'comment' }
  | { type: 'suggest' }
  | { type: 'select' }
  | { type: 'edit-comment' }
  | { type: 'delete-comment' }
  | { type: 'submit-screen' }
  | { type: 'filter'; filter: PullFilter }
  | { type: 'search' }
  | { type: 'help' }
  | { type: 'quit' }
  | { type: 'refresh' }
  | null;

/** Structural subset of Ink's Key, so this module needs no Ink import. */
export interface KeyLike {
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
}

/**
 * Sections of the help overlay, in the order a reviewer needs them: get around,
 * read, deal with what the model found, record an opinion, pick the next one.
 *
 * The overlay is generated from these, so a binding cannot be added without
 * landing under a heading — twenty-four rows in one undifferentiated column is a
 * list nobody reads to the end of.
 */
export type HelpGroup = 'move' | 'read' | 'findings' | 'record' | 'list' | 'anywhere';

export const HELP_GROUPS: ReadonlyArray<{ id: HelpGroup; title: string }> = [
  { id: 'move', title: 'move' },
  { id: 'read', title: 'read the diff' },
  { id: 'findings', title: 'what the model found' },
  { id: 'record', title: 'record your review' },
  { id: 'list', title: 'choose a pull request' },
  { id: 'anywhere', title: 'anywhere' },
];

export interface KeyHelpEntry {
  keys: string;
  description: string;
  modes: Mode[];
  group: HelpGroup;
}

export const KEY_HELP: readonly KeyHelpEntry[] = [
  { keys: 'j / k', description: 'move down / up', modes: ['list', 'detail'], group: 'move' },
  { keys: 'ctrl-d / ctrl-u', description: 'half page down / up', modes: ['detail'], group: 'move' },
  { keys: '] / [', description: 'next / previous file', modes: ['detail'], group: 'move' },
  { keys: 'n / p', description: 'next / previous finding', modes: ['detail'], group: 'move' },
  // The mouse is documented here for the same reason the keys are: a reviewer
  // who does not know the wheel works will not try it twice.
  { keys: 'wheel', description: 'scroll the diff', modes: ['list', 'detail'], group: 'move' },
  { keys: 'click', description: 'put the cursor on that line, or jump to that file', modes: ['detail'], group: 'move' },
  { keys: 'drag / shift-click', description: 'select a range of lines', modes: ['detail'], group: 'move' },
  { keys: 'double-click', description: 'comment on that line', modes: ['detail'], group: 'move' },
  { keys: 'space', description: 'fold or unfold this file', modes: ['detail'], group: 'read' },
  { keys: 'z / Z', description: 'reveal dropped hunks in this file / everywhere', modes: ['detail'], group: 'read' },
  { keys: 'd', description: 'toggle full diff vs meat', modes: ['detail'], group: 'read' },
  { keys: 'm', description: 'check this file off as reviewed', modes: ['detail'], group: 'read' },
  { keys: 't', description: 'toggle existing review threads', modes: ['detail'], group: 'read' },
  { keys: 'o', description: 'open this hunk on github.com', modes: ['detail'], group: 'read' },
  { keys: 'a / x', description: 'accept this finding as a comment / drop it', modes: ['detail'], group: 'findings' },
  { keys: 'e / s', description: 'rewrite this finding / send it as a suggestion', modes: ['detail'], group: 'findings' },
  { keys: 'v', description: 'show refuted findings and why they were refuted', modes: ['detail'], group: 'findings' },
  { keys: 'i', description: 'ask the model about this hunk', modes: ['detail'], group: 'findings' },
  { keys: 'V', description: 'select lines; move to grow the range, esc to clear', modes: ['detail'], group: 'record' },
  { keys: 'c', description: 'comment on the line or selection', modes: ['detail'], group: 'record' },
  { keys: 's', description: 'suggest a change to the line or selection', modes: ['detail'], group: 'record' },
  { keys: 'enter / x', description: 'edit / delete the comment under the cursor', modes: ['detail'], group: 'record' },
  { keys: '!', description: 'approve, request changes, or comment', modes: ['detail'], group: 'record' },
  { keys: 'enter', description: 'open the selected pull request', modes: ['list'], group: 'list' },
  { keys: '1 / 2 / 3', description: 'filter: open / needs my review / all', modes: ['list'], group: 'list' },
  { keys: '/', description: 'search by title, author, or number', modes: ['list'], group: 'list' },
  { keys: 'R', description: 'refetch from GitHub; retry the model pass', modes: ['list', 'detail'], group: 'anywhere' },
  { keys: '?', description: 'this help', modes: ['list', 'detail'], group: 'anywhere' },
  { keys: 'q', description: 'quit', modes: ['list', 'detail'], group: 'anywhere' },
  { keys: 'esc / q', description: 'close this overlay', modes: ['comment', 'submit', 'help', 'search', 'chat'], group: 'anywhere' },
];

const FILTERS: Record<string, PullFilter> = {
  '1': 'open',
  '2': 'review-requested',
  '3': 'all',
};

/**
 * What the cursor is sitting on.
 *
 * Several keys act on the thing under the cursor rather than meaning one fixed
 * command — `s` sends a model finding but authors your own suggestion, `x`
 * drops a finding but deletes your own comment. That rule is the app's grammar,
 * so the keymap is told the context instead of returning an ambiguous action
 * for `App` to disambiguate.
 */
export interface RowContext {
  onFinding?: boolean;
  /** A staged comment of the reviewer's own, rendered inline in the diff. */
  onComment?: boolean;
}

export function resolveAction(
  input: string,
  key: KeyLike,
  mode: Mode,
  context: RowContext = {},
): Action {
  // Text-entry modes swallow everything except an explicit escape, so a stray
  // '!' or 'q' while typing a comment — or a question for the model — can never
  // trigger a command.
  if (mode === 'comment' || mode === 'search' || mode === 'chat') {
    return key.escape ? { type: 'back' } : null;
  }

  if (key.escape) return { type: 'back' };

  // An overlay you cannot leave with the key you leave everything else with is
  // a trap, and `q` in help reads as "quit this, not the program".
  //
  // It scrolls, because on a narrow terminal every binding does not fit in one
  // screen and the one you are looking for is as likely to be below the fold as
  // above it. Same keys as everywhere else — learning a second set to read the
  // list of the first would be a joke at the reviewer's expense.
  if (mode === 'help') {
    if (input === 'q') return { type: 'back' };
    if (key.upArrow || input === 'k') return { type: 'move', delta: -1 };
    if (key.downArrow || input === 'j') return { type: 'move', delta: 1 };
    if (key.ctrl && input === 'd') return { type: 'half-page', dir: 1 };
    if (key.ctrl && input === 'u') return { type: 'half-page', dir: -1 };
    return null;
  }

  // Submit-screen internals are handled by the screen itself; only global
  // navigation is resolved here.
  if (mode === 'submit') return null;

  if (key.upArrow) return { type: 'move', delta: -1 };
  if (key.downArrow) return { type: 'move', delta: 1 };

  if (key.ctrl && input === 'd') return { type: 'half-page', dir: 1 };
  if (key.ctrl && input === 'u') return { type: 'half-page', dir: -1 };

  if (input === 'j') return { type: 'move', delta: 1 };
  if (input === 'k') return { type: 'move', delta: -1 };
  if (input === '?') return { type: 'help' };
  if (input === 'q') return { type: 'quit' };
  if (input === 'R') return { type: 'refresh' };

  if (mode === 'list') {
    if (key.return) return { type: 'open' };
    if (input === '/') return { type: 'search' };
    const filter = FILTERS[input];
    if (filter) return { type: 'filter', filter };
    return null;
  }

  // mode === 'detail'
  if (input === ']') return { type: 'file', dir: 1 };
  if (input === '[') return { type: 'file', dir: -1 };
  if (input === ' ') return { type: 'toggle-fold' };
  if (input === 'z') return { type: 'toggle-dropped' };
  if (input === 'Z') return { type: 'toggle-dropped-all' };
  if (input === 'd') return { type: 'toggle-full-diff' };
  if (input === 'm') return { type: 'toggle-reviewed' };
  if (input === 't') return { type: 'toggle-threads' };
  if (input === 'o') return { type: 'open-browser' };
  if (input === 'c') return { type: 'comment' };
  if (input === 'V') return { type: 'select' };
  if (input === '!') return { type: 'submit-screen' };

  // Your own staged comment, sitting in the diff under the lines it is about.
  // Enter means nothing anywhere else in the pane, so it is free to mean this.
  if (context.onComment) {
    if (key.return) return { type: 'edit-comment' };
    if (input === 'x') return { type: 'delete-comment' };
  }

  // Findings triage. These act on the finding under the cursor and do nothing
  // anywhere else, so they are safe to give single unshifted letters — unlike
  // submit, which must never be one keystroke away.
  if (input === 'n') return { type: 'finding', dir: 1 };
  if (input === 'p') return { type: 'finding', dir: -1 };
  if (input === 'a') return { type: 'accept-finding' };
  if (input === 'e') return { type: 'edit-finding' };
  // On a finding, `s` sends that finding as a suggestion; anywhere else in the
  // diff it opens a suggestion of your own. Same key, same verb, whatever the
  // cursor happens to be on.
  if (input === 's') {
    return context.onFinding ? { type: 'toggle-finding-suggestion' } : { type: 'suggest' };
  }
  if (input === 'x') return { type: 'drop-finding' };
  if (input === 'v') return { type: 'toggle-refuted' };
  if (input === 'i') return { type: 'chat' };

  return null;
}
