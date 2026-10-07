/** GitHub's own account of an outage, from githubstatus.com. */
export interface GitHubStatus {
  /** "Partial System Outage", "All Systems Operational", … */
  description: string;
  incidents: Array<{ name: string; url: string; update: string | null }>;
  /** Components not reported operational, e.g. "Pull Requests: major outage". */
  degraded: string[];
}

export const GITHUB_STATUS_PAGE = 'https://www.githubstatus.com';
const SUMMARY = `${GITHUB_STATUS_PAGE}/api/v2/summary.json`;

interface Summary {
  status?: { description?: string };
  incidents?: Array<{ name?: string; shortlink?: string; incident_updates?: Array<{ body?: string }> }>;
  components?: Array<{ name?: string; status?: string; group?: boolean }>;
}

/**
 * Asked only after a GitHub call failed, and never throws: the status page can be
 * down in the same outage, and that must not replace the error it explains.
 */
export async function fetchGitHubStatus(fetchFn: typeof fetch = fetch, timeoutMs = 3000): Promise<GitHubStatus | null> {
  try {
    const res = await fetchFn(SUMMARY, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const data = (await res.json()) as Summary;
    return {
      description: data.status?.description ?? 'Unknown',
      incidents: (data.incidents ?? []).map((i) => ({
        name: i.name ?? 'Unnamed incident',
        url: i.shortlink ?? GITHUB_STATUS_PAGE,
        update: i.incident_updates?.[0]?.body?.trim() || null,
      })),
      degraded: (data.components ?? [])
        .filter((c) => c.name && c.status && c.status !== 'operational' && !c.group)
        .map((c) => `${c.name}: ${c.status!.replace(/_/g, ' ')}`),
    };
  } catch {
    return null;
  }
}
