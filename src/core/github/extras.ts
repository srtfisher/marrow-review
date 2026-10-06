/** The slice of Octokit used for the composer's helpers, so tests can supply a fake. */
export interface ExtrasApi {
  request(route: string, params?: Record<string, unknown>): Promise<{ data: unknown }>;
}

/**
 * GitHub's own markdown rendering, in the repository's context, so a preview
 * resolves emoji, mentions, issue links, and suggestion blocks exactly as the
 * posted comment will.
 */
export async function renderMarkdown(api: ExtrasApi, text: string, context: string): Promise<string> {
  const { data } = await api.request('POST /markdown', { text, mode: 'gfm', context });
  return String(data);
}

/** Emoji shortcode → image URL, as GitHub serves them. */
export async function listEmoji(api: ExtrasApi): Promise<Record<string, string>> {
  const { data } = await api.request('GET /emojis');
  return data as Record<string, string>;
}

export interface MentionCandidate {
  login: string;
  avatarUrl: string;
}

export async function listAssignees(api: ExtrasApi, owner: string, repo: string): Promise<MentionCandidate[]> {
  const { data } = await api.request('GET /repos/{owner}/{repo}/assignees', { owner, repo, per_page: 100 });
  return (data as Array<{ login: string; avatar_url: string }>).map((u) => ({ login: u.login, avatarUrl: u.avatar_url }));
}
