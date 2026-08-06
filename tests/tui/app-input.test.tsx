import { test, expect, describe, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { render, type Instance } from 'ink';
import { App } from '../../src/tui/App.js';
import { FakeTransport } from '../../src/core/agent/fake.js';
import { findingId } from '../../src/core/findings/find.js';
import type { PullRequestDetail, PullRequestSummary } from '../../src/core/github/types.js';
import type { MeatFile, MeatResult } from '../../src/core/meat/index.js';
import { loadSteps } from '../../src/tui/progress.js';
import type { RawFinding } from '../../src/core/findings/types.js';
import type { ReviewDraft, Verdict } from '../../src/core/review/types.js';

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
  /** Swaps in new props on the live instance, the way the real container
   *  updates `pr`/`meat` once a fetch resolves — state that lives in `App`
   *  itself (the picker's cursor, the query) carries over, unlike a fresh
   *  `mount()`. */
  rerender: (props?: Partial<Parameters<typeof App>[0]>) => Promise<void>;
  frame: () => string;
  /** Everything written since the last key, escapes and all. */
  raw: () => string;
  instance: Instance;
}

function mount(props: Partial<Parameters<typeof App>[0]> = {}): Harness {
  const stdin = fakeStdin();
  const stdout = fakeStdout();

  const build = (p: Partial<Parameters<typeof App>[0]>) => (
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
      {...p}
    />
  );

  const instance = render(
    build(props),
    {
      stdin: stdin as never,
      stdout: stdout as never,
      patchConsole: false,
      exitOnCtrlC: false,
      // Ink throttles writes to thirty frames a second, so a key that renders
      // twice — new rows, then the effects that put the cursor back where it
      // belongs — has its second frame held for thirty-four milliseconds. A
      // test that read the frame before then saw the intermediate state and
      // reported it as the app's answer. Nothing here is watching an
      // animation; take the frames as they come.
      maxFps: 1000,
    },
  );
  live = instance;

  // Ink splits one frame across several writes, bracketed by the terminal's
  // synchronized-output markers. That bracket is what tells one frame from the
  // next, and it has to: a key can repaint twice, and joining both repaints
  // into one string put the intermediate state — the cursor before the effects
  // moved it — into every `not.toContain` in this file.
  const SYNC_BEGIN = '[?2026h';
  let mark = 0;

  /**
   * Waits for the repaint an interaction causes to finish.
   *
   * This used to be a flat 40ms after every key, and 40ms is a bet on how busy
   * the machine is. Ink splits one frame across several writes and renders
   * again when effects settle, so under load the assertion read a frame that
   * was empty or half drawn and the test failed for reasons the app had
   * nothing to do with — whichever test happened to be unlucky that run.
   *
   * Three quiet polls, not one: an interaction that changes the row list
   * repaints twice, once for the new rows and once when the effects that put
   * the cursor back where it belongs land, and returning at the first pause
   * handed the test the half-finished state. The ceilings stop an interaction
   * that renders nothing from costing the suite half a second.
   */
  async function settle() {
    const start = Date.now();
    let seen = -1;
    let quiet = 0;
    for (;;) {
      await delay(10);
      const written = stdout.frames.length;
      const elapsed = Date.now() - start;
      quiet = written === seen ? quiet + 1 : 0;
      seen = written;
      if (written > mark && quiet >= 3) break;
      if (written === mark && elapsed > 150) break;
      if (elapsed > 800) break;
    }
  }

  return {
    instance,
    async press(keys: string) {
      mark = stdout.frames.length;
      stdin.write(keys);
      await settle();
    },
    frame: () => {
      const written = stdout.frames.slice(mark).join('');
      const at = written.lastIndexOf(SYNC_BEGIN);
      const latest = at === -1 ? written : written.slice(at);
      return latest.replaceAll(/\[[\d;?]*[a-zA-Z]/g, '');
    },
    raw: () => stdout.frames.join(''),
    async rerender(nextProps: Partial<Parameters<typeof App>[0]> = {}) {
      mark = stdout.frames.length;
      instance.rerender(build(nextProps));
      await settle();
    },
  };
}

/** Arrow down. The picker has no `j` — every letter it sees is query text. */
const DOWN = '\x1b[B';

describe('App key handling', () => {
  test('typing narrows the list live and says how much of it is left', async () => {
    const app = mount();
    await app.press('caching');
    expect(app.frame()).toContain('Beta caching');
    expect(app.frame()).not.toContain('Alpha rendering');
    // The header counts what survived out of what there was, so a narrowed list
    // cannot be mistaken for a repository with one pull request in it.
    expect(app.frame()).toContain('1 of 3');
  });

  test('enter opens the pull request the filtered list is pointing at', async () => {
    const opened: number[] = [];
    const app = mount({ onOpenPr: (n) => opened.push(n) });

    // Move to the third entry, then narrow so only the second survives. The
    // cursor must follow the filtered array, not the index it held before.
    // One key per press: Ink delivers a multi-character write as one event, so
    // two arrows in one write moved nothing and this test passed without testing.
    await app.press(DOWN);
    await app.press(DOWN);
    await app.press('caching');
    await app.press('\r');

    expect(opened).toEqual([42]);
  });

  test('a query that matches nothing says so and opens nothing', async () => {
    const opened: number[] = [];
    const app = mount({ onOpenPr: (n) => opened.push(n) });
    await app.press('zzzz');
    expect(app.frame().toLowerCase()).toContain('no match');

    // Enter must not fall back to some stale index; with nothing matched there
    // is nothing to open.
    await app.press('\r');
    expect(opened).toEqual([]);
  });

  test('? is query text rather than the way into help', async () => {
    const app = mount();
    await app.press('?');
    // A help binding would be a key the reviewer cannot type here, so the hint
    // bar carries the whole key list instead and `?` narrows like any letter.
    expect(app.frame()).not.toContain('next / previous file');
    expect(app.frame().toLowerCase()).toContain('no match');
  });

  test('esc exits when there is nothing behind the picker to go back to', async () => {
    const app = mount();
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });
    await app.press('\x1b');
    await delay(40);
    expect(exited).toBe(true);
  });

  test('q types rather than quitting, since the picker owns the letters', async () => {
    const app = mount();
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });
    await app.press('q');
    await delay(40);
    expect(exited).toBe(false);
    expect(app.frame().toLowerCase()).toContain('no match');
  });
});

