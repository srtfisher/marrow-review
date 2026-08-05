import { test, expect, describe } from 'bun:test';
import {
  enterAlternateScreen, restoreOnExit, type AlternateScreen, type ScreenStream,
} from '../../src/tui/screen.js';

function fakeStream(isTTY: boolean): ScreenStream & { written: string } {
  return {
    isTTY,
    written: '',
    write(data: string) {
      this.written += data;
      return true;
    },
  };
}

function fakeTarget() {
  const handlers = new Map<string, () => void>();
  const exits: number[] = [];
  return {
    handlers,
    exits,
    on(event: string, listener: () => void) {
      handlers.set(event, listener);
    },
    exit(code: number) {
      exits.push(code);
    },
  };
}

describe('enterAlternateScreen', () => {
  test('switches buffer, clears it, and hides the cursor', () => {
    const stream = fakeStream(true);
    enterAlternateScreen(stream);
    expect(stream.written).toBe('\u001B[?1049h\u001B[2J\u001B[H\u001B[?25l');
  });

  // The switch alone is not enough: a terminal with the alternate screen
  // disabled swallows it, and the previous scrollback then shows behind the UI.
  test('clears whether or not the switch is honoured', () => {
    const stream = fakeStream(true);
    enterAlternateScreen(stream);
    expect(stream.written).toContain('\u001B[2J');
  });

  test('leaving restores the cursor and the primary buffer', () => {
    const stream = fakeStream(true);
    const screen = enterAlternateScreen(stream);
    stream.written = '';
    screen.leave();
    expect(stream.written).toBe('\u001B[?25h\u001B[?1049l');
  });

  test('leaving twice writes nothing the second time', () => {
    const stream = fakeStream(true);
    const screen = enterAlternateScreen(stream);
    screen.leave();
    stream.written = '';
    screen.leave();
    expect(stream.written).toBe('');
  });

  // `--dry-run`, `--help`, and any piped invocation must stay plain stdout.
  test('writes nothing at all when stdout is not a terminal', () => {
    const stream = fakeStream(false);
    const screen = enterAlternateScreen(stream);
    screen.leave();
    expect(stream.written).toBe('');
  });

  // `leave` runs from an exit hook, by which point the stream may be destroyed.
  // A throw there would take the restore down with it and strand the terminal.
  test('leaving survives a stream that is already torn down', () => {
    let entered = false;
    const dying: ScreenStream = {
      isTTY: true,
      write() {
        if (entered) throw new Error('EPIPE');
        entered = true;
        return true;
      },
    };
    const screen: AlternateScreen = enterAlternateScreen(dying);
    expect(() => screen.leave()).not.toThrow();
  });
});

describe('restoreOnExit', () => {
  test('restores on a normal exit', () => {
    const target = fakeTarget();
    let left = 0;
    restoreOnExit({ leave: () => { left += 1; } }, target);
    target.handlers.get('exit')!();
    expect(left).toBe(1);
  });

  test('restores and then terminates on each signal', () => {
    const target = fakeTarget();
    let left = 0;
    restoreOnExit({ leave: () => { left += 1; } }, target);

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      expect(target.handlers.has(signal)).toBe(true);
      target.handlers.get(signal)!();
    }
    expect(left).toBe(3);
    // 128 plus the signal number, as a shell reports them.
    expect(target.exits).toEqual([130, 143, 129]);
  });
});
