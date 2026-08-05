import { test, expect, describe } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReviewStore, carryOver, stateKey } from '../../../src/core/store/review.js';
import { parseUnifiedDiff } from '../../../src/core/diff/parse.js';
import type { ReviewDraft, StagedComment } from '../../../src/core/review/types.js';

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,4 @@ boot()
 const c = load();
-start(c);
+const s = start(c);
+s.on('error', fail);
 return c;
`;

const files = parseUnifiedDiff(DIFF);

function comment(over: Partial<StagedComment> = {}): StagedComment {
  return {
    id: 'c1', path: 'src/app.ts', line: 12, side: 'RIGHT',
    startLine: null, body: 'Look at this.', suggestion: null, ...over,
  };
}

function draft(comments: StagedComment[]): ReviewDraft {
  return { verdict: null, body: 'wip', comments };
}

describe('stateKey', () => {
  test('is stable and includes the head sha', () => {
    const a = stateKey('o', 'r', 42, 'abc123');
    expect(a).toBe(stateKey('o', 'r', 42, 'abc123'));
    expect(a).not.toBe(stateKey('o', 'r', 42, 'def456'));
  });
});

describe('ReviewStore', () => {
  test('round-trips a draft', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-store-'));
    try {
      const store = new ReviewStore(dir);
      expect(await store.load('o', 'r', 42, 'sha1')).toBeNull();

      await store.save({
        version: 1, owner: 'o', repo: 'r', number: 42, headSha: 'sha1',
        draft: draft([comment()]), updatedAt: '2026-08-05T00:00:00Z',
      });

      const loaded = await store.load('o', 'r', 42, 'sha1');
      expect(loaded?.draft.comments).toHaveLength(1);
      expect(loaded?.draft.body).toBe('wip');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a different head sha is a different record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-store-'));
    try {
      const store = new ReviewStore(dir);
      await store.save({
        version: 1, owner: 'o', repo: 'r', number: 42, headSha: 'sha1',
        draft: draft([comment()]), updatedAt: 'now',
      });
      expect(await store.load('o', 'r', 42, 'sha2')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('findPreviousHead locates a draft from an earlier sha', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-store-'));
    try {
      const store = new ReviewStore(dir);
      await store.save({
        version: 1, owner: 'o', repo: 'r', number: 42, headSha: 'old',
        draft: draft([comment()]), updatedAt: 'now',
      });
      const found = await store.findPreviousHead('o', 'r', 42, 'new');
      expect(found?.headSha).toBe('old');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a corrupt record loads as null rather than throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marrow-store-'));
    try {
      const store = new ReviewStore(dir);
      await store.save({
        version: 1, owner: 'o', repo: 'r', number: 42, headSha: 'sha1',
        draft: draft([]), updatedAt: 'now',
      });
      await Bun.write(join(dir, `${stateKey('o', 'r', 42, 'sha1')}.json`), '{broken');
      expect(await store.load('o', 'r', 42, 'sha1')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('carryOver', () => {
  test('keeps a comment whose anchor still exists', () => {
    const { carried, orphaned } = carryOver(draft([comment({ line: 12 })]), files);
    expect(carried).toHaveLength(1);
    expect(orphaned).toHaveLength(0);
  });

  test('orphans a comment whose anchor is gone', () => {
    const { carried, orphaned } = carryOver(draft([comment({ line: 900 })]), files);
    expect(carried).toHaveLength(0);
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]!.body).toBe('Look at this.');
  });

  test('orphans a comment whose file left the diff', () => {
    const { orphaned } = carryOver(draft([comment({ path: 'gone.ts' })]), files);
    expect(orphaned).toHaveLength(1);
  });

  test('partitions a mixed set without losing any comment', () => {
    const d = draft([
      comment({ id: 'ok', line: 12 }),
      comment({ id: 'gone', line: 900 }),
    ]);
    const { carried, orphaned } = carryOver(d, files);
    expect(carried.map((c) => c.id)).toEqual(['ok']);
    expect(orphaned.map((c) => c.id)).toEqual(['gone']);
    expect(carried.length + orphaned.length).toBe(d.comments.length);
  });
});
