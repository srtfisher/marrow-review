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

function summary(number: number, title: string, author = 'octocat'): PullRequestSummary {
  return {
    number, title, author, state: 'open', isDraft: false,
    headSha: 'abc', baseRef: 'main', headRef: 'feat/x',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

const prs = [
  summary(41, 'Alpha rendering'),
  summary(42, 'Beta caching', 'hubot'),
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
  /** Everything written since the last key, escapes and all. */
  raw: () => string;
  instance: Instance;
}

function mount(props: Partial<Parameters<typeof App>[0]> = {}): Harness {
  const stdin = fakeStdin();
  const stdout = fakeStdout();

  const instance = render(
    <App
      repoLabel="octocat/marrow"
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
    raw: () => stdout.frames.join(''),
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
    // One key per press: Ink delivers a multi-character write as one event, so
    // `press('jj')` moved nothing and this test passed without testing.
    await app.press('j');
    await app.press('j');
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
    expect(app.frame()).toContain('approve, request changes, or comment');
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
  ...summary(42, 'Beta caching', 'hubot'),
  body: 'Adds a cache.',
  diff: '',
  viewerIsAuthor: false,
  additions: 10, deletions: 2, changedFiles: 3,
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
  unclassified: 0,
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

  test('a accepts a finding, and the hint bar counts it as staged', async () => {
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
    expect(app.frame()).not.toContain('staged');
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
    expect(app.frame()).not.toContain('staged');
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
    expect(app.frame()).not.toContain('staged');

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
    expect(app.frame()).not.toContain('staged');
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
  unclassified: 0,
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
    unclassified: 0,
  };

  function frameRows(frame: string): number {
    return frame.split('\n').length;
  }

  test('a diff many screens long still leaves the hint bar on screen', async () => {
    const app = mount({ pr: detail, meat: tallMeat });
    await app.press('j');
    // the hint bar is the last row; if the pane overran it would be gone.
    expect(app.frame()).toMatch(/\? (?:all )?keys/);
    expect(frameRows(app.frame())).toBeLessThanOrEqual(30);
  });

  test('a status note is paid for out of the pane, not out of the hint bar', async () => {
    const app = mount({
      pr: detail, meat: tallMeat,
      status: 'You have an unsubmitted review on this pull request from the web UI.',
      statusTone: 'pending',
    });
    await app.press('j');
    expect(app.frame()).toContain('unsubmitted review');
    expect(app.frame()).toMatch(/\? (?:all )?keys/);
    expect(frameRows(app.frame())).toBeLessThanOrEqual(30);
  });

  test('ctrl-d moves a real half page and stays inside the frame', async () => {
    const app = mount({ pr: detail, meat: tallMeat });
    await app.press('j');
    const first = app.frame();
    await app.press('\u0004');
    const after = app.frame();

    expect(after).not.toBe(first);
    expect(after).toMatch(/\? (?:all )?keys/);
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
    expect(app.frame()).not.toContain('staged');
  });
});

describe('reviewing a large diff', () => {
  /** One file with a hunk far taller than the pane, then two ordinary ones —
   *  the shape that rendered a single file path into an empty screen. */
  const tall: MeatResult = {
    summary: 'A large change.',
    files: [
      {
        file: {
          path: 'docs/design.md', oldPath: null, status: 'modified', similarity: null,
          hunks: [], additions: 200, deletions: 0,
        },
        dropped: null,
        hunks: [{
          hunk: {
            header: '@@ -1,200 +1,200 @@', section: '',
            oldStart: 1, oldLines: 200, newStart: 1, newLines: 200,
            lines: Array.from({ length: 200 }, (_, i) => ({
              kind: 'add' as const, text: `paragraph ${i}`,
              oldLine: null, newLine: i + 1, noNewlineAtEof: false,
            })),
          },
          keep: true, reason: 'prose', source: 'model' as const,
        }],
      },
      meatFile,
      {
        ...meatFile,
        file: { ...meatFile.file, path: 'src/other.ts' },
      },
    ],
    keptLines: 202, totalLines: 204, keptFiles: 3, totalFiles: 3,
    unclassified: 0,
  };

  test('fills the pane with the diff instead of one file header', async () => {
    const app = mount({ pr: detail, meat: tall });
    await delay(60);
    const frame = app.frame();

    expect(frame).toContain('docs/design.md');
    expect(frame).toContain('paragraph 0');
    // Twenty rows deep into the hunk. Under the old whole-unit windowing the
    // hunk did not fit, so the pane showed the file header and nothing else.
    expect(frame).toContain('paragraph 19');
  });

  test('lists every file in the header, not only the ones on screen', async () => {
    const app = mount({ pr: detail, meat: tall });
    await delay(60);
    const frame = app.frame();

    // The diff body is still inside the first file, but all three are named.
    expect(frame).toContain('design.md');
    expect(frame).toContain('cache.ts');
    expect(frame).toContain('other.ts');
  });

  test('the sidebar gives way to the diff once a pull request is open', async () => {
    const closed = mount({});
    await delay(40);
    expect(closed.frame()).toContain('Alpha rendering');

    const open = mount({ pr: detail, meat: tall });
    await delay(60);
    expect(open.frame()).not.toContain('Alpha rendering');
  });

  test('] jumps to the next file and the index follows the cursor', async () => {
    const app = mount({ pr: detail, meat: tall });
    await delay(60);
    await app.press(']');
    expect(app.frame()).toContain('src/cache.ts');
  });
});

describe('checking a file off', () => {
  test('m marks the file under the cursor, and again unmarks it', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    expect(app.frame()).not.toContain('✓');

    await app.press('m');
    expect(app.frame()).toContain('✓');

    await app.press('m');
    expect(app.frame()).not.toContain('✓');
  });

  test('a file the cursor has read to the end of checks itself off', async () => {
    // "When you go through a file and review it, add a check after you are
    // done" — going through it is the signal, not a keystroke afterwards.
    const app = mount({ pr: detail, meat });
    await delay(60);
    expect(app.frame()).not.toContain('✓');

    // This diff is four rows; walking onto the last of them is reading it.
    // One key per press: Ink delivers a multi-character write as one event.
    await app.press('j');
    await app.press('j');
    expect(app.frame()).not.toContain('✓');
    await app.press('j');
    expect(app.frame()).toContain('✓');
  });
});

describe('d says which view you are in', () => {
  test('names the view, and switches it', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    expect(app.frame()).toContain('meat');
    expect(app.frame()).not.toContain('full diff');

    await app.press('d');
    expect(app.frame()).toContain('full diff');

    await app.press('d');
    expect(app.frame()).not.toContain('full diff');
  });
});

describe('commenting on a line', () => {
  test('C anchors to the line under the cursor, not to the hunk', async () => {
    const saved: ReviewDraft[] = [];
    const app = mount({ pr: detail, meat, onPersist: (d) => saved.push(d) });
    await delay(60);

    // Rows: file header, hunk header, the context line, the added line. Stop on
    // the context line — line 1, where the hunk's own anchor would be line 2.
    await app.press('j');
    await app.press('j');
    await app.press('C');
    await app.press('Is the TTL right?');
    await app.press('\r');
    await delay(40);

    expect(saved.at(-1)?.comments[0]).toMatchObject({
      path: 'src/cache.ts', line: 1, side: 'RIGHT', body: 'Is the TTL right?',
    });
  });

  test('and one row further down anchors one line further down', async () => {
    const saved: ReviewDraft[] = [];
    const app = mount({ pr: detail, meat, onPersist: (d) => saved.push(d) });
    await delay(60);

    await app.press('j');
    await app.press('j');
    await app.press('j');
    await app.press('C');
    await app.press('This is the one.');
    await app.press('\r');
    await delay(40);

    expect(saved.at(-1)?.comments[0]).toMatchObject({ line: 2, side: 'RIGHT' });
  });
});

describe('esc comes back out of the diff', () => {
  test('the sidebar returns and the list takes the cursor again', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    // Reviewing: the diff owns the terminal.
    expect(app.frame()).not.toContain('Alpha rendering');

    await app.press(ESC);
    // Keying the sidebar on "a pull request is loaded" rather than on the mode
    // left it hidden here, and esc looked like a dead key.
    expect(app.frame()).toContain('Alpha rendering');
    expect(app.frame()).toContain('Gamma parsing');
  });

  test('and the hint bar goes back to the list verbs', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    expect(app.frame()).toContain('comment on this line');

    await app.press(ESC);
    expect(app.frame()).toContain('search');
    expect(app.frame()).not.toContain('comment on this line');
  });
});

