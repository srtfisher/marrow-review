import { createHash } from 'node:crypto';
import { describeAgentFailure, type AgentFailure } from '../agent/errors.js';
import { totalUsage, UsageMeter, type PassUsage, type UsageReport } from '../agent/meter.js';
import type { AgentTransport } from '../agent/types.js';
import { parseUnifiedDiff } from '../diff/parse.js';
import type { DiffFile } from '../diff/types.js';
import { ask as askAgent, type ChatSession } from '../findings/chat.js';
import type { FindingsCache } from '../findings/cache.js';
import { runFindings } from '../findings/find.js';
import {
  accept, drop, edit, initTriage, toggleSuggestion, toStagedComments, type TriagedFinding,
} from '../findings/triage.js';
import { filesToRead, readChangedFiles, type ReviewContext } from '../findings/context.js';
import { anchorExcerpt, isScorable, runScore, type ScoredFinding } from '../findings/score.js';
import { fetchFileHistory } from '../github/history.js';
import { parseGeneratedPaths } from '../git/gitattributes.js';
import type { RepoContext } from '../git/repo.js';
import type { GitHubClient } from '../github/client.js';
import { readContent, type ContentsApi } from '../github/contents.js';
import { fetchPullContext, type GraphQlFn } from '../github/graphql.js';
import { submitReview, type ReviewSubmitter } from '../github/submit.js';
import type { CheckRun, PullRequestDetail, ReviewThread } from '../github/types.js';
import type { GroupCache } from '../group/cache.js';
import { groupByDirectory } from '../group/fallback.js';
import { keptHunks, runGrouping } from '../group/index.js';
import { layoutSections, type LayoutSection } from '../group/layout.js';
import type { GroupingResult } from '../group/types.js';
import type { VerdictCache } from '../meat/cache.js';
import { computeMeat, type MeatResult } from '../meat/index.js';
import { demoteUnanchorable } from '../review/anchors.js';
import { buildReviewPayload } from '../review/payload.js';
import { readConventions, SCORE_THRESHOLD, type Effort } from '../review/rubric.js';
import type { ReviewDraft, Side, StagedComment, Verdict } from '../review/types.js';
import { blockedForAuthor, authorBlockReason } from '../review/verdicts.js';
import { resolveSource, type ReviewSource, type SourceKind, type SourceRequest } from '../source/index.js';
import { carryOver, type ReviewStore } from '../store/review.js';
import type { PassSettings } from './passes.js';
import { initialSteps, setStep, type Step, type StepId, type StepState } from './steps.js';

export interface SessionConfig {
  model: string;
  meatModel: string;
  /** The parallel reviewers; /code-review runs them on Sonnet. */
  reviewModel: string;
  /** Scoring one finding is narrow work, and there is one scorer per finding. */
  verifyModel: string;
  effort: Effort;
  /** Team standards from `--standards`, already loaded. */
  standards: string;
  source: SourceRequest;
  passes: PassSettings;
}

export interface SessionDeps {
  client: Pick<GitHubClient, 'getPull' | 'listCommitSubjects'>;
  graphql: GraphQlFn;
  contents: ContentsApi;
  submitter: ReviewSubmitter;
  transport: AgentTransport;
  store: Pick<ReviewStore, 'load' | 'save' | 'findPreviousHead' | 'clear'>;
  meatCache: VerdictCache;
  groupCache: GroupCache;
  findingsCache: FindingsCache;
  /** A local clone of this pull request's repository, or null. */
  repo: RepoContext | null;
  viewer: string;
  config: SessionConfig;
  resolveSource?: typeof resolveSource;
  now?: () => number;
}

export interface Note {
  tone: 'info' | 'pending' | 'danger';
  text: string;
}

/** `off`: the find pass was switched off for this review, which is not the same as finding nothing. */
export type FindingsStatus = 'idle' | 'finding' | 'verifying' | 'done' | 'failed' | 'off';

export interface FindingsState {
  status: FindingsStatus;
  items: TriagedFinding[];
  error: AgentFailure | null;
}

export type PullInfo = Omit<PullRequestDetail, 'diff'>;

