import { test, expect, describe, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { render, type Instance } from 'ink';
import { App } from '../../src/tui/App.js';
import { FakeTransport } from '../../src/core/agent/fake.js';
import { findingId } from '../../src/core/findings/find.js';
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

  test('e rewrites a finding in the reviewer own editor', async () => {
    const submitted: ReviewDraft[] = [];
    const opened: string[] = [];
    const app = mount({
      pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree',
      onSubmit: (draft) => submitted.push(draft),
      editText: async (initial) => {
        opened.push(initial);
        return `${initial} Use an LRU.`;
      },
    });
    await delay(80);

    await app.press('n');
    await app.press('e');
    await delay(60);

    // The editor opens on the model's wording rather than a blank buffer, so a
    // reviewer can amend it instead of retyping it.
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain('Nothing ever evicts');

    // Editing implies keeping, so it is staged without pressing `a`.
    expect(app.frame()).toContain('1 staged');

    // The rendered card wraps, so the edited wording is checked where it is
    // unambiguous: in the comment that would actually be posted.
    await app.press('!');
    await app.press('\r');
    expect(submitted[0]?.comments[0]?.body).toEndWith(' Use an LRU.');
  });

  test('an editor that comes back unchanged stages nothing', async () => {
    const app = mount({
      pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree',
      // What `editInEditor` returns when the editor exits non-zero.
      editText: async (initial) => initial,
    });
    await delay(80);

    await app.press('n');
    await app.press('e');
    await delay(60);
    expect(app.frame()).toContain('0 staged');
  });

  test('an editor that cannot be spawned leaves the review untouched', async () => {
    const app = mount({
      pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree',
      editText: async () => {
        throw new Error('no such editor');
      },
    });
    await delay(80);

    await app.press('n');
    await app.press('e');
    await delay(60);
    expect(app.frame()).toContain('0 staged');

    // Still usable afterwards: keys land on the diff, not into a dead overlay.
    await app.press('a');
    expect(app.frame()).toContain('1 staged');
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

const secondFile: MeatFile = {
  file: {
    path: 'src/store.ts', oldPath: null, status: 'modified', similarity: null,
    hunks: [], additions: 1, deletions: 0,
  },
  dropped: null,
  hunks: [{
    hunk: {
      header: '@@ -5,1 +5,2 @@', section: '', oldStart: 5, oldLines: 1, newStart: 5, newLines: 2,
      lines: [
        { kind: 'context', text: 'const rows = [];', oldLine: 5, newLine: 5, noNewlineAtEof: false },
        { kind: 'add', text: 'store.persist(rows);', oldLine: null, newLine: 6, noNewlineAtEof: false },
      ],
    },
    keep: true, reason: 'writes to disk', source: 'model',
  }],
};

const twoFileMeat: MeatResult = {
  summary: 'Caches the lookup.', files: [meatFile, secondFile],
  keptLines: 2, totalLines: 4, keptFiles: 2, totalFiles: 2,
};

/** A transport that answers nothing until the test says so, so a question can
 *  be left in flight while the reviewer moves on. */
function deferredTransport() {
  const inflight: Array<{ prompt: string; resume?: string; answer: (text: string) => void }> = [];
  const transport = {
    inflight,
    async run(req: { prompt: string; resume?: string }) {
      return new Promise((resolve) => {
        inflight.push({
          prompt: req.prompt,
          resume: req.resume,
          answer: (text: string) =>
            resolve({
              text, structured: null, sessionId: 'session-a',
              usage: { inputTokens: 0, outputTokens: 0, numTurns: 1 }, usageWarning: null,
            }),
        });
      });
    },
  };
  return transport;
}

describe('chat never attaches an answer to the wrong hunk', () => {
  test('an answer that arrives after the cursor moved is dropped', async () => {
    const transport = deferredTransport();
    const app = mount({ pr: detail, meat: twoFileMeat, transport: transport as never, cwd: '/tmp/worktree' });
    await delay(40);

    // inflight[0] is the findings pass, which never answers here.
    await app.press('i');
    await app.press('is the first file unbounded');
    await app.press('\r');
    await delay(20);
    const asked = transport.inflight.at(-1)!;
    expect(asked.prompt).toContain('cache.set(key, value);');

    // Escape while it is still out, move to the other file, reopen chat.
    await app.press(ESC);
    await app.press(']');
    await app.press('i');
    await delay(20);

    asked.answer('ANSWER ABOUT THE CACHE');
    await delay(60);

    // The second file's pane must not show the first file's transcript.
    expect(app.frame()).not.toContain('ANSWER ABOUT THE CACHE');
  });

  test('the next question starts a new session rather than resuming the stale one', async () => {
    const transport = deferredTransport();
    const app = mount({ pr: detail, meat: twoFileMeat, transport: transport as never, cwd: '/tmp/worktree' });
    await delay(40);

    await app.press('i');
    await app.press('first question');
    await app.press('\r');
    await delay(20);
    const first = transport.inflight.at(-1)!;

    await app.press(ESC);
    await app.press(']');
    await app.press('i');
    first.answer('ANSWER ABOUT THE CACHE');
    await delay(60);

    await app.press('second question');
    await app.press('\r');
    await delay(20);

    const second = transport.inflight.at(-1)!;
    expect(second).not.toBe(first);
    // A resumed session would put the first file's code back in front of the
    // model while the reviewer is looking at the second file's.
    expect(second.resume).toBeUndefined();
    expect(second.prompt).toContain('store.persist(rows);');
    expect(second.prompt).not.toContain('cache.set(key, value);');
  });

  test('a second question while one is pending does not race it', async () => {
    const transport = deferredTransport();
    const app = mount({ pr: detail, meat: twoFileMeat, transport: transport as never, cwd: '/tmp/worktree' });
    await delay(40);
    const before = transport.inflight.length;

    await app.press('i');
    await app.press('first');
    await app.press('\r');
    await delay(20);
    await app.press('second');
    await app.press('\r');
    await delay(20);

    expect(transport.inflight.length - before).toBe(1);
  });
});

describe('a failed model pass is stated, not swallowed', () => {
  test('says the pass failed and names the retry key', async () => {
    // An empty queue makes every run throw — a dead transport.
    const app = mount({
      pr: detail, meat, transport: new FakeTransport(), cwd: '/tmp/worktree',
    });
    await delay(80);
    expect(app.frame()).toContain('Model pass failed');
    expect(app.frame()).toContain('press R to retry');
  });

  test('a pass that ran and found nothing says nothing', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { findings: [] } });

    const app = mount({ pr: detail, meat, transport, cwd: '/tmp/worktree' });
    await delay(80);
    expect(app.frame().toLowerCase()).not.toContain('model pass failed');
    expect(app.frame()).toContain('cache.set(key, value);');
  });

  test('R retries the pass and the notice clears once it succeeds', async () => {
    const transport = new FakeTransport();
    const app = mount({ pr: detail, meat, transport, cwd: '/tmp/worktree' });
    await delay(80);
    expect(app.frame().toLowerCase()).toContain('model pass failed');

    transport.queue({ structured: { findings: [rawFinding] } });
    transport.queue({ structured: { refuted: false, reasoning: 'reachable' } });
    transport.queue({ structured: { refuted: false, reasoning: 'reproduces' } });

    await app.press('R');
    await delay(120);
    expect(app.frame()).toContain('Unbounded cache');
    expect(app.frame().toLowerCase()).not.toContain('model pass failed');
  });
});

