import { test, expect, describe } from 'bun:test';
import {
  DIFF_TINT, OSC11_QUERY, canTint, detectTint, padToWidth, parseOsc11, toneFromEnv,
  type TintStdin, type TintStdout,
} from '../../src/tui/tint.js';

describe('parseOsc11', () => {
  test('reads a dark background out of the terminal\'s reply', () => {
    expect(parseOsc11('\u001b]11;rgb:1e1e/1e1e/1e1e')).toBe('dark');
  });

  test('reads a light one', () => {
    expect(parseOsc11('\u001b]11;rgb:ffff/ffff/ffff\u001b\\')).toBe('light');
  });

  // xterm may answer in one to four hex digits per channel, and the digit count
  // is the scale — `f` is full, not 15/65535ths of the way there.
  test('scales a channel by its own width, so f and ffff both mean full', () => {
    expect(parseOsc11('\u001b]11;rgb:f/f/f')).toBe('light');
    expect(parseOsc11('\u001b]11;rgb:ff/ff/ff')).toBe('light');
  });

  // The arithmetic mean calls mid green and mid blue equally bright, and the
  // eye does not: a green terminal wants the light tint and a blue one the dark.
  test('weights the channels for perceived brightness, not their mean', () => {
    expect(parseOsc11('\u001b]11;rgb:0000/dddd/0000')).toBe('light');
    expect(parseOsc11('\u001b]11;rgb:0000/0000/dddd')).toBe('dark');
  });

  test('gives nothing back for a reply that is not one', () => {
    expect(parseOsc11('\u001b]11;?')).toBeNull();
    expect(parseOsc11('')).toBeNull();
    // A keystroke that arrived in the same window is not a background colour.
    expect(parseOsc11('jjjj')).toBeNull();
  });
});

describe('toneFromEnv', () => {
  test('takes the last field of COLORFGBG as the background slot', () => {
    expect(toneFromEnv({ COLORFGBG: '15;0' })).toBe('dark');
    expect(toneFromEnv({ COLORFGBG: '0;15' })).toBe('light');
  });

  // Some terminals emit three fields with the middle one blank or `default`.
  test('survives the three-field form', () => {
    expect(toneFromEnv({ COLORFGBG: '15;default;0' })).toBe('dark');
  });

  test('white and the bright half are light, the rest dark', () => {
    expect(toneFromEnv({ COLORFGBG: ';7' })).toBe('light');
    expect(toneFromEnv({ COLORFGBG: ';6' })).toBe('dark');
    expect(toneFromEnv({ COLORFGBG: ';9' })).toBe('light');
  });

  test('gives nothing back when it is unset or not a number', () => {
    expect(toneFromEnv({})).toBeNull();
    expect(toneFromEnv({ COLORFGBG: 'default;default' })).toBeNull();
  });
});

// Below 256 colours the value would be quantised to bgGreen, which is the
// loudest thing a terminal can draw — the exact opposite of what this is for.
describe('canTint', () => {
  test('needs 256 colours or better', () => {
    expect(canTint(24)).toBe(true);
    expect(canTint(8)).toBe(true);
    expect(canTint(4)).toBe(false);
    expect(canTint(1)).toBe(false);
  });
});

describe('padToWidth', () => {
  test('fills a short line out to the pane edge', () => {
    expect(padToWidth('abc', 6)).toBe('abc   ');
  });

  // The reason this is not String.padEnd: the highlighter's escapes are
  // characters that occupy no columns, and padding by length under-fills every
  // coloured line by exactly the size of its escapes.
  test('counts columns, not characters, so escapes do not eat the padding', () => {
    expect(padToWidth('\u001b[35mabc\u001b[39m', 6)).toBe('\u001b[35mabc\u001b[39m   ');
  });

  test('leaves a line that already reaches the edge alone', () => {
    expect(padToWidth('abcdef', 6)).toBe('abcdef');
    expect(padToWidth('abcdefgh', 6)).toBe('abcdefgh');
  });
});

