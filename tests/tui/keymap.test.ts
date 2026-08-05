import { test, expect, describe } from 'bun:test';
import { resolveAction, KEY_HELP } from '../../src/tui/keymap.js';

const noKey = {};

describe('detail mode', () => {
  test('j and k move the cursor', () => {
    expect(resolveAction('j', noKey, 'detail')).toEqual({ type: 'move', delta: 1 });
    expect(resolveAction('k', noKey, 'detail')).toEqual({ type: 'move', delta: -1 });
  });

  test('arrow keys mirror j and k', () => {
    expect(resolveAction('', { downArrow: true }, 'detail')).toEqual({ type: 'move', delta: 1 });
    expect(resolveAction('', { upArrow: true }, 'detail')).toEqual({ type: 'move', delta: -1 });
  });

  test('ctrl-d and ctrl-u are half-page moves', () => {
    expect(resolveAction('d', { ctrl: true }, 'detail')).toEqual({ type: 'half-page', dir: 1 });
    expect(resolveAction('u', { ctrl: true }, 'detail')).toEqual({ type: 'half-page', dir: -1 });
  });

  test('plain d toggles the full diff and is not confused with ctrl-d', () => {
    expect(resolveAction('d', noKey, 'detail')).toEqual({ type: 'toggle-full-diff' });
  });

  test('bracket keys move by file', () => {
    expect(resolveAction(']', noKey, 'detail')).toEqual({ type: 'file', dir: 1 });
    expect(resolveAction('[', noKey, 'detail')).toEqual({ type: 'file', dir: -1 });
  });

  test('z and Z reveal dropped hunks', () => {
    expect(resolveAction('z', noKey, 'detail')).toEqual({ type: 'toggle-dropped' });
    expect(resolveAction('Z', noKey, 'detail')).toEqual({ type: 'toggle-dropped-all' });
  });

  test('C authors a comment and S a suggestion', () => {
    expect(resolveAction('C', noKey, 'detail')).toEqual({ type: 'comment' });
    expect(resolveAction('S', noKey, 'detail')).toEqual({ type: 'suggest' });
  });

  test('bang opens the submit screen', () => {
    expect(resolveAction('!', noKey, 'detail')).toEqual({ type: 'submit-screen' });
  });

  test('no single letter maps to submit, so approve cannot be hit by accident', () => {
    for (const ch of 'aAxXmMsScC') {
      const action = resolveAction(ch, noKey, 'detail');
      expect(action?.type).not.toBe('submit-screen');
    }
  });
});

describe('findings triage', () => {
  test('n and p walk the findings', () => {
    expect(resolveAction('n', noKey, 'detail')).toEqual({ type: 'finding', dir: 1 });
    expect(resolveAction('p', noKey, 'detail')).toEqual({ type: 'finding', dir: -1 });
  });

  test('a accepts, x drops, e edits, s toggles the suggestion', () => {
    expect(resolveAction('a', noKey, 'detail')).toEqual({ type: 'accept-finding' });
    expect(resolveAction('x', noKey, 'detail')).toEqual({ type: 'drop-finding' });
    expect(resolveAction('e', noKey, 'detail')).toEqual({ type: 'edit-finding' });
    expect(resolveAction('s', noKey, 'detail')).toEqual({ type: 'toggle-finding-suggestion' });
  });

  test('v reveals refutations and i opens chat', () => {
    expect(resolveAction('v', noKey, 'detail')).toEqual({ type: 'toggle-refuted' });
    expect(resolveAction('i', noKey, 'detail')).toEqual({ type: 'chat' });
  });

  test('the triage letters stay inert in list mode', () => {
    for (const ch of 'aexsvinp') {
      expect(resolveAction(ch, noKey, 'list')).toBeNull();
    }
  });

  test('lowercase s does not collide with the S that authors a suggestion', () => {
    expect(resolveAction('S', noKey, 'detail')).toEqual({ type: 'suggest' });
  });
});

