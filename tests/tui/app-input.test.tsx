import { test, expect, describe, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { render, type Instance } from 'ink';
import { App } from '../../src/tui/App.js';
import type { PullRequestSummary } from '../../src/core/github/types.js';

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
