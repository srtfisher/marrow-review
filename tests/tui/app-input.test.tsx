import { test, expect, describe, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { render, type Instance } from 'ink';
import { App } from '../../src/tui/App.js';
import { FakeTransport } from '../../src/core/agent/fake.js';
import type { PullRequestDetail, PullRequestSummary } from '../../src/core/github/types.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import type { RawFinding } from '../../src/core/findings/types.js';
import type { ReviewDraft } from '../../src/core/review/types.js';

/**
 * A pty stand-in. Ink refuses to enter raw mode without `isTTY`, so driving the
 * real key path — the only way to test the state machine as the user meets it —
 * means handing it a stream that claims to be a terminal.
 */
function fakeStdin() {
  const stream = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (value: boolean) => void;
    ref: () => void;
    unref: () => void;
  };
  stream.isTTY = true;
  stream.setRawMode = () => {};
  stream.ref = () => {};
  stream.unref = () => {};
  return stream;
}

function fakeStdout() {
  const frames: string[] = [];
  const stream = new EventEmitter() as EventEmitter & {
    columns: number;
    rows: number;
    isTTY: boolean;
    write: (chunk: string) => boolean;
    frames: string[];
  };
  stream.columns = 100;
  stream.rows = 30;
  // Interactive, so Ink emits a frame per render rather than one at unmount.
  stream.isTTY = true;
  stream.frames = frames;
  stream.write = (chunk: string) => {
    frames.push(chunk);
    return true;
  };
  return stream;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function summary(number: number, title: string, author = 'srtfisher'): PullRequestSummary {
  return {
    number, title, author, state: 'open', isDraft: false,
    headSha: 'abc', baseRef: 'main', headRef: 'feat/x',
    updatedAt: '2026-08-01T00:00:00Z', additions: 10, deletions: 2, changedFiles: 3,
  };
}

const prs = [
  summary(41, 'Alpha rendering'),
  summary(42, 'Beta caching', 'tqbf'),
  summary(43, 'Gamma parsing'),
];

let live: Instance | null = null;

afterEach(() => {
  live?.unmount();
  live = null;
});

interface Harness {
  press: (keys: string) => Promise<void>;
  frame: () => string;
  instance: Instance;
}

function mount(props: Partial<Parameters<typeof App>[0]> = {}): Harness {
  const stdin = fakeStdin();
  const stdout = fakeStdout();

  const instance = render(
    <App
      repoLabel="srtfisher/marrow"
      prs={prs}
      pr={null}
      meat={null}
      checks={[]}
      threads={[]}
      model="opus"
      worktreeOk
      filter="open"
      onOpenPr={() => {}}
      onSubmit={() => {}}
      {...props}
    />,
    { stdin: stdin as never, stdout: stdout as never, patchConsole: false, exitOnCtrlC: false },
  );
  live = instance;

  // Ink splits one frame across several writes (synchronized-output markers
  // around the content), so a frame is everything written since the last key.
  let mark = 0;

  return {
    instance,
    async press(keys: string) {
      mark = stdout.frames.length;
      stdin.write(keys);
      await delay(40);
    },
    frame: () => stdout.frames.slice(mark).join('').replaceAll(/\[[\d;?]*[a-zA-Z]/g, ''),
  };
}

describe('App key handling', () => {
  test('/ narrows the list live and shows the query', async () => {
    const app = mount();
    await app.press('/');
    await app.press('caching');
    expect(app.frame()).toContain('Beta caching');
    expect(app.frame()).not.toContain('Alpha rendering');
  });

  test('esc during a search restores the full list', async () => {
    const app = mount();
    await app.press('/');
    await app.press('caching');
    await app.press('');
    expect(app.frame()).toContain('Alpha rendering');
  });

  test('enter opens the pull request the filtered list is pointing at', async () => {
    const opened: number[] = [];
    const app = mount({ onOpenPr: (n) => opened.push(n) });

    // Move to the third entry, then narrow so only the second survives. The
    // cursor must follow the filtered array, not the index it held before.
    await app.press('jj');
    await app.press('/');
    await app.press('caching');
    await app.press('\r');
    await app.press('\r');

    expect(opened).toEqual([42]);
  });

  test('a search that matches nothing says so and opens nothing', async () => {
    const opened: number[] = [];
    const app = mount({ onOpenPr: (n) => opened.push(n) });
    await app.press('/');
    await app.press('zzzz');
    expect(app.frame().toLowerCase()).toContain('no match');

    // Leaving the search and pressing enter must not fall back to some stale
    // index; with nothing matched there is nothing to open.
    await app.press('\r');
    await app.press('\r');
    expect(opened).toEqual([]);
  });

  test('? opens help listing the bindings, and esc returns to the list', async () => {
    const app = mount();
    await app.press('?');
    expect(app.frame()).toContain('open the submit screen');
    await app.press('');
    expect(app.frame()).toContain('Alpha rendering');
  });

  test('1/2/3 ask for a different filter', async () => {
    const chosen: string[] = [];
    const app = mount({ onFilter: (f) => chosen.push(f) });
    await app.press('2');
    await app.press('3');
    expect(chosen).toEqual(['review-requested', 'all']);
  });

  test('q exits so the terminal comes back', async () => {
    const app = mount();
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });
    await app.press('q');
    await delay(40);
    expect(exited).toBe(true);
  });
});

