#!/usr/bin/env node
import { Octokit } from '@octokit/rest';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { render } from 'ink';
import { parseArgs, type CliArgs } from './cli/args.js';
import { SdkTransport } from './core/agent/sdk.js';
import { GitHubClient } from './core/github/client.js';
import { fetchPullContext } from './core/github/graphql.js';
import { resolveGitHubToken } from './core/github/auth.js';
import { submitReview, type ReviewSubmitter } from './core/github/submit.js';
import { detectRepo, type RepoContext } from './core/git/repo.js';
import { ensureWorktree, pruneWorktrees } from './core/git/worktree.js';
import { parseGeneratedPaths } from './core/git/gitattributes.js';
import { parseUnifiedDiff } from './core/diff/parse.js';
import { computeMeat, type MeatResult } from './core/meat/index.js';
import { FileVerdictCache } from './core/meat/cache.js';
import { renderMeat } from './core/render/text.js';
import { demoteUnanchorable } from './core/review/anchors.js';
import { buildReviewPayload } from './core/review/payload.js';
import { ReviewStore, carryOver } from './core/store/review.js';
import type { ReviewDraft, Verdict } from './core/review/types.js';
import type {
  CheckRun, PullFilter, PullRequestDetail, PullRequestSummary, ReviewThread,
} from './core/github/types.js';
import { App } from './tui/App.js';

/**
 * A worktree is a full checkout, and one is created per reviewed head. Nothing
 * else ever removes them, so `~/.cache/marrow/worktrees` grew without bound.
 * A week is long enough to reopen yesterday's pull request without refetching.
 */
const WORKTREE_MAX_AGE_DAYS = 7;

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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every degraded-mode note goes to stderr, in the TUI as much as in text mode:
 * the alternate screen hides it while marrow runs and the terminal shows it
 * again on exit, so a redirect captures it either way.
 */
function noteApiKeyWithheld(args: CliArgs): void {
  if (!args.useApiKey && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) {
    process.stderr.write(
      'note: ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN found and withheld from the agent so your Claude Code subscription is used. Pass --use-api-key to override.\n',
    );
  }
}

/**
 * The worktree only supplies reading context; failing to create one is not
 * fatal. Returns its path, which is also the directory the agent reads from —
 * null means diff-only, and the agent passes stay off rather than reasoning
 * about whatever commit the user's own checkout happens to be on.
 */
async function tryWorktree(repo: RepoContext, pr: PullRequestDetail): Promise<string | null> {
  try {
    const worktree = await ensureWorktree(repo, pr.number, pr.headSha);
    return worktree.path;
  } catch {
    process.stderr.write('note: could not create a worktree; continuing diff-only.\n');
    return null;
  }
}

async function readGeneratedPaths(repo: RepoContext): Promise<Set<string>> {
  try {
    return parseGeneratedPaths(await readFile(join(repo.root, '.gitattributes'), 'utf8'));
  } catch {
    // No .gitattributes is the common case.
    return new Set<string>();
  }
}

function runMeat(
  args: CliArgs,
  repo: RepoContext,
  pr: PullRequestDetail,
  generatedPaths: Set<string>,
): Promise<MeatResult> {
  return computeMeat({
    files: parseUnifiedDiff(pr.diff),
    ruleContext: { generatedPaths },
    transport: new SdkTransport({ useApiKey: args.useApiKey }),
    cache: new FileVerdictCache(`${repo.owner}/${repo.repo}`),
    model: args.meatModel,
    prTitle: pr.title,
    prBody: pr.body,
  });
}

function openInBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const child = spawn(command, [url], { stdio: 'ignore', detached: true });
  child.on('error', () => {
    // No opener on this machine. Nothing to report from inside a full-screen app.
  });
  child.unref();
}

interface Session {
  args: CliArgs;
  repo: RepoContext;
  client: GitHubClient;
  octokit: Octokit;
  viewer: string;
}

async function listToStdout(session: Session, filter: PullFilter): Promise<number> {
  const { repo, client } = session;
  const prs = await client.listPulls(repo.owner, repo.repo, filter);
  for (const pr of prs) {
    process.stdout.write(`#${pr.number}\t${pr.state}\t${pr.author}\t${pr.title}\n`);
  }
  return 0;
}