describe('chat mode', () => {
  test('swallows every key except escape, so a question is never a command', () => {
    expect(resolveAction('', { escape: true }, 'chat')).toEqual({ type: 'back' });
    // Every triage letter plus the global ones: typing "can x still be null?"
    // must not drop a finding, quit, or open the submit screen.
    for (const ch of 'aexsvinpjkqR?!123/') {
      expect(resolveAction(ch, noKey, 'chat')).toBeNull();
    }
    expect(resolveAction('', { return: true }, 'chat')).toBeNull();
  });
});

describe('list mode', () => {
  test('enter opens the selected PR', () => {
    expect(resolveAction('', { return: true }, 'list')).toEqual({ type: 'open' });
  });

  test('digits pick a filter', () => {
    expect(resolveAction('1', noKey, 'list')).toEqual({ type: 'filter', filter: 'open' });
    expect(resolveAction('2', noKey, 'list')).toEqual({ type: 'filter', filter: 'review-requested' });
    expect(resolveAction('3', noKey, 'list')).toEqual({ type: 'filter', filter: 'all' });
  });

  test('slash starts a search', () => {
    expect(resolveAction('/', noKey, 'list')).toEqual({ type: 'search' });
  });

  test('detail-only keys do nothing in list mode', () => {
    expect(resolveAction('z', noKey, 'list')).toBeNull();
    expect(resolveAction('!', noKey, 'list')).toBeNull();
  });
});

describe('search mode', () => {
  test('swallows every key except escape, so typing a query is never a command', () => {
    expect(resolveAction('', { escape: true }, 'search')).toEqual({ type: 'back' });
    for (const ch of 'jkq?!123/') {
      expect(resolveAction(ch, noKey, 'search')).toBeNull();
    }
  });
});

describe('comment mode', () => {
  test('escape backs out and ordinary characters are not actions', () => {
    expect(resolveAction('', { escape: true }, 'comment')).toEqual({ type: 'back' });
    expect(resolveAction('j', noKey, 'comment')).toBeNull();
    expect(resolveAction('!', noKey, 'comment')).toBeNull();
  });
});

describe('global keys', () => {
  test('question mark and q work from detail', () => {
    expect(resolveAction('?', noKey, 'detail')).toEqual({ type: 'help' });
    expect(resolveAction('q', noKey, 'detail')).toEqual({ type: 'quit' });
  });

  test('typing keys are inert in comment mode even if global elsewhere', () => {
    expect(resolveAction('q', noKey, 'comment')).toBeNull();
    expect(resolveAction('?', noKey, 'comment')).toBeNull();
  });

  test('q closes the help overlay rather than doing nothing', () => {
    expect(resolveAction('q', noKey, 'help')).toEqual({ type: 'back' });
    expect(resolveAction('', { escape: true }, 'help')).toEqual({ type: 'back' });
    // It must close help, not quit the program out from under it.
    expect(resolveAction('q', noKey, 'help')).not.toEqual({ type: 'quit' });
  });

  test('the submit screen still swallows q, since submit is not an overlay to dismiss', () => {
    expect(resolveAction('q', noKey, 'submit')).toBeNull();
  });
});

describe('KEY_HELP', () => {
  test('documents every binding the resolver answers to in detail mode', () => {
    const documented = KEY_HELP.filter((e) => e.modes.includes('detail'));
    expect(documented.length).toBeGreaterThan(8);
    for (const entry of documented) {
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  test('documents each new triage key, since the overlay is generated from it', () => {
    const documented = KEY_HELP.filter((e) => e.modes.includes('detail'));
    const keys = documented.map((e) => e.keys).join(' ');
    for (const key of ['a', 'e', 's', 'x', 'v', 'i', 'n', 'p']) {
      expect(keys.split(/[\s/]+/)).toContain(key);
    }
    for (const entry of documented) {
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});
