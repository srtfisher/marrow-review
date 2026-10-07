import { describe, expect, test } from 'bun:test';
import { fetchGitHubStatus } from '../../../src/core/github/status.js';

const answering = (body: unknown, ok = true) =>
  (async () => new Response(JSON.stringify(body), { status: ok ? 200 : 503 })) as unknown as typeof fetch;

describe('fetchGitHubStatus', () => {
  test('reads the incident, its latest update, and the degraded components', async () => {
    const status = await fetchGitHubStatus(answering({
      status: { description: 'Partial System Outage' },
      incidents: [{ name: 'Incident with Pull Requests', shortlink: 'https://stspg.io/x', incident_updates: [{ body: 'We are investigating.' }] }],
      components: [
        { name: 'Pull Requests', status: 'major_outage' },
        { name: 'API Requests', status: 'operational' },
      ],
    }));
    expect(status).toEqual({
      description: 'Partial System Outage',
      incidents: [{ name: 'Incident with Pull Requests', url: 'https://stspg.io/x', update: 'We are investigating.' }],
      degraded: ['Pull Requests: major outage'],
    });
  });

  test('gives nothing rather than throwing when the status page is down too', async () => {
    const failing = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect(await fetchGitHubStatus(failing)).toBeNull();
    expect(await fetchGitHubStatus(answering({}, false))).toBeNull();
  });
});