/**
 * The text path, unchanged: `--dry-run`, and any non-interactive invocation.
 *
 * The findings and verify passes deliberately do not run here. They exist to be
 * triaged key by key, and `--dry-run` is what you reach for to see the cut
 * without paying for a review — printing findings would make it the slow,
 * expensive command instead of the cheap one.
 */
async function reviewToStdout(session: Session, prNumber: number): Promise<number> {
  const { args, repo, client, octokit, viewer } = session;

  const pr = await client.getPull(repo.owner, repo.repo, prNumber, viewer);
  const context = await fetchPullContext(
    (query, vars) => octokit.graphql(query, vars),
    repo.owner,
    repo.repo,
    prNumber,
  );

  noteApiKeyWithheld(args);
  await tryWorktree(repo, pr);
  const result = await runMeat(args, repo, pr, await readGeneratedPaths(repo));

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

async function runTui(session: Session): Promise<number> {
  const { args, repo, client, octokit, viewer } = session;
  const repoLabel = `${repo.owner}/${repo.repo}`;

  let filter = args.filter;
  let prs: PullRequestSummary[] = await client.listPulls(repo.owner, repo.repo, filter);
  let pr: PullRequestDetail | null = null;
  let meat: MeatResult | null = null;
  let checks: CheckRun[] = [];
  let threads: ReviewThread[] = [];
  let worktree: string | null = null;
  let status: string | null = null;
  let statusTone: 'muted' | 'pending' | 'danger' = 'muted';
  let initialDraft: ReviewDraft | null = null;
  /** Printed after the alternate screen is torn down, so it survives on screen. */
  let farewell: string | null = null;

  const store = new ReviewStore();

  noteApiKeyWithheld(args);

  // One transport for the findings, verify, and chat passes; the meat pass
  // makes its own per run because it is keyed to a different model.
  const transport = new SdkTransport({ useApiKey: args.useApiKey });

  function view() {
    return (
      <App
        repoLabel={repoLabel}
        prs={prs}
        pr={pr}
        meat={meat}
        checks={checks}
        threads={threads}
        model={args.model}
        worktreeOk={worktree !== null}
        filter={filter}
        status={status}
        statusTone={statusTone}
        transport={transport}
        cwd={worktree}
        initialDraft={initialDraft}
        onOpenPr={(number) => void openPr(number)}
        onSubmit={(draft, verdict) => void submit(draft, verdict)}
        onFilter={(next) => void changeFilter(next)}
        onRefresh={() => void refresh()}
        onOpenUrl={openInBrowser}
        onPersist={saveDraft}
        onDiscard={discardDraft}
      />
    );
  }

  // The alternate screen is what makes `q` leave the terminal exactly as it was
  // found, the way vim and less do.
  const instance = render(view(), { alternateScreen: true });

  function draw(): void {
    instance.rerender(view());
  }

  /**
   * The draft to open this pull request with: the one saved against this exact
   * head, or failing that whatever survives from a head the author has since
   * pushed over. Comments that no longer anchor are counted out loud rather
   * than disappearing.
   */
  async function loadDraft(loaded: PullRequestDetail, result: MeatResult): Promise<string | null> {
    const saved = await store.load(repo.owner, repo.repo, loaded.number, loaded.headSha);
    if (saved) {
      initialDraft = saved.draft;
      const count = saved.draft.comments.length;
      return count > 0 ? `Restored ${count} unsubmitted comment(s) from your last session.` : null;
    }

    const previous = await store.findPreviousHead(
      repo.owner, repo.repo, loaded.number, loaded.headSha,
    );
    if (!previous || previous.draft.comments.length === 0) return null;

    const { carried, orphaned } = carryOver(previous.draft, result.files.map((f) => f.file));
    initialDraft = { ...previous.draft, comments: carried };
    const lost = orphaned.length > 0
      ? `; ${orphaned.length} no longer anchor to this diff and were dropped`
      : '';
    return `Carried ${carried.length} comment(s) over from an earlier head${lost}.`;
  }

  async function openPr(number: number): Promise<void> {
    pr = null;
    meat = null;
    checks = [];
    threads = [];
    worktree = null;
    initialDraft = null;
    status = `Loading #${number}…`;
    statusTone = 'muted';
    draw();

    try {
      const loaded = await client.getPull(repo.owner, repo.repo, number, viewer);
      const context = await fetchPullContext(
        (query, vars) => octokit.graphql(query, vars),
        repo.owner,
        repo.repo,
        number,
      );
      worktree = await tryWorktree(repo, loaded);
      const result = await runMeat(args, repo, loaded, await readGeneratedPaths(repo));

      // A missing or unreadable state directory must not make a pull request
      // unopenable; the review still works, it just starts empty.
      const restored = await loadDraft(loaded, result).catch(() => null);

      pr = loaded;
      meat = result;
      checks = context.checks;
      threads = context.threads;
      const pendingReview = context.viewerPendingReviewId === null
        ? null
        : 'You have an unsubmitted review on this pull request from the web UI.';
      // Both notes are about unsubmitted work, which is what yellow is for.
      status = [pendingReview, restored].filter((s) => s !== null).join(' · ') || null;
      statusTone = 'pending';
    } catch (error) {
      status = `Could not load #${number}: ${message(error)}`;
      statusTone = 'danger';
    }

    draw();
  }

  function saveDraft(draft: ReviewDraft): void {
    if (!pr) return;
    void store
      .save({
        version: 1,
        owner: repo.owner,
        repo: repo.repo,
        number: pr.number,
        headSha: pr.headSha,
        draft,
        updatedAt: new Date().toISOString(),
      })
      // Losing a draft is bad; crashing the review over it is worse.
      .catch(() => {});
  }

  function discardDraft(): void {
    if (!pr) return;
    void store.clear(repo.owner, repo.repo, pr.number, pr.headSha).catch(() => {});
  }

  async function changeFilter(next: PullFilter): Promise<void> {
    filter = next;
    await refresh();
  }

  async function refresh(): Promise<void> {
    try {
      prs = await client.listPulls(repo.owner, repo.repo, filter);
    } catch (error) {
      status = `Could not refresh: ${message(error)}`;
      statusTone = 'danger';
    }
    draw();
  }

  async function submit(draft: ReviewDraft, verdict: Verdict): Promise<void> {
    if (!pr || !meat) return;
    const files = meat.files.map((f) => f.file);

    try {
      // A finding about a line GitHub will not accept is still worth telling the
      // author, so it moves into the review body rather than being discarded.
      const { draft: adjusted } = demoteUnanchorable({ ...draft, verdict }, files);
      const payload = buildReviewPayload(adjusted, files);
      const result = await submitReview(
        octokit as unknown as ReviewSubmitter,
        repo.owner,
        repo.repo,
        pr.number,
        payload,
      );
      // The draft is on GitHub now; keeping it on disk would resurrect it the
      // next time this pull request is opened.
      await store.clear(repo.owner, repo.repo, pr.number, pr.headSha).catch(() => {});
      farewell = `Submitted ${verdict} on #${pr.number}: ${result.htmlUrl}`;
      instance.unmount();
    } catch (error) {
      status = message(error);
      statusTone = 'danger';
      draw();
    }
  }

  if (args.prNumber !== null) void openPr(args.prNumber);

  await instance.waitUntilExit();
  if (farewell) process.stdout.write(`${farewell}\n`);
  return 0;
}

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

  // Awaited, not fired and forgotten: a sweep racing `ensureWorktree` could
  // delete the checkout the agent is about to read. A failed sweep is ignored —
  // a full cache is a nuisance, a review that will not start is not.
  await pruneWorktrees(WORKTREE_MAX_AGE_DAYS, new Date(), { repoRoot: repo.root }).catch(() => 0);

  const token = await resolveGitHubToken();
  const octokit = new Octokit({ auth: token });
  const client = new GitHubClient(token, octokit as never);
  const viewer = (await octokit.rest.users.getAuthenticated()).data.login;
  const session: Session = { args, repo, client, octokit, viewer };

  // The TUI needs a keyboard. Without one — a pipe, a cron job, a CI step —
  // marrow stays the text tool it was rather than failing to enter raw mode.
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;

  if (args.dryRun || !interactive) {
    return args.prNumber === null
      ? listToStdout(session, args.filter)
      : reviewToStdout(session, args.prNumber);
  }

  return runTui(session);
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${message(error)}\n`);
    process.exit(1);
  },
);
