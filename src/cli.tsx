#!/usr/bin/env node
import { Octokit } from '@octokit/rest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from './cli/args.js';
import { SdkTransport } from './core/agent/sdk.js';
import { GitHubClient } from './core/github/client.js';
import { fetchPullContext } from './core/github/graphql.js';
import { resolveGitHubToken } from './core/github/auth.js';
import { detectRepo } from './core/git/repo.js';
import { ensureWorktree } from './core/git/worktree.js';
import { parseGeneratedPaths } from './core/git/gitattributes.js';
import { parseUnifiedDiff } from './core/diff/parse.js';
import { computeMeat } from './core/meat/index.js';
import { FileVerdictCache } from './core/meat/cache.js';
import { renderMeat } from './core/render/text.js';

const HELP = `marrow — review large pull requests in the terminal

Usage:
  marrow                      list pull requests for the current repo
  marrow <number|url>         review a pull request
  marrow --dry-run <number>   print what would be reviewed, submit nothing

Options:
  --model <alias>       reasoning model (default: opus)
  --meat-model <alias>  diff classifier (default: one tier below --model)
  --filter <f>          open | review-requested | all (default: open)
  --use-api-key         allow ANTHROPIC_API_KEY; otherwise the Claude Code
                        subscription is used and the key is stripped
  -h, --help            show this help
`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    process.stdout.write(HELP);
    return 0;
  }

  const repo = await detectRepo(process.cwd());
  if (!repo) {
    process.stderr.write(
      'Not inside a GitHub clone. Run marrow from a repository with a github.com origin.\n',
    );
    return 1;
  }

  const token = await resolveGitHubToken();
  const octokit = new Octokit({ auth: token });
  const client = new GitHubClient(token, octokit as never);

  const viewer = (await octokit.rest.users.getAuthenticated()).data.login;

  if (args.prNumber === null) {
    const prs = await client.listPulls(repo.owner, repo.repo, args.filter);
    for (const pr of prs) {
      process.stdout.write(
        `#${pr.number}\t${pr.state}\t${pr.author}\t${pr.title}\n`,
      );
    }
    return 0;
  }

  const pr = await client.getPull(repo.owner, repo.repo, args.prNumber, viewer);
  const context = await fetchPullContext(
    (query, vars) => octokit.graphql(query, vars),
    repo.owner,
    repo.repo,
    args.prNumber,
  );

  if (!args.useApiKey && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) {
    process.stderr.write(
      'note: ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN found and withheld from the agent so your Claude Code subscription is used. Pass --use-api-key to override.\n',
    );
  }

  // The worktree only supplies reading context; failing to create one is not fatal.
  try {
    await ensureWorktree(repo, pr.number, pr.headSha);
  } catch {
    process.stderr.write('note: could not create a worktree; continuing diff-only.\n');
  }

  let generatedPaths = new Set<string>();
  try {
    generatedPaths = parseGeneratedPaths(
      await readFile(join(repo.root, '.gitattributes'), 'utf8'),
    );
  } catch {
    // No .gitattributes is the common case.
  }

  const result = await computeMeat({
    files: parseUnifiedDiff(pr.diff),
    ruleContext: { generatedPaths },
    transport: new SdkTransport({ useApiKey: args.useApiKey }),
    cache: new FileVerdictCache(`${repo.owner}/${repo.repo}`),
    model: args.meatModel,
    prTitle: pr.title,
    prBody: pr.body,
  });

  process.stdout.write(`${pr.title} #${pr.number} by ${pr.author}\n`);
  process.stdout.write(`${pr.baseRef} <- ${pr.headRef}\n\n`);

  const failing = context.checks.filter((c) => c.conclusion === 'failure');
  if (failing.length > 0) {
    process.stdout.write(`failing checks: ${failing.map((c) => c.name).join(', ')}\n\n`);
  }
  if (context.threads.length > 0) {
    process.stdout.write(`${context.threads.length} existing review thread(s)\n\n`);
  }
  if (context.viewerPendingReviewId !== null) {
    process.stdout.write('warning: you have an unsubmitted review on this PR from the web UI\n\n');
  }

  process.stdout.write(renderMeat(result));

  if (args.dryRun) {
    process.stdout.write('\n(dry run: nothing was submitted)\n');
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
