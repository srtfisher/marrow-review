/** The slice of Octokit the contents API needs, so tests can supply a fake. */
export interface ContentsApi {
  rest: {
    repos: {
      getContent(params: Record<string, unknown>): Promise<{ data: unknown }>;
    };
  };
}

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
}

function isNotFound(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 404;
}

/**
 * A file's text at `ref`, or null when it does not exist there or is a
 * directory. Other failures throw: "absent" and "GitHub is down" must not look
 * the same to a caller deciding whether the file matters.
 */
export async function readContent(
  api: ContentsApi,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const { data } = await api.rest.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data)) return null;
    const file = data as { type?: string; content?: string; encoding?: string };
    if (file.type !== 'file' || typeof file.content !== 'string') return null;
    return file.encoding === 'base64'
      ? Buffer.from(file.content, 'base64').toString('utf8')
      : file.content;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** A directory's entries at `ref`, or null when it is absent or not a directory. */
export async function listContent(
  api: ContentsApi,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<DirEntry[] | null> {
  try {
    const { data } = await api.rest.repos.getContent({ owner, repo, path, ref });
    if (!Array.isArray(data)) return null;
    return (data as DirEntry[]).map((e) => ({ name: e.name, path: e.path, type: e.type }));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}
