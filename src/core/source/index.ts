import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { toolName, type AgentTool } from '../agent/types.js';
import { listContent, readContent, type ContentsApi } from '../github/contents.js';
import type { RepoContext } from '../git/repo.js';
import { ensureWorktree, resolveReviewCheckout, type ReviewCheckout } from '../git/worktree.js';

export type SourceKind = 'checkout' | 'worktree' | 'api';
export type SourceRequest = SourceKind | 'auto';

/** What one agent run may read, and where. Shared by find, verify, and chat. */
export interface AgentAccess {
  cwd: string;
  allowedTools: string[];
  tools: AgentTool[];
  /** Denied on top of `DENIED_TOOLS`: in API mode, the local file tools, which would read an empty directory. */
  deniedTools?: readonly string[];
}

/** The deny list for a run with this access. */
export function deniedFor(access: AgentAccess): string[] {
  return [...DENIED_TOOLS, ...(access.deniedTools ?? [])];
}

export interface ReviewSource {
  kind: SourceKind;
  access: AgentAccess;
  /** False in API mode: GitHub cannot search an arbitrary commit. */
  canSearch: boolean;
  /** A file's text at the head commit, or null when it does not exist there. */
  readHead(path: string): Promise<string | null>;
}

export interface PullRef {
  owner: string;
  repo: string;
  number: number;
  headSha: string;
}

/** The agent may read the checkout. It may not change it or run commands in it. */
export const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'] as const;
/**
 * Named explicitly rather than left to the SDK's default-deny for tools absent
 * from `allowedTools`: the deny list is the thing a reader audits, and a future
 * default that opens up — or a subagent that inherits a wider set — must not be
 * able to quietly hand untrusted code a shell (`Bash`), a way to spawn an agent
 * outside these limits (`Task`), or a way to exfiltrate what it read
 * (`WebFetch`, `WebSearch`).
 */
export const DENIED_TOOLS = [
  'Write', 'Edit', 'NotebookEdit', 'Bash', 'Task', 'WebFetch', 'WebSearch',
] as const;

export const API_TOOL_NAMES = ['read_file', 'list_dir'] as const;

/** Large enough for any source file worth reading whole; small enough not to flood a turn. */
const MAX_FILE_CHARS = 120_000;

function numbered(text: string): string {
  const lines = text.split('\n');
  const body = lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
  if (body.length <= MAX_FILE_CHARS) return body;
  return `${body.slice(0, MAX_FILE_CHARS)}\n… truncated at ${MAX_FILE_CHARS} characters of ${body.length}`;
}

export function apiTools(api: ContentsApi, pr: PullRef): AgentTool[] {
  return [
    {
      name: 'read_file',
      description: `Read a file from ${pr.owner}/${pr.repo} at the pull request's head commit. Returns the text with line numbers.`,
      params: { path: { type: 'string', description: 'Repository-relative path, no leading slash.' } },
      handler: async ({ path }) => {
        const text = await readContent(api, pr.owner, pr.repo, String(path), pr.headSha);
        return text === null ? `No file at ${String(path)} in this commit.` : numbered(text);
      },
    },
    {
      name: 'list_dir',
      description: `List a directory in ${pr.owner}/${pr.repo} at the pull request's head commit. Use "" for the root.`,
      params: { path: { type: 'string', description: 'Repository-relative directory path; "" for the root.' } },
      handler: async ({ path }) => {
        const entries = await listContent(api, pr.owner, pr.repo, String(path), pr.headSha);
        if (entries === null) return `No directory at ${String(path)} in this commit.`;
        return entries.map((e) => `${e.type === 'dir' ? `${e.path}/` : e.path}`).join('\n');
      },
    },
  ];
}

export async function apiSource(api: ContentsApi, pr: PullRef): Promise<ReviewSource> {
  // The SDK needs a working directory even when every file tool is denied. An
  // empty one means a tool that slipped through would find nothing to read.
  const cwd = await mkdtemp(join(tmpdir(), 'marrow-api-'));
  return {
    kind: 'api',
    canSearch: false,
    access: { cwd, allowedTools: API_TOOL_NAMES.map(toolName), tools: apiTools(api, pr), deniedTools: READ_ONLY_TOOLS },
    readHead: (path) => readContent(api, pr.owner, pr.repo, path, pr.headSha),
  };
}

export function readOnlyAccess(cwd: string): AgentAccess {
  return { cwd, allowedTools: [...READ_ONLY_TOOLS], tools: [] };
}

export function localSource(checkout: ReviewCheckout): ReviewSource {
  const root = resolve(checkout.path);
  return {
    kind: checkout.kind === 'current' ? 'checkout' : 'worktree',
    canSearch: true,
    access: readOnlyAccess(checkout.path),
    readHead: async (path) => {
      const target = resolve(root, path);
      // A path from the page must not climb out of the checkout.
      if (relative(root, target).startsWith('..')) return null;
      try {
        return await readFile(target, 'utf8');
      } catch {
        return null;
      }
    },
  };
}

export interface ResolveSourceOptions {
  requested: SourceRequest;
  /** The clone marrow was started in, when it is a clone of this PR's repository. */
  repo: RepoContext | null;
  pr: PullRef;
  api: ContentsApi;
  resolveCheckout?: typeof resolveReviewCheckout;
  createWorktree?: typeof ensureWorktree;
}

export interface ResolvedSource {
  source: ReviewSource;
  /** Why the source is not the one asked for, in the words to show. */
  degraded: string | null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Picks where the agent reads from. Never throws: every local failure lands on
 * the API source, which needs nothing but the token marrow already has, and
 * says why — a review that quietly lost its ability to search is one the
 * reviewer would trust more than it deserves.
 */
export async function resolveSource(opts: ResolveSourceOptions): Promise<ResolvedSource> {
  const { requested, repo, pr } = opts;
  if (requested === 'api') return { source: await apiSource(opts.api, pr), degraded: null };

  if (repo === null) {
    const degraded = requested === 'auto'
      ? null
      : `not in a clone of ${pr.owner}/${pr.repo}, so the agent reads through the GitHub API`;
    return { source: await apiSource(opts.api, pr), degraded };
  }

  try {
    if (requested === 'worktree') {
      const create = opts.createWorktree ?? ensureWorktree;
      const wt = await create(repo, pr.number, pr.headSha);
      return { source: localSource({ ...wt, kind: 'worktree' }), degraded: null };
    }
    const resolveCheckout = opts.resolveCheckout ?? resolveReviewCheckout;
    const checkout = await resolveCheckout(repo, pr.number, pr.headSha,
      opts.createWorktree ? { createWorktree: opts.createWorktree } : {});
    const degraded = requested === 'checkout' && checkout.kind !== 'current'
      ? 'the current checkout is not the pull request head (or is dirty), so a worktree is used'
      : null;
    return { source: localSource(checkout), degraded };
  } catch (error) {
    return {
      source: await apiSource(opts.api, pr),
      degraded: `could not prepare a local checkout (${message(error)}); the agent reads through the GitHub API`,
    };
  }
}