describe('the app fits the terminal it was given', () => {
  /** Twelve hunks of twelve lines: far more than the harness's 30 rows. */
  const tallMeat: MeatResult = {
    summary: 'A large change.',
    files: [{
      file: {
        path: 'src/big.ts', oldPath: null, status: 'modified', similarity: null,
        hunks: [], additions: 144, deletions: 0,
      },
      dropped: null,
      hunks: Array.from({ length: 12 }, (_, h) => ({
        hunk: {
          header: `@@ -${h * 20},12 +${h * 20},12 @@`, section: '',
          oldStart: h * 20, oldLines: 12, newStart: h * 20, newLines: 12,
          lines: Array.from({ length: 12 }, (_, i) => ({
            kind: 'add' as const, text: `line ${h}.${i}`,
            oldLine: null, newLine: h * 20 + i, noNewlineAtEof: false,
          })),
        },
        keep: true, reason: 'meaningful', source: 'model' as const,
      })),
    }],
    keptLines: 144, totalLines: 144, keptFiles: 1, totalFiles: 1,
  };

  function frameRows(frame: string): number {
    return frame.split('\n').length;
  }

  test('a diff many screens long still leaves the status bar on screen', async () => {
    const app = mount({ pr: detail, meat: tallMeat });
    await app.press('j');
    // The status bar is the last row; if the pane overran it would be gone.
    expect(app.frame()).toContain('worktree ok');
    expect(frameRows(app.frame())).toBeLessThanOrEqual(30);
  });

  test('a status note is paid for out of the pane, not out of the status bar', async () => {
    const app = mount({
      pr: detail, meat: tallMeat,
      status: 'You have an unsubmitted review on this pull request from the web UI.',
      statusTone: 'pending',
    });
    await app.press('j');
    expect(app.frame()).toContain('unsubmitted review');
    expect(app.frame()).toContain('worktree ok');
    expect(frameRows(app.frame())).toBeLessThanOrEqual(30);
  });

  test('ctrl-d moves a real half page and stays inside the frame', async () => {
    const app = mount({ pr: detail, meat: tallMeat });
    await app.press('j');
    const first = app.frame();
    await app.press('\u0004');
    const after = app.frame();

    expect(after).not.toBe(first);
    expect(after).toContain('worktree ok');
    expect(frameRows(after)).toBeLessThanOrEqual(30);
  });
});

