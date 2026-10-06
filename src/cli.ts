#!/usr/bin/env node
import { Octokit } from '@octokit/rest';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, type CliArgs } from './cli/args.js';
import { SdkTransport } from './core/agent/sdk.js';
import { parseUnifiedDiff } from './core/diff/parse.js';
import { resolveGitHubToken } from './core/github/auth.js';
import { GitHubClient } from './core/github/client.js';
import { readContent } from './core/github/contents.js';
import type { ReviewSubmitter } from './core/github/submit.js';
import { parseGeneratedPaths } from './core/git/gitattributes.js';
import { detectRepo, type RepoContext } from './core/git/repo.js';
import { pruneWorktrees } from './core/git/worktree.js';
import { FileFindingsCache } from './core/findings/cache.js';
import { FileGroupCache } from './core/group/cache.js';
import { FileVerdictCache } from './core/meat/cache.js';
import { computeMeat } from './core/meat/index.js';
import { renderMeat } from './core/render/text.js';
import { loadStandards } from './core/review/rubric.js';
import { ReviewSession } from './core/session/session.js';
import { ReviewStore } from './core/store/review.js';
import { MARROW_VERSION } from './core/version.js';
import { startServer } from './server/index.js';

/**
 * A worktree is a full checkout, and one is created per reviewed head. Nothing
 * else ever removes them, so `~/.cache/marrow/worktrees` grew without bound.
 * A week is long enough to reopen yesterday's pull request without refetching.
 */
const WORKTREE_MAX_AGE_DAYS = 7;

const HELP = `marrow — review large pull requests in a local web app

Usage:
  marrow                      pull requests for the repo you are standing in
  marrow <number|url>         review a pull request
  marrow owner/repo#<n>       review a pull request in another repository
  marrow --dry-run <number>   print the abridged diff, submit nothing

Options:
  --model <alias>       Ask, and the tier the others step down from (default: opus)
  --meat-model <alias>  diff classifier and grouping (default: one tier below --model)
  --review-model <m>    the five parallel reviewers (default: one tier below --model)
  --verify-model <m>    the scorer, one call per finding (default: two tiers below --model)
  --source <s>          auto | checkout | worktree | api (default: auto)
  --effort <e>          low | medium | high — reviewer effort and the score shown (90/80/60; default: medium)
  --standards <dir>     your team's review rules: every .md/.yml file in <dir>
  --filter <f>          open | review-requested | all (default: open)
  --port <n>            listen on this port (default: any free port)
  --no-abridge          abridge with the rules alone; no model classifier
  --no-group            lay the diff out by directory instead of by intent
  --no-find             skip Claude's review (and so its verification)
  --no-verify           keep findings unscored: skip the 0-100 confidence scoring
                        (all four can be changed for the next review in the page)
  --no-open             print the URL instead of opening a browser
  --claude-path <p>     use this Claude Code instead of the one bundled with marrow
  --use-api-key         allow ANTHROPIC_API_KEY; otherwise the Claude Code
                        subscription is used and the key is stripped
  -h, --help            show this help
`;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function noteApiKeyWithheld(args: CliArgs): void {
  if (!args.useApiKey && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) {
    process.stderr.write(
      'note: ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN found and withheld from the agent so your Claude Code subscription is used. Pass --use-api-key to override.\n',
    );
  }
}

function openInBrowser(url: string): void {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  const child = spawn(command, args as string[], { stdio: 'ignore', detached: true });
  child.on('error', () => {
    process.stderr.write('note: could not open a browser; open the URL above yourself.\n');
  });
  child.unref();
}

function sameRepo(repo: RepoContext | null, owner: string, name: string): RepoContext | null {
  return repo && repo.owner.toLowerCase() === owner.toLowerCase() && repo.repo.toLowerCase() === name.toLowerCase() ? repo : null;
}

/**
 * `--dry-run`: the abridged diff as text. The findings and grouping passes do
 * not run — this is what you reach for to see the cut without paying for a review.
 */