const detail: PullRequestDetail = {
  ...summary(42, 'Beta caching', 'tqbf'),
  body: 'Adds a cache.',
  diff: '',
  viewerIsAuthor: false,
};

const meatFile: MeatFile = {
  file: {
    path: 'src/cache.ts', oldPath: null, status: 'modified', similarity: null,
    hunks: [], additions: 1, deletions: 0,
  },
  dropped: null,
  hunks: [{
    hunk: {
      header: '@@ -1,1 +1,2 @@', section: '', oldStart: 1, oldLines: 1, newStart: 1, newLines: 2,
      lines: [
        { kind: 'context', text: 'const ttl = 0;', oldLine: 1, newLine: 1, noNewlineAtEof: false },
        { kind: 'add', text: 'cache.set(key, value);', oldLine: null, newLine: 2, noNewlineAtEof: false },
      ],
    },
    keep: true, reason: 'writes to the cache', source: 'model',
  }],
};

const meat: MeatResult = {
  summary: 'Caches the lookup.', files: [meatFile],
  keptLines: 1, totalLines: 2, keptFiles: 1, totalFiles: 1,
};

const rawFinding: RawFinding = {
  path: 'src/cache.ts', line: 2, side: 'RIGHT', startLine: null,
  severity: 'important', title: 'Unbounded cache',
  body: 'Nothing ever evicts, so this grows without limit.',
  confidence: 'high', suggestion: null,
};

/** A transport that answers the findings pass and then both verify lenses. */
function findingTransport(): FakeTransport {
  const transport = new FakeTransport();
  transport.queue({ structured: { findings: [rawFinding] } });
  transport.queue({ structured: { refuted: false, reasoning: 'the path is reachable' } });
  transport.queue({ structured: { refuted: false, reasoning: 'it reproduces' } });
  return transport;
}

const ESC = '';