describe('the picker is search-first', () => {
  test('typing narrows the list and backspace restores it', async () => {
    const app = mount();
    await app.press('beta');
    expect(app.frame()).toContain('#42');
    expect(app.frame()).not.toContain('#41');

    // One backspace per press: four in a single write is a chunk Ink hands over
    // as literal text, not four keystrokes.
    for (let i = 0; i < 4; i += 1) await app.press('\x7f');
    expect(app.frame()).toContain('#41');
  });

  test('digits are query text, not filter switches', async () => {
    const chosen: string[] = [];
    const app = mount({ onFilter: (f) => chosen.push(f) });
    await app.press('42');
    expect(chosen).toEqual([]);
    expect(app.frame()).toContain('#42');
    expect(app.frame()).not.toContain('#41');
  });

  test('tab cycles the server-side filter', async () => {
    const chosen: string[] = [];
    const app = mount({ onFilter: (f) => chosen.push(f) });
    await app.press('\t');
    expect(chosen).toEqual(['review-requested']);
  });

  test('and comes back round to open from the last of them', async () => {
    const chosen: string[] = [];
    const app = mount({ filter: 'all', onFilter: (f) => chosen.push(f) });
    await app.press('\t');
    expect(chosen).toEqual(['open']);
  });

  test('ctrl-r refetches while r merely types', async () => {
    let refreshed = 0;
    const app = mount({ onRefresh: () => { refreshed += 1; } });
    await app.press('r');
    expect(refreshed).toBe(0);

    await app.press('\x12');
    expect(refreshed).toBe(1);
  });

  test('esc clears the query before it means anything else', async () => {
    const app = mount();
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });

    await app.press('beta');
    await app.press('\x1b');
    expect(app.frame()).toContain('#41');
    // The first esc spent itself on the query, not on the program.
    expect(exited).toBe(false);
  });

  test('the space bar types a space, so a two-word query is possible', async () => {
    const app = mount();
    await app.press('beta');
    await app.press(' ');
    await app.press('cach');
    expect(app.frame()).toContain('#42');
    expect(app.frame()).not.toContain('#43');
  });

  test('ctrl-n and ctrl-p move the selection, since the arrows are a reach', async () => {
    const opened: number[] = [];
    const app = mount({ onOpenPr: (n) => opened.push(n) });
    await app.press('\x0e');
    await app.press('\x0e');
    await app.press('\x10');
    await app.press('\r');
    expect(opened).toEqual([42]);
  });

  test('the keyboard does nothing while a pull request is loading, the same guard as the mouse', async () => {
    const opened: number[] = [];
    const app = mount({
      onOpenPr: (n) => opened.push(n),
      progress: { prNumber: 41, steps: loadSteps() },
    });
    await delay(60);

    // Enter would otherwise call onOpenPr a second time on the fetch already
    // under way — the double-open race the guard exists to prevent. The arrow
    // would move a selection the loading steps have covered, and typing would
    // edit a filter line nobody can see. Esc is swallowed too rather than
    // carved out: the load resolves into detail on its own.
    await app.press(DOWN);
    expect(app.frame()).toBe('');
    await app.press('\r');
    expect(opened).toEqual([]);
    await app.press('x');
    expect(app.frame()).toBe('');
    await app.press('\x1b');
    expect(app.frame()).toBe('');
  });
});