/** stdin that answers the query with `reply`, or never answers when it is null. */
function fakeStdin(reply: string | null): TintStdin & { raw: boolean[] } {
  const listeners: Array<(chunk: unknown) => void> = [];
  const raw: boolean[] = [];
  return {
    raw,
    isTTY: true,
    isRaw: false,
    setRawMode(mode: boolean) { raw.push(mode); },
    on(_event: 'data', listener: (chunk: unknown) => void) {
      listeners.push(listener);
      if (reply !== null) queueMicrotask(() => listener(reply));
    },
    off(_event: 'data', listener: (chunk: unknown) => void) {
      const at = listeners.indexOf(listener);
      if (at >= 0) listeners.splice(at, 1);
    },
    resume() {},
    pause() {},
    isPaused: () => true,
  };
}

function fakeStdout(colorDepth = 24): TintStdout & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    isTTY: true,
    getColorDepth: () => colorDepth,
    write(data: string) { written.push(data); },
  };
}

describe('detectTint', () => {
  test('asks the terminal and tints for the background it names', async () => {
    const stdout = fakeStdout();
    const tint = await detectTint({
      stdin: fakeStdin('\u001b]11;rgb:fdfd/f6f6/e3e3'),
      stdout,
      env: {},
    });

    expect(stdout.written).toEqual([OSC11_QUERY]);
    expect(tint).toEqual(DIFF_TINT.light);
  });

  test('reassembles a reply that arrived in pieces', async () => {
    const stdin = fakeStdin(null);
    const chunks = ['\u001b]11;rgb:1e', '1e/1e1e/1e', '1e'];
    const on = stdin.on.bind(stdin);
    stdin.on = (event: 'data', listener: (chunk: unknown) => void) => {
      const result = on(event, listener);
      queueMicrotask(() => { for (const chunk of chunks) listener(chunk); });
      return result;
    };

    expect(await detectTint({ stdin, stdout: fakeStdout(), env: {} })).toEqual(DIFF_TINT.dark);
  });

  test('puts raw mode back however the probe ends', async () => {
    const stdin = fakeStdin('\u001b]11;rgb:0000/0000/0000');
    await detectTint({ stdin, stdout: fakeStdout(), env: {} });
    // Set for the query, cleared again — a raw flag left on outlives a crash
    // and leaves the reviewer's shell without line editing.
    expect(stdin.raw).toEqual([true, false]);
  });

  test('falls back to COLORFGBG when the terminal will not answer', async () => {
    const tint = await detectTint({
      stdin: fakeStdin(null),
      stdout: fakeStdout(),
      env: { COLORFGBG: '0;15' },
      timeoutMs: 5,
    });
    expect(tint).toEqual(DIFF_TINT.light);
  });

  test('assumes dark when nothing will say — the common case, and the safer one', async () => {
    const tint = await detectTint({
      stdin: fakeStdin(null), stdout: fakeStdout(), env: {}, timeoutMs: 5,
    });
    expect(tint).toEqual(DIFF_TINT.dark);
  });

  // The signal survives in the gutter and the marker either way, so a terminal
  // that cannot draw the tint faintly gets no tint rather than a loud one.
  test('gives up entirely below 256 colours, without probing', async () => {
    const stdout = fakeStdout(4);
    const tint = await detectTint({
      stdin: fakeStdin('\u001b]11;rgb:0000/0000/0000'), stdout, env: {},
    });
    expect(tint).toBeNull();
    expect(stdout.written).toEqual([]);
  });

  test('writes no query at all when stdout is not a terminal', async () => {
    const stdout = fakeStdout();
    stdout.isTTY = false;
    expect(await detectTint({ stdin: fakeStdin(null), stdout, env: {} })).toBeNull();
    expect(stdout.written).toEqual([]);
  });
});