export interface SessionSnapshot {
  id: string;
  owner: string;
  repo: string;
  number: number;
  steps: Step[];
  pr: PullInfo | null;
  meat: MeatResult | null;
  /** Path → hash of the file's diff, to compare against `viewed`. */
  fileHashes: Record<string, string>;
  threads: ReviewThread[];
  checks: CheckRun[];
  source: { kind: SourceKind; canSearch: boolean } | null;
  grouping: Omit<GroupingResult, 'groups'> | null;
  sections: LayoutSection[];
  findings: FindingsState;
  /** The reviewer's own comments; accepted findings live in `findings` until submit. */
  draft: ReviewDraft;
  viewed: Record<string, string>;
  chat: { session: ChatSession; pending: boolean };
  notes: Note[];
  submitted: { url: string; verdict: Verdict } | null;
  loadError: string | null;
  /** What each model pass has spent so far. */
  usage: UsageReport;
  /** Results reused from an earlier run instead of paid for again: how many reviewers, and how many scores. */
  fromCache: { find: number; verify: number };
  /** Findings scored below this fold into "Low confidence"; set by `--effort`. */
  scoreThreshold: number;
  usageTotal: PassUsage;
}

export type SessionListener = (patch: Partial<SessionSnapshot>) => void;

export type TriageAction = 'accept' | 'drop' | 'edit' | 'suggest' | 'reset';

export function fileHash(file: DiffFile): string {
  const body = file.hunks.flatMap((h) => [h.header, ...h.lines.map((l) => `${l.kind}:${l.text}`)]).join('\n');
  return createHash('sha256').update(`${file.path}\n${body}`).digest('hex').slice(0, 16);
}

/**
 * Carries the reviewer's decisions across a list that was replaced underneath
 * them — scores land seconds after the findings do, and an accept made
 * in between must survive it.
 */
export function mergeTriage(current: TriagedFinding[], next: ScoredFinding[]): TriagedFinding[] {
  const byId = new Map(current.map((f) => [f.id, f]));
  return next.map((f) => {
    const prev = byId.get(f.id);
    return prev
      ? { ...f, state: prev.state, editedBody: prev.editedBody, asSuggestion: prev.asSuggestion }
      : { ...f, state: 'pending', editedBody: null, asSuggestion: false };
  });
}

/**
 * A restored draft holds accepted findings as plain comments, because that is
 * what gets submitted. When the findings come back with the same ids, they
 * return to being findings — accepted, with the reviewer's wording — rather
 * than appearing twice.
 */
export function absorbAccepted(
  findings: TriagedFinding[],
  draft: ReviewDraft,
): { findings: TriagedFinding[]; draft: ReviewDraft } {
  const byId = new Map(draft.comments.map((c) => [c.id, c]));
  const absorbed = new Set<string>();
  const next = findings.map((f) => {
    const c = byId.get(f.id);
    if (!c) return f;
    absorbed.add(f.id);
    return {
      ...f,
      state: 'accepted' as const,
      editedBody: c.body === f.body ? null : c.body,
      asSuggestion: c.suggestion !== null,
    };
  });
  return { findings: next, draft: { ...draft, comments: draft.comments.filter((c) => !absorbed.has(c.id)) } };
}