describe('the app frames every screen', () => {
  test('the picker is full screen with the chrome row on top', async () => {
    const app = mount();
    await delay(40);
    expect(app.frame()).toContain('marrow · octocat/marrow · open');
    expect(app.frame()).toContain('filter ›');
    expect(app.frame()).toContain('❯ #41 Alpha rendering');
  });

  test('a null list renders the launch frame rather than an empty picker', async () => {
    const app = mount({ prs: null });
    await delay(40);
    expect(app.frame()).toContain('fetching open pull requests…');
    // No filter input exists yet, so there is nothing to type into and nothing
    // that could be mistaken for a repository with no pull requests in it.
    expect(app.frame()).not.toContain('filter ›');
    expect(app.frame()).not.toContain('No pull requests');
  });

  test('typing on the launch frame is not a query', async () => {
    const app = mount({ prs: null });
    await app.press('beta');
    expect(app.frame()).not.toContain('filter ›');
  });

  test('a list error offers retry, and r takes it', async () => {
    let refreshed = 0;
    const app = mount({
      prs: null, listError: 'gh: could not reach github.com',
      onRefresh: () => { refreshed += 1; },
    });
    await delay(40);
    expect(app.frame()).toContain('could not reach github.com');
    expect(app.frame()).toContain('r retry · q quit');

    await app.press('r');
    expect(refreshed).toBe(1);
  });

  test('r on the launch frame does nothing while the fetch is still out', async () => {
    let refreshed = 0;
    const app = mount({ prs: null, onRefresh: () => { refreshed += 1; } });
    await app.press('r');
    expect(refreshed).toBe(0);
  });

  test('q on the launch frame quits', async () => {
    const app = mount({ prs: null });
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });
    await app.press('q');
    await delay(40);
    expect(exited).toBe(true);
  });

  /**
   * The route in: open a pull request (mode starts `detail`), then leave to
   * the picker while the list is still null — a refetch still out, or one
   * that failed. Task 8 puts a leave-confirm between `esc` and the picker
   * even here, so it has to be answered before the launch frame is reached.
   */
  async function mountWarmOnLaunchFrame(
    props: Partial<Parameters<typeof App>[0]> = {},
  ): Promise<Harness> {
    const app = mount({ prs: null, pr: detail, meat, ...props });
    await app.press(ESC); // leave to the picker
    await app.press('\r'); // confirm the leave
    return app;
  }

  test('esc on the launch frame returns to the warm review behind it, not the terminal', async () => {
    const app = await mountWarmOnLaunchFrame();
    expect(app.frame()).toContain('fetching open pull requests…');

    await app.press(ESC);
    // Back in the detail pane: the gauge line only the review header prints.
    expect(app.frame()).toContain('kept 1/2');
  });

  test('q on the launch frame with a warm review but no unsubmitted work quits directly', async () => {
    const app = await mountWarmOnLaunchFrame();
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });

    await app.press('q');
    await delay(40);
    expect(exited).toBe(true);
  });

  test('q on the launch frame with unsubmitted work asks before quitting', async () => {
    const app = await mountWarmOnLaunchFrame({
      initialDraft: { verdict: null, body: 'looks fine but', comments: [] },
    });
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });

    await app.press('q');
    expect(exited).toBe(false);
    // The confirm text, not just the absence of exit: a state change with
    // nothing on screen is indistinguishable from a swallowed key.
    expect(app.frame()).toContain('unsubmitted comment(s)');

    // The same confirm the picker's esc reaches, not a bare exit: x still
    // discards and quits, proving the key landed in the quit-confirm state
    // rather than being swallowed by the launch frame's own guard.
    await app.press('x');
    await delay(40);
    expect(exited).toBe(true);
  });

  test('the chrome names the warm review once the picker is back on top', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    // Not in the review itself: the title block two rows down already says it.
    expect(app.frame()).not.toContain('reviewing #42');

    await app.press(ESC);
    await app.press('\r'); // confirm the leave
    expect(app.frame()).toContain('reviewing #42');
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
  keptAdditions: 1, keptDeletions: 0, totalAdditions: 2, totalDeletions: 0,
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

  test('the header counts the findings the pass produced', async () => {
    const app = mount({ pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree' });
    await delay(80);
    expect(app.frame()).toContain('1 finding');
  });

  test('the header says so when the pass produced none', async () => {
    const transport = new FakeTransport();
    transport.queue({ structured: { findings: [] } });
    const app = mount({ pr: detail, meat, transport, cwd: '/tmp/worktree' });
    await delay(80);

    // The state that used to be silent, and so was indistinguishable from the
    // pass never having run at all.
    expect(app.frame()).toContain('no findings');
  });

  test('the hint bar offers the way to a finding once one exists', async () => {
    const app = mount({ pr: detail, meat, transport: findingTransport(), cwd: '/tmp/worktree' });
    expect(app.frame()).not.toMatch(/n\s+(next )?finding/);

    await delay(80);
    expect(app.frame()).toMatch(/n\s+(next )?finding/);
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

  // The author of a pull request can only comment on it. Cycling used to skip
  // APPROVE but stop on REQUEST_CHANGES, which GitHub rejects just as hard.
  test('the author cannot cycle onto a verdict GitHub will reject', async () => {
    const verdicts: Verdict[] = [];
    const app = mount({
      pr: { ...detail, viewerIsAuthor: true }, meat, transport: findingTransport(),
      cwd: '/tmp/worktree', onSubmit: (_draft, verdict) => verdicts.push(verdict),
    });
    await delay(80);

    await app.press('n');
    await app.press('a');
    await app.press('!');
    for (const key of ['j', 'j', 'k']) await app.press(key);
    await app.press('\r');

    expect(verdicts).toEqual(['COMMENT']);
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
  keptAdditions: 2, keptDeletions: 0, totalAdditions: 4, totalDeletions: 0,
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
    keptAdditions: 144, keptDeletions: 0, totalAdditions: 144, totalDeletions: 0,
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

    await app.press('c');
    await app.press('Needs a test.');
    await app.press(SAVE);
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

    await app.press('c');
    await app.press('Needs a test.');
    await app.press(SAVE);
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

    await app.press('c');
    await app.press('Needs a test.');
    await app.press(SAVE);
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

    await app.press('c');
    await app.press('Needs a test.');
    await app.press(SAVE);
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
    await app.press('c');
    await app.press('This needs a test.');
    await app.press(SAVE);
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
    keptAdditions: 202, keptDeletions: 0, totalAdditions: 204, totalDeletions: 0,
    unclassified: 0,
  };

  test('fills the pane with the diff instead of one file header', async () => {
    const app = mount({ pr: detail, meat: tall });
    await delay(60);
    const frame = app.frame();

    expect(frame).toContain('docs/design.md');
    expect(frame).toContain('paragraph 0');
    // Eighteen rows deep into the hunk, which is the bottom of the pane on this
    // terminal. Under the old whole-unit windowing the hunk did not fit, so the
    // pane showed the file header and nothing else.
    expect(frame).toContain('paragraph 17');
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

  test('the picker gives way to the diff once a pull request is open', async () => {
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
  test('c anchors to the line under the cursor, not to the hunk', async () => {
    const saved: ReviewDraft[] = [];
    const app = mount({ pr: detail, meat, onPersist: (d) => saved.push(d) });
    await delay(60);

    // Rows: file header, hunk header, the context line, the added line. Stop on
    // the context line — line 1, where the hunk's own anchor would be line 2.
    await app.press('j');
    await app.press('j');
    await app.press('c');
    await app.press('Is the TTL right?');
    await app.press(SAVE);
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
    await app.press('c');
    await app.press('This is the one.');
    await app.press(SAVE);
    await delay(40);

    expect(saved.at(-1)?.comments[0]).toMatchObject({ line: 2, side: 'RIGHT' });
  });
});

describe('esc comes back out of the diff', () => {
  test('the picker returns and the list takes the cursor again', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    // Reviewing: the diff owns the terminal.
    expect(app.frame()).not.toContain('Alpha rendering');

    await app.press(ESC);
    await app.press('\r'); // confirm the leave
    // Keying the picker on "a pull request is loaded" rather than on the mode
    // left it hidden here, and esc looked like a dead key.
    expect(app.frame()).toContain('Alpha rendering');
    expect(app.frame()).toContain('Gamma parsing');
  });

  test('and the hint bar goes back to the picker verbs, naming the way back in', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    expect(app.frame()).toContain('comment on this line');

    await app.press(ESC);
    await app.press('\r'); // confirm the leave
    expect(app.frame()).toContain('filter');
    // The review is still loaded, and esc is how you get back to it. Nothing
    // else on screen says that, so the bar has to.
    expect(app.frame()).toContain('back to #42');
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
    keptAdditions: 40, keptDeletions: 0, totalAdditions: 40, totalDeletions: 0,
    unclassified: 0,
  };

  test('turns reporting on while it owns the terminal', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    // SGR specifically: the original encoding cannot address past column 223,
    // and these terminals are wider than that.
    expect(app.raw()).toContain('?1006h');
    // Button-event tracking, so a held button reports motion and a drag can
    // sweep a range of lines.
    expect(app.raw()).toContain('?1002h');
  });

  test('turns reporting off again on the way out', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    app.instance.unmount();
    await delay(40);
    // Left on, the reviewer's shell prints `[<0;12;7M` at the prompt on every
    // click and nothing says which program did that to their terminal.
    expect(app.raw()).toContain('?1006l');
    expect(app.raw()).toContain('?1002l');
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

  test('a click puts the cursor on the line clicked, and c comments there', async () => {
    const saved: ReviewDraft[] = [];
    const app = mount({ pr: detail, meat: scrollable, onPersist: (d) => saved.push(d) });
    await delay(60);

    // The chrome row and its rule take the first two rows. The header under
    // them is title, meta, summary, gauge, one row of file index, and a blank —
    // six rows — so the diff starts at terminal row 8, zero-based. Rows 0 and 1
    // of the diff are the file and hunk headers, so `line 3` is diff row 5 and
    // terminal row 13, which the terminal reports as 14.
    await app.press(click(20, 14));
    await app.press('c');
    await app.press('The fourth line.');
    await app.press(SAVE);
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
    await app.press(click(20, 14));
    expect(app.frame()).toContain('line 3');
    expect(before).toContain('line 3');
  });

  test('a click on the header above the diff leaves the cursor alone', async () => {
    const saved: ReviewDraft[] = [];
    const app = mount({ pr: detail, meat: scrollable, onPersist: (d) => saved.push(d) });
    await delay(60);

    // Aim at `line 3`, then click the chrome row, the title row, and the gauge
    // row. None is a row of the diff, so the comment must still land where the
    // cursor was put.
    await app.press(click(20, 14));
    await app.press(click(20, 1));
    await app.press(click(20, 3));
    await app.press(click(20, 6));
    await app.press('c');
    await app.press('Still the fourth line.');
    await app.press(SAVE);
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
    // The index sits two rows below the chrome, on terminal row 6, reported 7.
    await app.press(click(15, 7));
    const after = app.frame();
    // The view moved off the first file and onto the second — and landed on its
    // header, not on the blank above it, which draws no cursor at all.
    expect(after).toContain('▸ ▍ src/cache.ts');
    expect(after).not.toContain('line 0');
  });

  test('in the picker, the wheel moves the selection and a second click opens', async () => {
    const opened: number[] = [];
    const app = mount({ onOpenPr: (n) => opened.push(n) });
    await delay(60);

    // Above the entries: the chrome row and its rule, the banner block, the
    // filter line and a blank — nine rows — so the first entry starts at
    // terminal row 9 and, these titles fitting one row each, the second at row
    // 12, reported 13.
    await app.press(click(5, 13));
    expect(opened).toEqual([]);

    // Clicking the entry already selected is the commit. One click to aim and
    // one to fire, so a stray click cannot spend a minute fetching a diff.
    await app.press(click(5, 13));
    expect(opened).toEqual([42]);
  });

  test('a click on the picker chrome selects nothing', async () => {
    const opened: number[] = [];
    const app = mount({ onOpenPr: (n) => opened.push(n) });
    await delay(60);

    // The filter line, then the blank row between the first two entries. The
    // first entry is the one already selected, so a hit on either would open it.
    await app.press(click(5, 8));
    await app.press(click(5, 8));
    await app.press(click(5, 12));
    await app.press(click(5, 12));
    expect(opened).toEqual([]);
  });

  test('a click while a pull request is loading aims at nothing', async () => {
    const opened: number[] = [];
    const app = mount({
      onOpenPr: (n) => opened.push(n),
      progress: { prNumber: 41, steps: loadSteps() },
    });
    await delay(60);

    // The steps replace the entry region, so the row the first entry occupied is
    // no longer that entry — and it is the one the cursor is already on, which a
    // hit would open.
    await app.press(click(5, 10));
    await app.press(click(5, 10));
    expect(opened).toEqual([]);
  });

  test('a wheel notch while a pull request is loading moves nothing', async () => {
    const app = mount({ progress: { prNumber: 41, steps: loadSteps() } });
    await delay(60);

    // The steps occupy the entry region, so there is no visible selection for
    // the notch to move — scrolling here would change a cursor nobody can see.
    // Nothing repainted is the strongest available form of "nothing happened".
    await app.press(wheelDown(5, 10));
    expect(app.frame()).toBe('');
  });

  test('a right click and a release are ignored, not treated as a left click', async () => {
    const opened: number[] = [];
    const app = mount({ onOpenPr: (n) => opened.push(n) });
    await delay(60);
    // Aimed at the entry already selected, which a left press would open.
    await app.press(`${ESC}[<2;5;10M`);
    await app.press(`${ESC}[<0;5;10m`);
    await app.press(`${ESC}[<0;5;10m`);
    expect(opened).toEqual([]);
  });
});

/**
 * Opened from the diff, which is the only place `?` is a key: in the picker
 * every printable character is query text, so the overlay is reached from a
 * review rather than from the list of them.
 */
describe('the help overlay', () => {
  test('opens grouped, and j scrolls to what did not fit', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
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
    const app = mount({ pr: detail, meat });
    await delay(60);
    await app.press('?');
    expect(app.frame()).toContain('scroll the diff');
  });

  test('reopens at the top rather than where it was left', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    await app.press('?');
    await app.press('j');
    await app.press('j');
    expect(app.frame()).toMatch(/3–\d+ of \d+/);

    await app.press(ESC);
    await app.press('?');
    expect(app.frame()).toMatch(/1–\d+ of \d+/);
  });

  test('q closes it rather than quitting the program', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    let exited = false;
    void app.instance.waitUntilExit().then(() => {
      exited = true;
    });
    await app.press('?');
    await app.press('q');
    await delay(40);
    expect(exited).toBe(false);
    // Back onto the diff it was opened from, not out of the program.
    expect(app.frame()).toContain('cache.set(key, value);');
  });
});

/** ctrl-d. Not ctrl-s, which is XOFF and freezes a terminal that still has it. */
const SAVE = '\x04';

describe('selecting a range of lines', () => {
  test('V then j comments on the range, not on the line', async () => {
    const saved: ReviewDraft[] = [];
    const app = mount({ pr: detail, meat, onPersist: (d) => saved.push(d) });
    await delay(60);

    // Rows: file header, hunk header, the context line (R1), the added line (R2).
    await app.press('j');
    await app.press('j');
    await app.press('V');
    await app.press('j');
    await app.press('c');

    expect(app.frame()).toContain('Comment on lines R1 to R2');

    await app.press('Both of these.');
    await app.press(SAVE);
    await delay(40);

    expect(saved.at(-1)?.comments[0]).toMatchObject({
      line: 2, startLine: 1, side: 'RIGHT', body: 'Both of these.',
    });
  });

  test('esc clears the selection and stays in the diff', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);

    await app.press('j');
    await app.press('j');
    await app.press('V');
    await app.press('j');
    await app.press(ESC);
    await app.press('c');

    // One line again, so esc undid the selection rather than leaving the diff.
    expect(app.frame()).toContain('Comment on line R2');
    expect(app.frame()).not.toContain('Alpha rendering');
  });
});

describe('the inline composer', () => {
  test('names the one line it is anchored to', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    await app.press('j');
    await app.press('j');
    await app.press('c');

    expect(app.frame()).toContain('Comment on line R1');
  });

  test('keeps the diff on screen while you write in it', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    await app.press('j');
    await app.press('j');
    await app.press('c');

    // The whole point of moving out of a full-screen editor: the code you are
    // commenting on is still in front of you.
    expect(app.frame()).toContain('cache.set(key, value);');
    expect(app.frame()).toContain('Beta caching');
  });

  test('s pre-fills a suggestion with the line it would replace', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    await app.press('j');
    await app.press('j');
    await app.press('j');
    await app.press('s');

    expect(app.frame()).toContain('```suggestion');
    expect(app.frame()).toContain('cache.set(key, value);');
  });

  test('a suggestion is submitted as the fence, verbatim', async () => {
    const submitted: ReviewDraft[] = [];
    const app = mount({
      pr: detail, meat, onSubmit: (draft) => submitted.push(draft),
    });
    await delay(60);

    await app.press('j');
    await app.press('j');
    await app.press('j');
    await app.press('s');
    await app.press(SAVE);
    await app.press('!');
    await app.press('\r');
    await delay(40);

    expect(submitted[0]?.comments[0]?.body).toContain('```suggestion');
    expect(submitted[0]?.comments[0]?.body).toContain('cache.set(key, value);');
  });

  test('enter inserts a newline rather than saving', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    await app.press('j');
    await app.press('j');
    await app.press('c');
    await app.press('first');
    await app.press('\r');
    await app.press('second');

    expect(app.frame()).toContain('first');
    expect(app.frame()).toContain('second');
    // Still composing, so nothing has been staged.
    expect(app.frame()).not.toContain('1 staged');
  });

  test('esc throws away what was typed', async () => {
    const app = mount({ pr: detail, meat });
    await delay(60);
    await app.press('j');
    await app.press('j');
    await app.press('c');
    await app.press('never mind');
    await app.press(ESC);

    expect(app.frame()).not.toContain('1 staged');
    expect(app.frame()).not.toContain('never mind');
  });
});