async function dryRun(args: CliArgs, client: GitHubClient, octokit: Octokit, owner: string, repo: string, viewer: string): Promise<number> {
  if (args.prNumber === null) {
    for (const pr of await client.listPulls(owner, repo, args.filter)) {
      process.stdout.write(`#${pr.number}\t${pr.state}\t${pr.author}\t${pr.title}\n`);
    }
    return 0;
  }
  noteApiKeyWithheld(args);
  const pr = await client.getPull(owner, repo, args.prNumber, viewer);
  const gitattributes = await readContent(octokit as never, owner, repo, '.gitattributes', pr.headSha).catch(() => null);
  const result = await computeMeat({
    files: parseUnifiedDiff(pr.diff),
    ruleContext: { generatedPaths: parseGeneratedPaths(gitattributes ?? '') },
    transport: new SdkTransport({ useApiKey: args.useApiKey, claudePath: args.claudePath }),
    cache: new FileVerdictCache(`${owner}/${repo}`),
    model: args.meatModel,
    prTitle: pr.title,
    prBody: pr.body,
    classify: args.passes.abridge,
  });
  process.stdout.write(`${pr.title} #${pr.number} by ${pr.author}\n${pr.baseRef} <- ${pr.headRef}\n\n`);
  process.stdout.write(renderMeat(result));
  process.stdout.write('\n(dry run: nothing was submitted)\n');
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.showHelp) {
    process.stdout.write(HELP);
    return 0;
  }

  // Not being in a clone is fine now: the picker asks for a repository, and the
  // agent reads through the GitHub API.
  const detected = await detectRepo(process.cwd());
  const clone = detected.ok ? detected.repo : null;

  if (clone) {
    // Awaited, not fired and forgotten: a sweep racing a worktree being created
    // could delete the checkout the agent is about to read.
    await pruneWorktrees(WORKTREE_MAX_AGE_DAYS, new Date(), { repoRoot: clone.root }).catch(() => 0);
  }

  const token = await resolveGitHubToken();
  const octokit = new Octokit({
    auth: token,
    // Octokit logs every failed request, including the 404s marrow expects (a
    // repository with no .gitattributes). Failures still reach the caller and
    // the page; the log only scribbled over the terminal.
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
  const client = new GitHubClient(token, octokit as never);
  const viewer = (await octokit.rest.users.getAuthenticated()).data.login;

  const target = args.prRepo ?? (clone ? { owner: clone.owner, repo: clone.repo } : null);

  if (args.dryRun) {
    if (!target) {
      process.stderr.write(`${detected.ok ? '' : `${detected.reason}\n`}--dry-run needs a repository: run it inside a clone, or pass a pull request URL.\n`);
      return 1;
    }
    return dryRun(args, client, octokit, target.owner, target.repo, viewer);
  }

  noteApiKeyWithheld(args);
  const standards = args.standards ? await loadStandards(args.standards) : '';
  const transport = new SdkTransport({ useApiKey: args.useApiKey, claudePath: args.claudePath });
  const store = new ReviewStore();

  const server = await startServer({
    port: args.port,
    staticDir: join(dirname(fileURLToPath(import.meta.url)), 'web'),
    app: {
      repo: clone,
      viewer,
      version: MARROW_VERSION,
      filter: args.filter,
      initial: target && args.prNumber !== null ? { ...target, number: args.prNumber } : null,
      passes: args.passes,
      listPulls: (owner, repo, filter) => client.listPulls(owner, repo, filter),
      listReviewRequests: () => client.listReviewRequests(),
      extras: octokit,
      createSession: (id, owner, repo, number, passes) => new ReviewSession(id, owner, repo, number, {
        client,
        graphql: (query, vars) => octokit.graphql(query, vars),
        contents: octokit as never,
        submitter: octokit as unknown as ReviewSubmitter,
        transport,
        store,
        meatCache: new FileVerdictCache(`${owner}/${repo}`),
        groupCache: new FileGroupCache(`${owner}/${repo}`),
        findingsCache: new FileFindingsCache(`${owner}/${repo}`),
        repo: sameRepo(clone, owner, repo),
        viewer,
        config: { model: args.model, meatModel: args.meatModel, reviewModel: args.reviewModel, verifyModel: args.verifyModel, effort: args.effort, standards, source: args.source, passes },
      }),
    },
  });

  // One line, stable, so the Claude skill (or anything else) can read the URL.
  process.stdout.write(`marrow: ${server.url}\n`);
  if (args.open) openInBrowser(server.url);
  process.stderr.write('Press Ctrl-C to stop.\n');

  await new Promise<void>((done) => {
    const stop = () => { void server.close().then(done); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${message(error)}\n`);
    process.exit(1);
  },
);