/** Everything that would be submitted: the reviewer's comments plus accepted findings. */
export function fullDraft(draft: ReviewDraft, findings: TriagedFinding[]): ReviewDraft {
  const seen = new Set(draft.comments.map((c) => c.id));
  const accepted = toStagedComments(findings).filter((c) => !seen.has(c.id));
  return { ...draft, comments: [...draft.comments, ...accepted] };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const EMPTY_DRAFT: ReviewDraft = { verdict: null, body: '', comments: [] };

/**
 * One pull request under review: the load sequence, the model passes, and the
 * reviewer's state. Lives in core so any frontend — the web page today, a
 * desktop shell later — drives the same thing. Every change is announced as a
 * patch of the snapshot.
 *
 * The model passes are additive: each one can fail, and each failure costs
 * only what that pass would have added.
 */
export class ReviewSession {
  private state: SessionSnapshot;
  private readonly listeners = new Set<SessionListener>();
  private source: ReviewSource | null = null;
  private files: DiffFile[] = [];
  private findingsRun = 0;
  private chatRun = 0;
  private readonly meter: UsageMeter;

  constructor(
    readonly id: string,
    owner: string,
    repo: string,
    number: number,
    private readonly deps: SessionDeps,
  ) {
    this.state = {
      id, owner, repo, number,
      steps: initialSteps(),
      pr: null, meat: null, fileHashes: {}, threads: [], checks: [], source: null,
      grouping: null, sections: [],
      findings: { status: 'idle', items: [], error: null },
      draft: EMPTY_DRAFT, viewed: {},
      chat: { session: { id: null, turns: [] }, pending: false },
      notes: [], submitted: null, loadError: null, usage: {}, usageTotal: totalUsage({}),
      fromCache: { find: 0, verify: 0 },
      scoreThreshold: SCORE_THRESHOLD[deps.config.effort],
    };
    this.meter = new UsageMeter((usage) => this.patch({ usage, usageTotal: totalUsage(usage) }));
  }

  snapshot(): SessionSnapshot {
    return this.state;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private patch(change: Partial<SessionSnapshot>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(change);
  }

  private step(id: StepId, state: StepState, detail?: string | null): void {
    this.patch({ steps: setStep(this.state.steps, id, state, this.now(), detail) });
  }

  private note(note: Note): void {
    this.patch({ notes: [...this.state.notes, note] });
  }

  /** Runs the load sequence, then starts the model passes without waiting for them. */
  async load(): Promise<void> {
    const { deps } = this;
    const { owner, repo, number } = this.state;
    try {
      this.step('pull', 'running');
      const pr = await deps.client.getPull(owner, repo, number, deps.viewer);
      const { diff, ...info } = pr;
      this.patch({ pr: info });
      this.step('pull', 'done', `${pr.changedFiles} files, +${pr.additions} −${pr.deletions}`);

      this.step('context', 'running');
      const context = await fetchPullContext(deps.graphql, owner, repo, number);
      this.patch({ threads: context.threads, checks: context.checks });
      this.step('context', 'done', `${context.threads.length} threads, ${context.checks.length} checks`);
      if (context.viewerPendingReviewId !== null) {
        this.note({ tone: 'pending', text: 'There is an unsubmitted review on this pull request from github.com; submitting here creates a separate one.' });
      }

      this.step('source', 'running');
      const resolve = deps.resolveSource ?? resolveSource;
      const { source, degraded } = await resolve({
        requested: deps.config.source,
        repo: deps.repo,
        pr: { owner, repo, number, headSha: pr.headSha },
        api: deps.contents,
      });
      this.source = source;
      this.patch({ source: { kind: source.kind, canSearch: source.canSearch } });
      const short = pr.headSha.slice(0, 7);
      const where = source.kind === 'checkout' ? `current checkout at ${short}`
        : source.kind === 'worktree' ? `git worktree at ${short}`
          : `GitHub API at ${short} — the agent can read files but not search`;
      this.step('source', 'done', where);
      if (degraded) this.note({ tone: 'info', text: degraded });

      this.step('abridge', 'running', `abridging ${pr.changedFiles} file${pr.changedFiles === 1 ? '' : 's'}`);
      const gitattributes = await source.readHead('.gitattributes').catch(() => null);
      this.files = parseUnifiedDiff(diff);
      const meat = await computeMeat({
        files: this.files,
        ruleContext: { generatedPaths: parseGeneratedPaths(gitattributes ?? '') },
        transport: this.meter.transport('abridge', deps.transport),
        cache: deps.meatCache,
        model: deps.config.meatModel,
        prTitle: pr.title,
        prBody: pr.body,
        classify: deps.config.passes.abridge,
      });
      const fileHashes = Object.fromEntries(meat.files.map((f) => [f.file.path, fileHash(f.file)]));
      this.patch({ meat, fileHashes, sections: layoutSections(meat, []) });
      if (meat.classifierSkipped) {
        this.step('abridge', 'skipped', `rules only — ${meat.unclassified} hunk${meat.unclassified === 1 ? '' : 's'} kept unjudged`);
      } else {
        this.step('abridge', meat.classifierError ? 'failed' : 'done',
          meat.classifierError
            ? `${meat.unclassified} hunks kept unjudged — ${meat.classifierError.summary}`
            : `kept ${meat.keptLines}/${meat.totalLines} lines`);
      }

      await this.restoreDraft(pr, meat).catch(() => {});
    } catch (error) {
      this.patch({ loadError: `Could not load #${number}: ${message(error)}` });
      return;
    }

    void this.runGroup();
    if (deps.config.passes.find) {
      void this.runFind();
    } else {
      this.patch({ findings: { status: 'off', items: [], error: null } });
      this.step('find', 'skipped', 'switched off');
      this.step('verify', 'skipped', 'switched off');
    }
  }

  private async restoreDraft(pr: PullRequestDetail, meat: MeatResult): Promise<void> {
    const { store } = this.deps;
    const { owner, repo } = this.state;
    const saved = await store.load(owner, repo, pr.number, pr.headSha);
    if (saved) {
      this.patch({ draft: saved.draft, viewed: saved.viewed ?? {} });
      const count = saved.draft.comments.length;
      if (count > 0) this.note({ tone: 'pending', text: `Restored ${count} unsubmitted comment(s) from your last session.` });
      return;
    }
    const previous = await store.findPreviousHead(owner, repo, pr.number, pr.headSha);
    if (!previous || previous.draft.comments.length === 0) return;
    const { carried, orphaned } = carryOver(previous.draft, meat.files.map((f) => f.file));
    this.patch({ draft: { ...previous.draft, comments: carried } });
    const lost = orphaned.length > 0 ? `; ${orphaned.length} no longer anchor to this diff and were dropped` : '';
    this.note({ tone: 'pending', text: `Carried ${carried.length} comment(s) over from an earlier head${lost}.` });
  }

  private async runGroup(): Promise<void> {
    const { pr, meat, owner, repo, number } = this.state;
    if (!pr || !meat || !this.source) return;
    if (!this.deps.config.passes.group) {
      const groups = groupByDirectory(keptHunks(meat));
      this.patch({ grouping: { overallSummary: meat.summary, source: 'directory', error: null }, sections: layoutSections(meat, groups) });
      this.step('group', 'skipped', 'switched off — grouped by directory');
      return;
    }
    this.step('group', 'running');
    const commits = await this.deps.client.listCommitSubjects(owner, repo, number);
    const result = await runGrouping({
      prTitle: pr.title, prBody: pr.body, commits, meat,
      transport: this.meter.transport('group', this.deps.transport),
      model: this.deps.config.meatModel,
      cache: this.deps.groupCache,
      cwd: this.source.access.cwd,
    });
    const { groups, ...grouping } = result;
    this.patch({ grouping, sections: layoutSections(meat, groups) });
    if (result.source === 'directory') {
      this.step('group', 'failed', `grouped by directory — ${result.error?.summary ?? 'model grouping failed'}`);
    } else {
      this.step('group', 'done', result.source === 'single' ? 'small change, one group' : `${groups.length} groups`);
    }
  }

  /**
   * Everything the reviewers read, fetched once. Each piece degrades on its own: a
   * failed history request leaves those reviewers nothing to do, not the review broken.
   */
  private async gatherContext(pr: PullInfo, meat: MeatResult, source: ReviewSource): Promise<ReviewContext> {
    const { deps } = this;
    const { owner, repo, number } = this.state;
    const changed = meat.files.map((f) => f.file.path);
    const [conventions, read, history] = await Promise.all([
      readConventions((path) => readContent(deps.contents, owner, repo, path, pr.baseSha || pr.baseRef), changed),
      readChangedFiles(filesToRead(meat), (path) => source.readHead(path)),
      fetchFileHistory(deps.graphql, owner, repo, pr.baseSha, changed, number).catch(() => []),
    ]);
    return {
      prTitle: pr.title,
      prBody: pr.body,
      meat,
      threads: this.state.threads,
      failingChecks: this.state.checks.filter((c) => c.conclusion === 'failure'),
      effort: deps.config.effort,
      standards: deps.config.standards,
      conventions,
      files: read.files,
      omittedFiles: read.omitted,
      history,
    };
  }

  private async runFind(fresh = false): Promise<void> {
    const { pr, meat } = this.state;
    const source = this.source;
    if (!pr || !meat || !source) return;
    const run = ++this.findingsRun;
    const { deps } = this;
    const current = () => run === this.findingsRun;

    this.step('find', 'running', 'gathering context');
    this.step('verify', 'pending', null);
    this.patch({ findings: { status: 'finding', items: [], error: null }, fromCache: { find: 0, verify: 0 } });

    const ctx = await this.gatherContext(pr, meat, source);
    if (!current()) return;
    let lastError: unknown = null;
    const result = await runFindings(this.meter.transport('find', deps.transport), deps.config.reviewModel, ctx, source.access, {
      cache: deps.findingsCache,
      fresh,
      onError: (_lens, e) => { lastError = e; },
      onProgress: (p) => {
        if (current()) this.step('find', 'running', `${p.done}/${p.total} reviewers done${p.activity ? ` · ${p.activity}` : ''}`);
      },
    });
    if (!current()) return;

    if (result.ran.length > 0 && result.failed.length === result.ran.length) {
      const error = describeAgentFailure(lastError);
      this.patch({ findings: { status: 'failed', items: [], error } });
      this.step('find', 'failed', error.summary);
      this.step('verify', 'skipped');
      return;
    }
    if (result.failed.length > 0) {
      this.note({ tone: 'info', text: `The ${result.failed.join(', ')} reviewer${result.failed.length === 1 ? '' : 's'} failed; findings from the others are shown.` });
    }

    const found = result.findings;
    const unscored = found.map((f) => ({ ...f, score: null, scoreReason: null }));
    const absorbed = absorbAccepted(initTriage(unscored), this.state.draft);
    this.patch({ draft: absorbed.draft, findings: { status: 'verifying', items: absorbed.findings, error: null }, fromCache: { find: result.cached, verify: 0 } });
    const reused = result.cached > 0 ? ` · ${result.cached} from cache` : '';
    this.step('find', 'done', `${found.length} finding${found.length === 1 ? '' : 's'} from ${result.ran.length} reviewer${result.ran.length === 1 ? '' : 's'}${reused}`);

    const toScore = found.filter(isScorable).length;
    if (toScore === 0) {
      this.patch({ findings: { ...this.state.findings, status: 'done' } });
      this.step('verify', 'skipped', found.length === 0 ? null : 'only questions, which are not scored');
      return;
    }

    if (!deps.config.passes.verify) {
      this.patch({ findings: { ...this.state.findings, status: 'done' } });
      this.step('verify', 'skipped', 'switched off — findings are unscored');
      return;
    }

    this.step('verify', 'running', `0/${toScore} scored`);
    const files = this.files;
    const scored = await runScore(this.meter.transport('verify', deps.transport), deps.config.verifyModel, found, source.access, {
      excerpt: (f) => anchorExcerpt(files, f),
      conventions: ctx.conventions,
      standards: ctx.standards,
      cache: deps.findingsCache,
      fresh,
      onProgress: (done, total) => {
        if (current()) this.step('verify', 'running', `${done}/${total} scored`);
      },
    });
    if (!current()) return;
    const items = mergeTriage(this.state.findings.items, scored.scored);
    this.patch({ findings: { status: 'done', items, error: null }, fromCache: { ...this.state.fromCache, verify: scored.cached } });
    const threshold = this.state.scoreThreshold;
    const low = scored.scored.filter((f) => f.score !== null && f.score < threshold).length;
    const failedScores = scored.scored.filter((f) => isScorable(f) && f.score === null).length;
    const parts = [
      low > 0 ? `${low} below ${threshold}` : `all at or above ${threshold}`,
      ...(failedScores > 0 ? [`${failedScores} unscored`] : []),
      ...(scored.cached > 0 ? [`${scored.cached} from cache`] : []),
    ];
    this.step('verify', failedScores === toScore ? 'failed' : 'done', parts.join(' · '));
  }

  /** An explicit request for a fresh answer, so it skips the cache (and replaces what is there). */
  retryFindings(): void {
    void this.runFind(true);
  }

  private persist(): void {
    const { pr, owner, repo, draft, viewed, findings } = this.state;
    if (!pr) return;
    void this.deps.store.save({
      version: 1, owner, repo, number: pr.number, headSha: pr.headSha,
      draft: fullDraft(draft, findings.items),
      viewed,
      updatedAt: new Date().toISOString(),
    }).catch(() => {
      // Losing a draft is bad; failing the edit over it is worse.
    });
  }

  updateDraft(draft: ReviewDraft): void {
    this.patch({ draft });
    this.persist();
  }

  triage(findingId: string, action: TriageAction, body?: string): void {
    const items = this.state.findings.items;
    if (!items.some((f) => f.id === findingId)) throw new Error(`No finding ${findingId}`);
    const next = action === 'accept' ? accept(items, findingId)
      : action === 'drop' ? drop(items, findingId)
        : action === 'edit' ? edit(items, findingId, body ?? '')
          : action === 'suggest' ? accept(toggleSuggestion(items, findingId), findingId)
            : items.map((f) => (f.id === findingId ? { ...f, state: 'pending' as const, editedBody: null, asSuggestion: false } : f));
    this.patch({ findings: { ...this.state.findings, items: next } });
    this.persist();
  }

  setViewed(path: string, viewed: boolean): void {
    const hash = this.state.fileHashes[path];
    if (!hash) throw new Error(`${path} is not part of this pull request`);
    const next = { ...this.state.viewed };
    if (viewed) next[path] = hash; else delete next[path];
    this.patch({ viewed: next });
    this.persist();
  }

  async ask(question: string, context?: string, fresh = false): Promise<void> {
    if (!this.source) throw new Error('The pull request has not loaded yet.');
    const run = ++this.chatRun;
    const session: ChatSession = fresh ? { id: null, turns: [] } : this.state.chat.session;
    this.patch({ chat: { session: { ...session, turns: [...session.turns, { role: 'user', text: question }] }, pending: true } });
    const answered = await askAgent(this.meter.transport('chat', this.deps.transport), this.deps.config.model, session, question, this.source.access, context);
    // A newer question replaced this one; its answer would land in the wrong conversation.
    if (run !== this.chatRun) return;
    this.patch({ chat: { session: answered, pending: false } });
  }

  async readFile(path: string, side: Side): Promise<string | null> {
    const { pr, owner, repo } = this.state;
    if (!pr || !this.source) return null;
    if (side === 'RIGHT') return this.source.readHead(path);
    const file = this.files.find((f) => f.path === path);
    return readContent(this.deps.contents, owner, repo, file?.oldPath ?? path, pr.baseSha || pr.baseRef);
  }

  /** Throws with a message fit to show: GitHub rejects a bad review atomically, so it is checked here first. */
  async submit(verdict: Verdict, body: string): Promise<{ url: string; demoted: StagedComment[] }> {
    const { pr, owner, repo } = this.state;
    if (!pr) throw new Error('The pull request has not loaded yet.');
    if (blockedForAuthor(verdict, pr.viewerIsAuthor)) throw new Error(authorBlockReason(verdict));

    const draft = fullDraft({ ...this.state.draft, verdict, body }, this.state.findings.items);
    // A comment GitHub will not anchor is still worth telling the author, so it
    // moves into the review body rather than being discarded.
    const { draft: adjusted, demoted } = demoteUnanchorable(draft, this.files);
    const payload = buildReviewPayload(adjusted, this.files);
    const result = await submitReview(this.deps.submitter, owner, repo, pr.number, payload);
    // On GitHub now; keeping it on disk would resurrect it next time.
    await this.deps.store.clear(owner, repo, pr.number, pr.headSha).catch(() => {});
    this.patch({ submitted: { url: result.htmlUrl, verdict } });
    return { url: result.htmlUrl, demoted };
  }
}