describe('a staged comment lives in the diff', () => {
  async function stage() {
    const app = mount({ pr: detail, meat });
    await delay(60);
    await app.press('j');
    await app.press('j');
    await app.press('c');
    await app.press('Is the TTL right?');
    await app.press(SAVE);
    return app;
  }

  test('stays under the line it is about once saved', async () => {
    const app = await stage();
    expect(app.frame()).toContain('Is the TTL right?');
    expect(app.frame()).toContain('R1');
    expect(app.frame()).toContain('1 staged');
  });

  test('x on it takes it back', async () => {
    const app = await stage();
    await app.press('j');
    await app.press('x');

    expect(app.frame()).not.toContain('Is the TTL right?');
    expect(app.frame()).not.toContain('1 staged');
  });

  test('enter on it reopens it with what you wrote', async () => {
    const app = await stage();
    await app.press('j');
    await app.press('\r');

    expect(app.frame()).toContain('Comment on line R1');
    expect(app.frame()).toContain('Is the TTL right?');
  });
});

describe('sweeping a range with the mouse', () => {
  const click = (column: number, row: number) => `${ESC}[<0;${column};${row}M`;
  const shiftClick = (column: number, row: number) => `${ESC}[<4;${column};${row}M`;
  const drag = (column: number, row: number) => `${ESC}[<32;${column};${row}M`;

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
    keptAdditions: 40, keptDeletions: 0, totalAdditions: 40, totalDeletions: 0,
    unclassified: 0,
  };

  // With the chrome row above the pane, terminal row 14 is `line 3` (new line
  // 4); row 16 is `line 5` (new line 6).
  test('dragging down the gutter selects everything it crossed', async () => {
    const app = mount({ pr: detail, meat: scrollable });
    await delay(60);

    await app.press(click(20, 14));
    await app.press(drag(20, 15));
    await app.press(drag(20, 16));
    await app.press('c');

    expect(app.frame()).toContain('Comment on lines R4 to R6');
  });

  test('shift-click extends from where the cursor already is', async () => {
    const app = mount({ pr: detail, meat: scrollable });
    await delay(60);

    await app.press(click(20, 14));
    await app.press(shiftClick(20, 16));
    await app.press('c');

    expect(app.frame()).toContain('Comment on lines R4 to R6');
  });

  test('a plain click after a selection starts over', async () => {
    const app = mount({ pr: detail, meat: scrollable });
    await delay(60);

    await app.press(click(20, 14));
    await app.press(drag(20, 16));
    await app.press(click(20, 15));
    await app.press('c');

    expect(app.frame()).toContain('Comment on line R5');
  });

  test('double-clicking a line opens the composer on it', async () => {
    const app = mount({ pr: detail, meat: scrollable });
    await delay(60);

    await app.press(click(20, 14));
    await app.press(click(20, 14));

    expect(app.frame()).toContain('Comment on line R4');
  });

  test('two clicks on different lines are two clicks, not a double', async () => {
    const app = mount({ pr: detail, meat: scrollable });
    await delay(60);

    await app.press(click(20, 14));
    await app.press(click(20, 15));

    expect(app.frame()).not.toContain('Comment on line');
  });
});