/**
 * The mouse. Every one of these is also a key and stays one — this is a keyboard
 * tool — but a reviewer scrolling a diff reaches for the wheel without deciding
 * to, and a window that ignores it feels like it is not really running there.
 *
 * Reports are SGR, one-based, `ESC [ < button ; column ; row M`.
 */
describe('the mouse', () => {
  const wheelDown = (column = 20, row = 10) => `${ESC}[<65;${column};${row}M`;
  const wheelUp = (column = 20, row = 10) => `${ESC}[<64;${column};${row}M`;
  const click = (column: number, row: number) => `${ESC}[<0;${column};${row}M`;

  /** One file, one hunk, forty lines — taller than the pane, so it scrolls. */
  const scrollable: MeatResult = {
    summary: 'A large change.',
    files: [{
      file: {
        path: 'src/big.ts', oldPath: null, status: 'modified', similarity: null,
        hunks: [], additions: 40, deletions: 0,
      },
      dropped: null,
      hunks: [{
        hunk: {
          header: '@@ -1,40 +1,40 @@', section: '',
          oldStart: 1, oldLines: 40, newStart: 1, newLines: 40,
          lines: Array.from({ length: 40 }, (_, i) => ({
            kind: 'add' as const, text: `line ${i}`,
            oldLine: null, newLine: i + 1, noNewlineAtEof: false,
          })),
        },
        keep: true, reason: 'meaningful', source: 'model' as const,
      }],
    }],
    keptLines: 40, totalLines: 40, keptFiles: 1, totalFiles: 1,
    unclassified: 0,
  };

  test('turns reporting on while it owns the terminal', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    // SGR specifically: the original encoding cannot address past column 223,
    // and these terminals are wider than that.
    expect(app.raw()).toContain('?1006h');
    expect(app.raw()).toContain('?1000h');
  });

  test('turns reporting off again on the way out', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    app.instance.unmount();
    await delay(40);
    // Left on, the reviewer's shell prints `[<0;12;7M` at the prompt on every
    // click and nothing says which program did that to their terminal.
    expect(app.raw()).toContain('?1006l');
    expect(app.raw()).toContain('?1000l');
  });

  test('the wheel scrolls the diff', async () => {
    const app = mount({ pr: detail, meat: scrollable });
    await delay(60);
    expect(app.frame()).toContain('line 0');

    for (let i = 0; i < 4; i += 1) await app.press(wheelDown());
    const after = app.frame();
    expect(after).not.toContain('line 0');
    expect(after).toContain('line 20');
  });

  test('and scrolls it back', async () => {
    const app = mount({ pr: detail, meat: scrollable });
    await delay(60);
    for (let i = 0; i < 4; i += 1) await app.press(wheelDown());
    expect(app.frame()).not.toContain('line 0');

    // Exactly as far back as it came: a fifth notch would repaint nothing, and
    // a frame is only what was repainted since the last key.
    for (let i = 0; i < 4; i += 1) await app.press(wheelUp());
    expect(app.frame()).toContain('line 0');
  });

  test('the wheel at the top of the diff does nothing rather than wrapping', async () => {
    const app = mount({ pr: detail, meat: scrollable });
    await delay(60);
    expect(app.frame()).toContain('line 0');
    // Nothing repainted, which is the strongest available form of "nothing
    // happened" — the view did not move and the cursor did not either.
    await app.press(wheelUp());
    expect(app.frame()).toBe('');
  });

  // The reason a mouse report is taken off the front of the input: left in, it
  // reaches the keymap as a string starting with `[`, which is "previous file".
  test('a report never reaches the keymap as a keystroke', async () => {
    const opened: number[] = [];
    const app = mount({ prs, onOpenPr: (n) => opened.push(n) });
    await delay(60);

    // In the list, a wheel notch moves the selection and nothing else — no
    // filter change, no search, no quit, and no pull request opened. The
    // sequence contains `[`, `<`, digits and `M`, none of which may land.
    await app.press(wheelDown(1, 1));
    const after = app.frame();
    expect(after).toContain('Alpha rendering');
    expect(after).toContain('Gamma parsing');
    expect(after).not.toContain('No match');
    expect(opened).toEqual([]);
  });

  test('a click puts the cursor on the line clicked, and C comments there', async () => {
    const saved: ReviewDraft[] = [];
    const app = mount({ pr: detail, meat: scrollable, onPersist: (d) => saved.push(d) });
    await delay(60);

    // The header is title, meta, summary, gauge, one row of file index, and a
    // blank — six rows — so the diff starts at terminal row 6, zero-based. Rows
    // 0 and 1 of the diff are the file and hunk headers, so `line 3` is diff row
    // 5 and terminal row 11, which the terminal reports as 12.
    await app.press(click(20, 12));
    await app.press('C');
    await app.press('The fourth line.');
    await app.press('\r');
    await delay(40);

    expect(saved.at(-1)?.comments[0]).toMatchObject({
      path: 'src/big.ts', line: 4, body: 'The fourth line.',
    });
  });

  test('a click does not yank the view out from under the click', async () => {
    const app = mount({ pr: detail, meat: scrollable });
    await delay(60);
    const before = app.frame();
    // The row is already on screen; recentring on it would be the pane moving
    // for no reason the reviewer asked for.
    await app.press(click(20, 12));
    expect(app.frame()).toContain('line 3');
    expect(before).toContain('line 3');
  });

  test('a click on the header above the diff leaves the cursor alone', async () => {
    const saved: ReviewDraft[] = [];
    const app = mount({ pr: detail, meat: scrollable, onPersist: (d) => saved.push(d) });
    await delay(60);

    // Aim at `line 3`, then click the title row and the gauge row. Neither is a
    // row of the diff, so the comment must still land where the cursor was put.
    await app.press(click(20, 12));
    await app.press(click(20, 1));
    await app.press(click(20, 4));
    await app.press('C');
    await app.press('Still the fourth line.');
    await app.press('\r');
    await delay(40);

    expect(saved.at(-1)?.comments[0]).toMatchObject({ line: 4 });
  });

  test('a click on the file index jumps to that file', async () => {
    // Two files, so the index has a second cell to click.
    const twoFiles: MeatResult = {
      ...scrollable,
      files: [scrollable.files[0]!, meatFile],
      keptFiles: 2, totalFiles: 2,
    };
    const app = mount({ pr: detail, meat: twoFiles });
    await delay(60);
    expect(app.frame()).toContain('line 0');

    // Labels are `big.ts` and `cache.ts`, so cells are 8 + 3 + 2 = 13 wide from
    // the pane's own column 1. The second cell starts at column 14, reported 15.
    // The index sits on terminal row 4, reported 5.
    await app.press(click(15, 5));
    const after = app.frame();
    // The view moved off the first file and onto the second.
    expect(after).toContain('src/cache.ts');
    expect(after).not.toContain('line 0');
  });

  test('in the list, the wheel moves the selection and a second click opens', async () => {
    const opened: number[] = [];
    const app = mount({ onOpenPr: (n) => opened.push(n) });
    await delay(60);

    // The list pane's chrome is the filter line and a blank, so the first entry
    // starts at terminal row 2 and the second at row 5, reported 6.
    await app.press(click(5, 6));
    expect(opened).toEqual([]);

    // Clicking the entry already selected is the commit. One click to aim and
    // one to fire, so a stray click cannot spend a minute fetching a diff.
    await app.press(click(5, 6));
    expect(opened).toEqual([42]);
  });

  test('a click on the list pane chrome selects nothing', async () => {
    const opened: number[] = [];
    const app = mount({ onOpenPr: (n) => opened.push(n) });
    await delay(60);
    await app.press(click(5, 1));
    await app.press(click(5, 1));
    expect(opened).toEqual([]);
  });

  test('a right click and a release are ignored, not treated as a left click', async () => {
    const opened: number[] = [];
    const app = mount({ onOpenPr: (n) => opened.push(n) });
    await delay(60);
    await app.press(`${ESC}[<2;5;3M`);
    await app.press(`${ESC}[<0;5;3m`);
    await app.press(`${ESC}[<0;5;3m`);
    expect(opened).toEqual([]);
  });
});

