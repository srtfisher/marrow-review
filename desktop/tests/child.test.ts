import { describe, expect, test } from 'bun:test';
import { findExecutable, loginShellPath, osascriptNotice, parseServerUrl, passFlags, tail, toNotice, toPasses } from '../src/child.js';

describe('parseServerUrl', () => {
  test('reads the URL from the line the CLI prints', () => {
    expect(parseServerUrl('marrow: http://127.0.0.1:51234/?token=abc\n')).toBe('http://127.0.0.1:51234/?token=abc');
  });

  test('ignores other output that mentions marrow', () => {
    expect(parseServerUrl('note: marrow: http://example.com')).toBeNull();
    expect(parseServerUrl('marrow: not a url')).toBeNull();
  });
});

describe('loginShellPath', () => {
  test('takes the PATH after the marker, past anything the rc files printed', async () => {
    const path = await loginShellPath({ PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }, async () => 'Welcome!\n__MARROW_PATH__/opt/homebrew/bin:/usr/bin');
    expect(path).toBe('/opt/homebrew/bin:/usr/bin');
  });

  test('adds the Homebrew directories when the shell fails', async () => {
    const path = await loginShellPath({ PATH: '/usr/bin:/bin' }, async () => null);
    expect(path).toBe('/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin');
  });

  test('does not repeat a directory the PATH already has', async () => {
    const path = await loginShellPath({ PATH: '/opt/homebrew/bin:/usr/bin' }, async () => '');
    expect(path).toBe('/opt/homebrew/bin:/usr/bin:/usr/local/bin');
  });
});

describe('tail', () => {
  test('keeps the last lines', () => {
    expect(tail('a\nb\nc\n', 2)).toBe('b\nc');
  });
});

describe('toNotice', () => {
  test('accepts a title and a body', () => {
    expect(toNotice({ title: '#1 x', body: '2 findings' })).toEqual({ title: '#1 x', body: '2 findings' });
  });

  test('rejects anything else', () => {
    expect(toNotice(null)).toBeNull();
    expect(toNotice({ title: 1, body: 'x' })).toBeNull();
    expect(toNotice('hi')).toBeNull();
  });
});

describe('osascriptNotice', () => {
  test('passes the text as arguments, never as script source', () => {
    const args = osascriptNotice({ title: '#1 "x" end run', body: 'say "hi"' });
    expect(args.slice(-2)).toEqual(['#1 "x" end run', 'say "hi"']);
    expect(args.filter((_, i) => args[i - 1] === '-e').join('\n')).not.toContain('hi');
    expect(args.join(' ')).toContain('with title "marrow"');
  });
});

describe('passes', () => {
  test('flags only the passes that are off', () => {
    expect(passFlags({ abridge: true, group: false, find: true, verify: false })).toEqual(['--no-group', '--no-verify']);
    expect(passFlags({ abridge: true, group: true, find: true, verify: true })).toEqual([]);
  });

  test('no saved passes means no flags, so the CLI defaults apply', () => {
    expect(passFlags(null)).toEqual([]);
  });

  test('accepts only four booleans', () => {
    expect(toPasses({ abridge: true, group: true, find: false, verify: true })).toEqual({ abridge: true, group: true, find: false, verify: true });
    expect(toPasses({ abridge: true, group: true, find: 'no', verify: true })).toBeNull();
    expect(toPasses({ abridge: true })).toBeNull();
  });
});

describe('findExecutable', () => {
  test('takes the first directory that has it', () => {
    const present = new Set(['/b/claude', '/c/claude']);
    expect(findExecutable('claude', ['/a', '/b/', '/c'], (p) => present.has(p))).toBe('/b/claude');
  });

  test('is null when no directory has it', () => {
    expect(findExecutable('claude', ['/a', ''], () => false)).toBeNull();
  });
});