describe('reading a file through checks it off', () => {
  const DOWN = `${ESC}[B`;

  test('a file earns its check when the cursor reaches its last line', async () => {
    // `markSeen` finds a file's last row to decide it has been read. The blank
    // after a file now carries that file's path, and the cursor cannot land on
    // one — so the last row has to be the last row that is a place.
    const app = mount({ pr: detail, meat: twoFileMeat });
    await delay(60);
    expect(app.frame()).not.toContain('✓ cache.ts');

    for (let i = 0; i < 3; i += 1) await app.press(DOWN);
    expect(app.frame()).toContain('▸✓ cache.ts');
  });
});

/**
 * The reported bug. Pressing down off the end of a file moved the marker in the
 * file index to the next file while the marker in the diff disappeared, because
 * the cursor was sitting on the blank separator — which draws no cursor. The
 * reviewer read that as "it changed the file and jumped me to the top", and the
 * next press as "back down in the tree listing".
 */
describe('the arrows cross a file boundary in one press', () => {
  const DOWN = `${ESC}[B`;
  const UP = `${ESC}[A`;

  test('down off a file last line lands on the next file header', async () => {
    const app = mount({ pr: detail, meat: twoFileMeat });
    await delay(60);

    // 0 header, 1 hunk-header, 2-3 lines. The fourth press leaves the file.
    for (let i = 0; i < 3; i += 1) await app.press(DOWN);
    expect(app.frame()).toMatch(/▸\s+2 \+cache\.set\(key, value\);/);

    await app.press(DOWN);
    expect(app.frame()).toContain('▸ ▍ src/store.ts');
  });

  test('up off a file header lands on the previous file last line', async () => {
    const app = mount({ pr: detail, meat: twoFileMeat });
    await delay(60);

    for (let i = 0; i < 4; i += 1) await app.press(DOWN);
    expect(app.frame()).toContain('▸ ▍ src/store.ts');

    await app.press(UP);
    expect(app.frame()).toMatch(/▸\s+2 \+cache\.set\(key, value\);/);
    expect(app.frame()).not.toContain('▸ ▍ src/store.ts');
  });

  test('] on the last file leaves the cursor where it is', async () => {
    const app = mount({ pr: detail, meat: twoFileMeat });
    await delay(60);

    for (let i = 0; i < 4; i += 1) await app.press(DOWN);
    expect(app.frame()).toContain('▸ ▍ src/store.ts');

    // Nothing moved, so Ink has nothing to repaint and the frame is empty.
    await app.press(']');
    expect(app.frame()).toBe('');

    // Which is also what a swallowed key looks like, so prove where the cursor
    // actually is: one step up from the last file's header is the previous
    // file's last line. Back when `]` fell through to the previous header this
    // landed on `src/cache.ts` instead.
    await app.press(UP);
    expect(app.frame()).toMatch(/▸\s+2 \+cache\.set\(key, value\);/);
  });
});

