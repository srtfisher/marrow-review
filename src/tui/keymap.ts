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
  | { type: 'toggle-threads' }
  | { type: 'open-browser' }
  | { type: 'comment' }
  | { type: 'suggest' }
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

export const KEY_HELP: ReadonlyArray<{ keys: string; description: string; modes: Mode[] }> = [
  { keys: 'j / k', description: 'move down / up', modes: ['list', 'detail'] },
  { keys: 'ctrl-d / ctrl-u', description: 'half page down / up', modes: ['detail'] },
  { keys: '] / [', description: 'next / previous file', modes: ['detail'] },
  { keys: 'space', description: 'fold or unfold this file', modes: ['detail'] },
  { keys: 'z / Z', description: 'reveal dropped hunks in this file / everywhere', modes: ['detail'] },
  { keys: 'd', description: 'toggle full diff vs meat', modes: ['detail'] },
  { keys: 't', description: 'toggle existing review threads', modes: ['detail'] },
  { keys: 'o', description: 'open this hunk on github.com', modes: ['detail'] },
  { keys: 'C', description: 'comment on this line', modes: ['detail'] },
  { keys: 'S', description: 'suggest a change on this line', modes: ['detail'] },
  { keys: 'n / p', description: 'next / previous finding', modes: ['detail'] },
  { keys: 'a / x', description: 'accept this finding as a comment / drop it', modes: ['detail'] },
  { keys: 'e / s', description: 'rewrite this finding / send it as a suggestion', modes: ['detail'] },
  { keys: 'v', description: 'show refuted findings and why they were refuted', modes: ['detail'] },
  { keys: 'i', description: 'ask the model about this hunk', modes: ['detail'] },
  { keys: '!', description: 'open the submit screen', modes: ['detail'] },
  { keys: 'enter', description: 'open the selected pull request', modes: ['list'] },
  { keys: '1 / 2 / 3', description: 'filter: open / needs my review / all', modes: ['list'] },
  { keys: '/', description: 'search by title, author, or number', modes: ['list'] },
  { keys: 'R', description: 'refetch from GitHub; retry the model pass', modes: ['list', 'detail'] },
  { keys: '?', description: 'this help', modes: ['list', 'detail'] },
  { keys: 'q', description: 'quit', modes: ['list', 'detail'] },
  { keys: 'esc / q', description: 'close this overlay', modes: ['comment', 'submit', 'help', 'search', 'chat'] },
];

const FILTERS: Record<string, PullFilter> = {
  '1': 'open',
  '2': 'review-requested',
  '3': 'all',
};

export function resolveAction(input: string, key: KeyLike, mode: Mode): Action {
  // Text-entry modes swallow everything except an explicit escape, so a stray
  // '!' or 'q' while typing a comment — or a question for the model — can never
  // trigger a command.
  if (mode === 'comment' || mode === 'search' || mode === 'chat') {
    return key.escape ? { type: 'back' } : null;
  }

  if (key.escape) return { type: 'back' };

  // An overlay you cannot leave with the key you leave everything else with is
  // a trap, and `q` in help reads as "quit this, not the program".
  if (mode === 'help') return input === 'q' ? { type: 'back' } : null;

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
  if (input === 't') return { type: 'toggle-threads' };
  if (input === 'o') return { type: 'open-browser' };
  if (input === 'C') return { type: 'comment' };
  if (input === 'S') return { type: 'suggest' };
  if (input === '!') return { type: 'submit-screen' };

  // Findings triage. These act on the finding under the cursor and do nothing
  // anywhere else, so they are safe to give single unshifted letters — unlike
  // submit, which must never be one keystroke away.
  if (input === 'n') return { type: 'finding', dir: 1 };
  if (input === 'p') return { type: 'finding', dir: -1 };
  if (input === 'a') return { type: 'accept-finding' };
  if (input === 'e') return { type: 'edit-finding' };
  if (input === 's') return { type: 'toggle-finding-suggestion' };
  if (input === 'x') return { type: 'drop-finding' };
  if (input === 'v') return { type: 'toggle-refuted' };
  if (input === 'i') return { type: 'chat' };

  return null;
}