describe('the help overlay', () => {
  test('opens grouped, and j scrolls to what did not fit', async () => {
    const app = mount();
    await app.press('?');
    const first = app.frame();
    expect(first).toContain('move');
    expect(first).toContain('read the diff');

    // A hundred columns fits one column of bindings, which is taller than the
    // thirty rows this terminal has, so the rest is below the fold.
    expect(first).toMatch(/1–\d+ of \d+/);

    await app.press('j');
    expect(app.frame()).toMatch(/2–\d+ of \d+/);
  });

  test('documents the mouse, which nobody would otherwise try', async () => {
    const app = mount();
    await app.press('?');
    expect(app.frame()).toContain('scroll the diff');
  });

  test('reopens at the top rather than where it was left', async () => {
    const app = mount();
    await app.press('?');
    await app.press('j');
    await app.press('j');
    expect(app.frame()).toMatch(/3–\d+ of \d+/);

    await app.press(ESC);
    await app.press('?');
    expect(app.frame()).toMatch(/1–\d+ of \d+/);
  });

  test('q closes it rather than quitting the program', async () => {
    const app = mount();
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });
    await app.press('?');
    await app.press('q');
    await delay(40);
    expect(exited).toBe(false);
    expect(app.frame()).toContain('Alpha rendering');
  });
});