/**
 * The realistic route into a warm review: the picker's cursor moves onto an
 * entry, then `pr`/`meat` arrive the way they would once `onOpenPr` resolves
 * and the container re-renders — not as initial props. Mounting `pr`/`meat`
 * directly, the way the rest of this file does for tests that only care about
 * the diff, would leave the picker's cursor on whichever entry sits at index
 * 0 (`listCursor` starts at 0 regardless of which pull request is already
 * open), which is not what "the still-selected warm pull request" means
 * below.
 */
async function mountWithOpenPr(
  props: Partial<Parameters<typeof App>[0]> = {},
): Promise<Harness> {
  const app = mount();
  await app.press(DOWN); // #41 -> #42, the entry `detail` and `meat` describe
  await app.rerender({ pr: detail, meat, ...props });
  return app;
}

describe('the warm review', () => {
  test('enter on the warm pull request returns to it without re-opening', async () => {
    const opened: number[] = [];
    const app = await mountWithOpenPr({ onOpenPr: (n) => opened.push(n) });

    await app.press(ESC); // leave to the picker
    await app.press('\r'); // confirm the leave
    await app.press('\r'); // enter on the (still-selected) warm PR

    expect(opened).toEqual([]); // no refetch, no meat re-run
    expect(app.frame()).toContain('kept 1/2'); // the detail header's gauge line
  });

  test('a round trip to the picker keeps the cursor, scroll, and reviewed marks', async () => {
    const app = await mountWithOpenPr();

    // One key per press: a multi-character write arrives as one `input`
    // string, and `resolveAction` matches a move key exactly — a batched
    // "jjjj" matches no binding and moves nothing. Three presses walk this
    // fixture's four rows (file header, hunk header, context, added line) to
    // its last, which also earns the file its reviewed checkmark — state
    // worth proving the round trip keeps.
    await app.press('j');
    await app.press('j');
    await app.press('j');
    const before = app.frame();

    await app.press(ESC); // out to the picker
    await app.press('\r'); // confirm the leave
    expect(app.frame()).toContain('filter ›');

    await app.press(ESC); // straight back in — no confirm on the way in
    expect(app.frame()).toBe(before);
  });

  test('enter on a different pull request replaces the warm one', async () => {
    const opened: number[] = [];
    const app = await mountWithOpenPr({ onOpenPr: (n) => opened.push(n) });

    await app.press(ESC); // leave to the picker
    await app.press('\r'); // confirm the leave
    await app.press(DOWN); // #42 -> #43, a different entry
    await app.press('\r');

    expect(opened).toEqual([43]);
  });
});

