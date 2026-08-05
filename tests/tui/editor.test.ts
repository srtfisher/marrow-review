import { test, expect, describe } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editInEditor, resolveEditor } from '../../src/tui/editor.js';

describe('resolveEditor', () => {
  test('prefers VISUAL over EDITOR', () => {
    expect(resolveEditor({ VISUAL: 'code -w', EDITOR: 'vim' })).toBe('code -w');
  });

  test('falls back to EDITOR, then to vi', () => {
    expect(resolveEditor({ EDITOR: 'nano' })).toBe('nano');
    expect(resolveEditor({})).toBe('vi');
  });
});

describe('editInEditor', () => {
  test('round-trips content the editor rewrote', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-ed-'));
    try {
      const run = async (_cmd: string, args: string[]) => {
        const file = args[args.length - 1]!;
        await Bun.write(file, 'edited body\n');
        return 0;
      };
      const out = await editInEditor('initial', { env: { EDITOR: 'fake' }, run, tmpDir: dir });
      expect(out).toBe('edited body');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('passes the initial content into the temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-ed-'));
    try {
      let seen = '';
      const run = async (_cmd: string, args: string[]) => {
        seen = await readFile(args[args.length - 1]!, 'utf8');
        return 0;
      };
      await editInEditor('seed text', { env: { EDITOR: 'fake' }, run, tmpDir: dir });
      expect(seen).toBe('seed text');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a non-zero editor exit preserves the original body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-ed-'));
    try {
      const run = async (_cmd: string, args: string[]) => {
        await Bun.write(args[args.length - 1]!, 'garbage');
        return 1;
      };
      const out = await editInEditor('keep me', { env: { EDITOR: 'fake' }, run, tmpDir: dir });
      expect(out).toBe('keep me');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('splits a multi-word editor command into command and args', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-ed-'));
    try {
      let cmd = '';
      let args: string[] = [];
      const run = async (c: string, a: string[]) => {
        cmd = c; args = a;
        await Bun.write(a[a.length - 1]!, 'x');
        return 0;
      };
      await editInEditor('', { env: { VISUAL: 'code -w' }, run, tmpDir: dir });
      expect(cmd).toBe('code');
      expect(args[0]).toBe('-w');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