describe('App findings', () => {
  test('a finding lands in the diff and n moves the cursor onto it', async () => {
    const app = mount({ pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree' });
    await delay(80);
    expect(app.frame()).toContain('Unbounded cache');

    await app.press('n');
    expect(app.frame()).toContain('Unbounded cache');
  });

  test('the agent reads the worktree, not the reviewer own checkout', async () => {
    const transport = findingTransport();
    mount({ pr: detail, meat, transport, cwd: '/tmp/worktree' });
    await delay(80);

    expect(transport.requests.length).toBeGreaterThan(0);
    for (const request of transport.requests) {
      expect(request.cwd).toBe('/tmp/worktree');
    }
  });

  test('a accepts a finding, and the status bar counts it as staged', async () => {
    const app = mount({ pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree' });
    await delay(80);

    await app.press('n');
    await app.press('a');
    expect(app.frame()).toContain('1 staged');
  });

  test('an accepted finding reaches the submit screen and the submitted draft', async () => {
    const submitted: ReviewDraft[] = [];
    const app = mount({
      pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree',
      onSubmit: (draft) => submitted.push(draft),
    });
    await delay(80);

    await app.press('n');
    await app.press('a');
    await app.press('!');
    expect(app.frame()).toContain('1 inline comment(s)');

    await app.press('\r');
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.comments.map((c) => c.path)).toEqual(['src/cache.ts']);
    expect(submitted[0]?.comments[0]?.body).toContain('Nothing ever evicts');
  });

  test('x drops a finding, which unstages it', async () => {
    const app = mount({ pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree' });
    await delay(80);

    await app.press('n');
    await app.press('a');
    expect(app.frame()).toContain('1 staged');

    await app.press('x');
    expect(app.frame()).toContain('0 staged');
  });

  test('e rewrites a finding in the reviewer own words', async () => {
    const submitted: ReviewDraft[] = [];
    const app = mount({
      pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree',
      onSubmit: (draft) => submitted.push(draft),
    });
    await delay(80);

    await app.press('n');
    await app.press('e');
    // The editor opens on the model's wording rather than a blank line, so a
    // reviewer can amend it instead of retyping it.
    expect(app.frame()).toContain('Nothing ever evicts');

    await app.press(' Use an LRU.');
    await app.press('\r');
    // Editing implies keeping, so it is staged without pressing `a`.
    expect(app.frame()).toContain('1 staged');

    // The rendered card wraps, so the edited wording is checked where it is
    // unambiguous: in the comment that would actually be posted.
    await app.press('!');
    await app.press('\r');
    expect(submitted[0]?.comments[0]?.body).toEndWith(' Use an LRU.');
  });

  test('a refuted finding collapses out of the way and v brings it back', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { findings: [rawFinding] } });
    transport.queue({ structured: { refuted: true, reasoning: 'the key is bounded' } });
    transport.queue({ structured: { refuted: true, reasoning: 'eviction runs on write' } });

    const app = mount({ pr: detail, meat, transport, cwd: '/tmp/worktree' });
    await delay(80);

    // Both lenses refuted it, so it is out of the default view.
    await app.press('j');
    expect(app.frame()).not.toContain('Unbounded cache');

    // Not deleted, though: the verifier can be wrong, and the reviewer has to
    // be able to see that it was.
    await app.press('v');
    expect(app.frame()).toContain('Unbounded cache');
    expect(app.frame()).toContain('the key is bounded');
  });

  test('i opens the chat prompt and esc closes it back onto the diff', async () => {
    const app = mount({ pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree' });
    await delay(80);

    await app.press('i');
    expect(app.frame()).toContain('Ask about this hunk');

    await app.press(ESC);
    expect(app.frame()).toContain('cache.set(key, value);');
  });

  test('a chat question carries the hunk and the answer comes back', async () => {
    const transport = findingTransport();
    transport.queue({ text: 'Nothing evicts it, so yes.', sessionId: 'chat-1' });

    const app = mount({ pr: detail, meat, transport, cwd: '/tmp/worktree' });
    await delay(80);

    await app.press('i');
    await app.press('is it really unbounded');
    await app.press('\r');
    await delay(60);

    expect(app.frame()).toContain('Nothing evicts it, so yes.');
    // The transcript reads back the reviewer's own question, not the hunk that
    // was pasted around it to prime the model.
    expect(app.frame()).toContain('is it really unbounded');
    expect(app.frame()).not.toContain('cache.set(key, value);');

    const asked = transport.requests.at(-1);
    expect(asked?.cwd).toBe('/tmp/worktree');
    expect(asked?.prompt).toContain('cache.set(key, value);');
    expect(asked?.prompt).toContain('is it really unbounded');
    // Read-only, in the app as much as in the module that enforces it.
    expect(asked?.disallowedTools).toContain('Bash');
  });

  test('typing a question in chat never runs a command', async () => {
    const app = mount({ pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree' });
    await delay(80);
    await app.press('i');

    // 'q' would quit, 'x' would drop the finding, '!' would open submit.
    await app.press('qx!');
    await delay(40);
    expect(app.frame()).toContain('Ask about this hunk');

    await app.press(ESC);
    expect(app.frame()).toContain('Unbounded cache');
    expect(app.frame()).toContain('0 staged');
  });
});

describe('findings are additive', () => {
  test('a findings pass that yields nothing leaves the whole review working', async () => {
    // An empty queue makes every FakeTransport run throw, which is what a dead
    // model, a rate limit, or an offline laptop look like from here.
    const submitted: ReviewDraft[] = [];
    const app = mount({
      pr: detail, meat, transport: new FakeTransport(), cwd: '/tmp/worktree',
      onSubmit: (draft) => submitted.push(draft),
    });
    await delay(80);

    // The diff itself.
    expect(app.frame()).toContain('Beta caching');
    expect(app.frame()).toContain('cache.set(key, value);');
    expect(app.frame()).toContain('kept 1/2');

    // Navigation.
    await app.press('j');
    await app.press(']');

    // Triage keys with no finding under the cursor are inert, not crashes:
    // nothing redraws, and the next ordinary key still lands on the diff.
    await app.press('naexsvp');
    expect(app.frame()).toBe('');
    await app.press('j');
    expect(app.frame()).toContain('cache.set(key, value);');

    // A manual comment, staged and submitted.
    await app.press('C');
    await app.press('This needs a test.');
    await app.press('\r');
    expect(app.frame()).toContain('1 staged');

    await app.press('!');
    await app.press('\r');
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.comments[0]?.body).toBe('This needs a test.');
  });

  test('no transport at all is the same as a silent one', async () => {
    const app = mount({ pr: detail, meat });
    await delay(80);
    expect(app.frame()).toContain('cache.set(key, value);');
    expect(app.frame()).toContain('0 staged');
  });
});