describe('leaving the review asks', () => {
  test('esc from the review confirms before the picker appears', async () => {
    const app = await mountWithOpenPr();

    await app.press(ESC);
    expect(app.frame()).toContain('leave this review?');
    expect(app.frame()).not.toContain('filter ›');

    await app.press('\r');
    expect(app.frame()).toContain('filter ›');
  });

  test('esc at the question stays in the review', async () => {
    const app = await mountWithOpenPr();

    await app.press(ESC);
    await app.press(ESC);
    expect(app.frame()).not.toContain('leave this review?');
    expect(app.frame()).toContain('kept');
  });

  test('a stray key at the question does nothing', async () => {
    const app = await mountWithOpenPr();

    await app.press(ESC);
    expect(app.frame()).toContain('leave this review?');

    // Nothing repainted, which is the strongest available form of "nothing
    // happened" — the confirm stayed exactly as it was.
    await app.press('x');
    expect(app.frame()).toBe('');
  });

  test('esc clears a selection before it means leave', async () => {
    const app = await mountWithOpenPr();

    await app.press('V');
    await app.press(ESC);
    expect(app.frame()).not.toContain('leave this review?');
  });

  test('q still routes to the quit confirm, not the leave confirm', async () => {
    const app = await mountWithOpenPr();

    await app.press('c');
    await app.press('hello');
    await app.press(SAVE);
    await app.press('q');

    expect(app.frame()).toContain('unsubmitted comment');
    expect(app.frame()).not.toContain('leave this review?');
  });
});