describe('unsubmitted work survives the session', () => {
  test('a restored draft is staged the moment the pull request opens', async () => {
    const app = mount({
      pr: detail,
      meat,
      initialDraft: {
        verdict: null,
        body: '',
        comments: [{
          id: 'c1', path: 'src/cache.ts', line: 2, side: 'RIGHT',
          startLine: null, body: 'From last time.', suggestion: null,
        }],
      },
    });
    await delay(60);
    expect(app.frame()).toContain('1 staged');
  });

  test('a restored comment and the finding it came from are not staged twice', async () => {
    // The id `findingId` gives this exact finding, which is also the id
    // `toStagedComments` puts on the comment accepting it produces.
    const sameId = findingId(rawFinding);
    const app = mount({
      pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree',
      initialDraft: {
        verdict: null,
        body: '',
        comments: [{
          id: sameId, path: 'src/cache.ts', line: 2, side: 'RIGHT',
          startLine: null, body: 'From last time.', suggestion: null,
        }],
      },
    });
    await delay(80);
    expect(app.frame()).toContain('1 staged');

    // Accepting the finding the restored comment already came from must not
    // post the same note to the same line twice.
    await app.press('n');
    await app.press('a');
    expect(app.frame()).toContain('1 staged');
  });

  test('staged work is written through as it changes', async () => {
    const saved: ReviewDraft[] = [];
    const app = mount({
      pr: detail, meat, onPersist: (d) => saved.push(d),
    });
    await delay(60);
    // Nothing to save yet: an empty record for every pull request merely opened
    // would bury the ones that matter.
    expect(saved).toHaveLength(0);

    await app.press('C');
    await app.press('Needs a test.');
    await app.press('\r');
    await delay(40);

    expect(saved.length).toBeGreaterThan(0);
    expect(saved.at(-1)?.comments[0]?.body).toBe('Needs a test.');
  });

  test('q with nothing staged just quits', async () => {
    const app = mount({ pr: detail, meat });
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });
    await app.press('q');
    await delay(40);
    expect(exited).toBe(true);
  });

  test('q with unsubmitted work asks first, and esc goes back to the review', async () => {
    const app = mount({ pr: detail, meat });
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });

    await app.press('C');
    await app.press('Needs a test.');
    await app.press('\r');
    await app.press('q');
    await delay(40);

    expect(exited).toBe(false);
    expect(app.frame()).toContain('1 unsubmitted comment(s)');

    await app.press(ESC);
    expect(app.frame()).toContain('1 staged');
    expect(exited).toBe(false);
  });

  test('enter at the confirm saves the draft and quits', async () => {
    const saved: ReviewDraft[] = [];
    const discarded: number[] = [];
    const app = mount({
      pr: detail, meat, onPersist: (d) => saved.push(d), onDiscard: () => discarded.push(1),
    });
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });

    await app.press('C');
    await app.press('Needs a test.');
    await app.press('\r');
    await app.press('q');
    await app.press('\r');
    await delay(40);

    expect(exited).toBe(true);
    expect(saved.at(-1)?.comments[0]?.body).toBe('Needs a test.');
    expect(discarded).toHaveLength(0);
  });

  test('x at the confirm discards deliberately', async () => {
    const discarded: number[] = [];
    const app = mount({ pr: detail, meat, onDiscard: () => discarded.push(1) });
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });

    await app.press('C');
    await app.press('Needs a test.');
    await app.press('\r');
    await app.press('q');
    await app.press('x');
    await delay(40);

    expect(exited).toBe(true);
    expect(discarded).toHaveLength(1);
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
