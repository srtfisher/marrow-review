/**
 * The real server and page over the session fakes the unit tests use: no
 * GitHub, no model. It takes the CLI's arguments and prints the CLI's
 * `marrow: <url>` line, so the Mac app can run it in place of `dist/cli.js`.
 */
import { join } from 'node:path';
import { parseArgs } from '../src/cli/args.js';
import type { AgentRequest, AgentRun } from '../src/core/agent/types.js';
import { FINDINGS_SCHEMA } from '../src/core/findings/schema.js';
import { ReviewSession } from '../src/core/session/session.js';
import { startServer } from '../src/server/index.js';
import { deps, pr, RoutingTransport } from '../tests/core/session/fixtures.js';

// Long enough for the page to see `finding` before `done`: the notification
// fires on that transition, and an instant review arrives already done.
const FIND_DELAY_MS = Number(process.env.MARROW_E2E_FIND_DELAY ?? 1000);

class SlowFindTransport extends RoutingTransport {
  override async run(req: AgentRequest): Promise<AgentRun> {
    if (req.schema === FINDINGS_SCHEMA) await new Promise((r) => setTimeout(r, FIND_DELAY_MS));
    return super.run(req);
  }
}

const args = parseArgs(process.argv.slice(2));
const { number, title, author, state, isDraft, headSha, baseRef, headRef, updatedAt, htmlUrl } = pr;

const server = await startServer({
  port: args.port,
  staticDir: join(import.meta.dir, '..', 'dist', 'web'),
  app: {
    repo: { root: '/clone', owner: 'o', repo: 'r' },
    viewer: 'me',
    version: '0.0.0-e2e',
    filter: args.filter,
    initial: null,
    passes: args.passes,
    listPulls: async () => [{ number, title, author, state, isDraft, headSha, baseRef, headRef, updatedAt, htmlUrl }],
    listReviewRequests: async () => [{ number: 7, title: 'Retry flaky uploads', author, state, isDraft, headSha, baseRef, headRef, updatedAt, htmlUrl, owner: 'acme', repo: 'api' }],
    createSession: (id, owner, repo, number, passes) =>
      new ReviewSession(id, owner, repo, number, deps({ transport: new SlowFindTransport(), config: { ...deps().config, passes } })),
    extras: { request: async (route: string) => ({ data: route === 'GET /emojis' ? {} : '<p>Body.</p>' }) },
  },
});

process.stdout.write(`marrow: ${server.url}\n`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void server.close().then(() => process.exit(0)); });
}
