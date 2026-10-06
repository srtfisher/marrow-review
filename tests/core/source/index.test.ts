import { test, expect, describe } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_TOOL_NAMES, DENIED_TOOLS, READ_ONLY_TOOLS, apiTools, deniedFor, localSource, resolveSource,
} from '../../../src/core/source/index.js';
import { toolName } from '../../../src/core/agent/types.js';
import type { ContentsApi } from '../../../src/core/github/contents.js';

const pr = { owner: 'o', repo: 'r', number: 7, headSha: 'abc123' };
const repo = { root: '/clone', owner: 'o', repo: 'r' };

function fakeApi(files: Record<string, string>, dirs: Record<string, string[]> = {}): ContentsApi & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    rest: { repos: { async getContent(params) {
      calls.push(params);
      const path = String(params.path);
      if (path in dirs) return { data: dirs[path]!.map((name) => ({ name, path: name, type: 'file' })) };
      if (path in files) {
        return { data: { type: 'file', encoding: 'base64', content: Buffer.from(files[path]!).toString('base64') } };
      }
      throw Object.assign(new Error('Not Found'), { status: 404 });
    } } },
  };
}

describe('tool policy', () => {
  test('API mode tools never collide with the denied set', () => {
    for (const name of [...READ_ONLY_TOOLS, ...API_TOOL_NAMES.map(toolName)]) {
      expect(DENIED_TOOLS).not.toContain(name as never);
    }
  });
});

describe('apiTools', () => {
  test('read_file reads at the head sha and numbers the lines', async () => {
    const api = fakeApi({ 'src/a.ts': 'one\ntwo' });
    const read = apiTools(api, pr).find((t) => t.name === 'read_file')!;
    expect(await read.handler({ path: 'src/a.ts' })).toBe('1\tone\n2\ttwo');
    expect(api.calls[0]!.ref).toBe('abc123');
  });

  test('read_file says so when the file is absent instead of failing the run', async () => {
    const read = apiTools(fakeApi({}), pr).find((t) => t.name === 'read_file')!;
    expect(await read.handler({ path: 'nope.ts' })).toContain('No file at nope.ts');
  });

  test('list_dir marks directories', async () => {
    const api: ContentsApi = { rest: { repos: { async getContent() {
      return { data: [{ name: 'src', path: 'src', type: 'dir' }, { name: 'a.md', path: 'a.md', type: 'file' }] };
    } } } };
    const list = apiTools(api, pr).find((t) => t.name === 'list_dir')!;
    expect(await list.handler({ path: '' })).toBe('src/\na.md');
  });
});

describe('resolveSource', () => {
  test('outside a clone, auto reads through the API without calling it degraded', async () => {
    const { source, degraded } = await resolveSource({ requested: 'auto', repo: null, pr, api: fakeApi({}) });
    expect(source.kind).toBe('api');
    expect(source.canSearch).toBe(false);
    expect(source.access.allowedTools).toEqual(API_TOOL_NAMES.map(toolName));
    expect(deniedFor(source.access)).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash']));
    expect(degraded).toBeNull();
  });

  test('asking for a worktree outside a clone says why it did not get one', async () => {
    const { source, degraded } = await resolveSource({ requested: 'worktree', repo: null, pr, api: fakeApi({}) });
    expect(source.kind).toBe('api');
    expect(degraded).toContain('not in a clone');
  });

  test('a failed checkout falls back to the API and says why', async () => {
    const { source, degraded } = await resolveSource({
      requested: 'auto', repo, pr, api: fakeApi({}),
      resolveCheckout: async () => { throw new Error('git fetch failed'); },
    });
    expect(source.kind).toBe('api');
    expect(degraded).toContain('git fetch failed');
  });

  test('a clean checkout at the head is read in place', async () => {
    const { source, degraded } = await resolveSource({
      requested: 'auto', repo, pr, api: fakeApi({}),
      resolveCheckout: async () => ({ path: '/clone', sha: 'abc123', kind: 'current' }),
    });
    expect(source.kind).toBe('checkout');
    expect(source.access.allowedTools).toEqual([...READ_ONLY_TOOLS]);
    expect(degraded).toBeNull();
  });

  test('asking for the checkout but getting a worktree is reported', async () => {
    const { source, degraded } = await resolveSource({
      requested: 'checkout', repo, pr, api: fakeApi({}),
      resolveCheckout: async () => ({ path: '/wt', sha: 'abc123', kind: 'worktree' }),
    });
    expect(source.kind).toBe('worktree');
    expect(degraded).toContain('worktree');
  });

  test('api is honored even inside a clone', async () => {
    const { source } = await resolveSource({ requested: 'api', repo, pr, api: fakeApi({}) });
    expect(source.kind).toBe('api');
  });
});

describe('localSource.readHead', () => {
  test('reads a file inside the checkout and refuses one outside it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-src-'));
    await writeFile(join(dir, 'a.txt'), 'hello');
    const source = localSource({ path: dir, sha: 'x', kind: 'current' });
    expect(await source.readHead('a.txt')).toBe('hello');
    expect(await source.readHead('../../etc/passwd')).toBeNull();
  });
});
