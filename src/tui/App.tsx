import { createHash } from 'node:crypto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin, useWindowSize } from 'ink';
import TextInput from 'ink-text-input';
import type { AgentTransport } from '../core/agent/types.js';
import type { Hunk } from '../core/diff/types.js';
import { ask as askAgent, buildChatContext, type ChatSession } from '../core/findings/chat.js';
import { runFindings } from '../core/findings/find.js';
import {
  accept, drop, edit, initTriage, toStagedComments, toggleSuggestion, visibleFindings,
  type TriagedFinding,
} from '../core/findings/triage.js';
import { runVerify, type VerifiedFinding } from '../core/findings/verify.js';
import type {
  CheckRun, PullFilter, PullRequestDetail, PullRequestSummary, ReviewThread,
} from '../core/github/types.js';
import type { MeatResult } from '../core/meat/index.js';
import type { ReviewDraft, Side, StagedComment, Verdict } from '../core/review/types.js';
import {
  buildUnits, nextFileIndex, nextFindingIndex, prevFileIndex, prevFindingIndex, type ReviewUnit,
} from './units.js';
import { editInEditor } from './editor.js';
import { indexAtRow, nextRowScrollTop, nextScrollTop, rowOffsets } from './viewport.js';
import { resolveAction, type Mode } from './keymap.js';
import type { LoadProgress } from './progress.js';
import { filterPrs } from './search.js';
import { ChatPane } from './components/ChatPane.js';
import { CommentEditor } from './components/CommentEditor.js';
import { Detail, detailHeaderRows, unitHeights } from './components/Detail.js';
import { Help } from './components/Help.js';
import { LoadingSteps } from './components/LoadingSteps.js';
import { PrList, visibleEntryCount } from './components/PrList.js';
import { StatusBar } from './components/StatusBar.js';
import { SubmitScreen } from './components/SubmitScreen.js';
import { theme } from './theme.js';

export interface AppProps {
  repoLabel: string;
  prs: PullRequestSummary[];
  pr: PullRequestDetail | null;
  meat: MeatResult | null;
  checks: CheckRun[];
  threads: ReviewThread[];
  model: string;
  worktreeOk: boolean;
  filter: PullFilter;
  /** One-line note: loading, a load failure, a pending web-UI review. */
  status?: string | null;
  /**
   * Staged progress while a pull request opens. Rendered in place of the detail
   * pane until the diff arrives — a reviewer who cannot tell fetching from a
   * freeze kills the process.
   */
  progress?: LoadProgress | null;
  /**
   * How to read `status`. `muted` is progress, `pending` is unsubmitted work,
   * `danger` is a failure — yellow is reserved for the first of those, so a
   * load error wearing it says the wrong thing.
   */
  statusTone?: 'muted' | 'pending' | 'danger';
  /**
   * Transport for the findings, verify, and chat passes. All three are
   * additive: leave it out and the review works exactly as it always has,
   * minus the model's opinions.
   */
  transport?: AgentTransport | null;
  /**
   * Worktree checked out at the head commit, which the agent reads. Null in
   * diff-only mode — the agent would otherwise read the wrong commit and
   * reason confidently about code that is not in this pull request.
   */
  cwd?: string | null;
  /**
   * A draft recovered from disk for this pull request, or carried over from an
   * earlier head. Null starts clean.
   */
  initialDraft?: ReviewDraft | null;
  onOpenPr: (number: number) => void;
  onSubmit: (draft: ReviewDraft, verdict: Verdict) => void;
  onFilter?: (filter: PullFilter) => void;
  onRefresh?: () => void;
  onOpenUrl?: (url: string) => void;
  /** Called whenever staged work changes, and once more before quitting. */
  onPersist?: (draft: ReviewDraft) => void;
  /** The reviewer chose to throw the draft away rather than keep it. */
  onDiscard?: () => void;
  /**
   * Opens `initial` in the reviewer's editor. Injected only by tests — the
   * default really does spawn `$EDITOR`, which no test may do.
   */
  editText?: (initial: string) => Promise<string>;
}

/** Where a staged comment attaches, in GitHub's own terms. */
export interface CommentAnchor {
  path: string;
  line: number;
  side: Side;
}

/** Same order as the submit screen renders them, so j/k matches what you see. */
const VERDICTS: readonly Verdict[] = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];

/** `danger` is red AND bold; the weight is what separates it from `del`. */
function toneStyle(tone: 'muted' | 'pending' | 'danger') {
  if (tone === 'danger') return { color: theme.color.danger, bold: true };
  if (tone === 'pending') return { color: theme.color.pending };
  return theme.tier.muted;
}

export function clampCursor(cursor: number, length: number): number {
  return Math.min(Math.max(cursor, 0), Math.max(0, length - 1));
}

function anchorInHunk(path: string, hunk: Hunk): CommentAnchor | null {
  // The last changed line is where a reader's eye ends up, and it is always
  // anchorable; a context line often is too, but it is rarely what was meant.
  const changed = hunk.lines.filter((l) => l.kind !== 'context');
  const line = changed.at(-1) ?? hunk.lines.at(-1);
  if (!line) return null;
  if (line.newLine !== null) return { path, line: line.newLine, side: 'RIGHT' };
  if (line.oldLine !== null) return { path, line: line.oldLine, side: 'LEFT' };
  return null;
}

/**
 * Resolves the cursor's review unit to a comment anchor. A file header or a
 * folded-noise row has no line of its own, so it borrows the file's first hunk
 * rather than refusing to accept a comment.
 */
export function anchorForUnit(unit: ReviewUnit | undefined): CommentAnchor | null {
  if (!unit) return null;
  const path = unit.file.file.path;
  if (unit.kind === 'hunk') return anchorInHunk(path, unit.hunk.hunk);
  const first = unit.file.hunks[0];
  return first ? anchorInHunk(path, first.hunk) : null;
}

/** GitHub keys a file's diff anchor by the sha256 of its path. */
export function hunkUrl(repoLabel: string, prNumber: number, anchor: CommentAnchor): string {
  const digest = createHash('sha256').update(anchor.path).digest('hex');
  const sideMark = anchor.side === 'LEFT' ? 'L' : 'R';
  return `https://github.com/${repoLabel}/pull/${prNumber}/files#diff-${digest}${sideMark}${anchor.line}`;
}

/**
 * Carries triage the reviewer already did onto the verified findings that
 * replace them. Verification takes tens of seconds and the findings are on
 * screen throughout; accepting one while it runs must survive the verdicts
 * landing.
 */
export function mergeTriage(held: TriagedFinding[], verified: VerifiedFinding[]): TriagedFinding[] {
  const byId = new Map(held.map((f) => [f.id, f]));
  return initTriage(verified).map((f) => {
    const prior = byId.get(f.id);
    return prior
      ? { ...f, state: prior.state, editedBody: prior.editedBody, asSuggestion: prior.asSuggestion }
      : f;
  });
}

/**
 * The hunk under the cursor, as text a model can read. A finding row or a file
 * header borrows the file's first hunk — the same fallback anchoring uses.
 */
export function chatContextForUnit(unit: ReviewUnit | undefined): string | null {
  if (!unit) return null;
  const hunk = unit.kind === 'hunk' ? unit.hunk.hunk : unit.file.hunks[0]?.hunk;
  if (!hunk) return null;
  return buildChatContext({
    path: unit.file.file.path,
    header: hunk.header,
    lines: hunk.lines.map((l) => ({ kind: l.kind, text: l.text })),
  });
}

interface ChatOverlayProps {
  session: ChatSession;
  pending: boolean;
  onAsk: (question: string) => void;
  onClose: () => void;
}

/** ChatPane plus a prompt line. The prompt is `structure`, the hint `muted` —
 *  the same two tokens the comment editor uses, because it is the same act. */
function ChatOverlay({ session, pending, onAsk, onClose }: ChatOverlayProps) {
  const [value, setValue] = useState('');

  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  return (
    <Box flexDirection="column">
      <Text color={theme.color.structure}>Ask about this hunk</Text>
      <ChatPane session={session} pending={pending} />
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={() => {
          const question = value.trim();
          setValue('');
          if (question.length > 0) onAsk(question);
        }}
      />
      <Text {...theme.tier.muted}>enter to ask · esc to close</Text>
    </Box>
  );
}

export function App(props: AppProps) {
  const { exit } = useApp();
  const { setRawMode, isRawModeSupported } = useStdin();
  const { columns, rows } = useWindowSize();

  const [mode, setMode] = useState<Mode>(props.pr ? 'detail' : 'list');
  /** Where esc returns to from an overlay, so help never strands you. */
  const [underlay, setUnderlay] = useState<Mode>('list');
  const [listCursor, setListCursor] = useState(0);
  const [listScroll, setListScroll] = useState(0);
  const [unitCursor, setUnitCursor] = useState(0);
  const [unitScroll, setUnitScroll] = useState(0);
  const [query, setQuery] = useState('');
  const [expandedFiles, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [foldedFiles, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [showThreads, setShowThreads] = useState(false);
  const [draft, setDraft] = useState<ReviewDraft>({ verdict: null, body: '', comments: [] });
  const [verdict, setVerdict] = useState<Verdict>('COMMENT');
  const [pending, setPending] = useState<{ anchor: CommentAnchor; isSuggestion: boolean } | null>(null);
  /** True while `$EDITOR` owns the terminal; Ink must not repaint over it. */
  const [editorOpen, setEditorOpen] = useState(false);
  /** Set by `q` when there is work on screen that has not been submitted. */
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [findings, setFindings] = useState<TriagedFinding[]>([]);
  /**
   * `ok` and `failed` are the whole point: `runFindings` returns `[]` both when
   * the model found nothing and when it never ran, so without this a dead
   * transport looked exactly like a clean pull request.
   */
  const [findingsStatus, setFindingsStatus] = useState<'idle' | 'running' | 'ok' | 'failed'>('idle');
  /** Bumped by `R`, which is what re-runs the pass after a failure. */
  const [findingsAttempt, setFindingsAttempt] = useState(0);
  const [showRefuted, setShowRefuted] = useState(false);
  const [chat, setChat] = useState<ChatSession>({ id: null, turns: [] });
  const [chatPending, setChatPending] = useState(false);
  /** The hunk the open chat is about; moving to another one starts fresh. */
  const [chatAnchor, setChatAnchor] = useState<string | null>(null);
  /**
   * Bumped whenever the conversation an answer would belong to stops being the
   * one on screen. Without it, escaping a pending question, moving to another
   * hunk, and reopening chat let the first hunk's answer land in the second
   * hunk's pane — and the next question then resumed that session, putting the
   * wrong code in front of the model.
   */
  const chatToken = useRef(0);

  const visiblePrs = useMemo(() => filterPrs(props.prs, query), [props.prs, query]);
  const shownFindings = useMemo(
    () => visibleFindings(findings, showRefuted),
    [findings, showRefuted],
  );
  const units = useMemo(
    () => (props.meat
      ? buildUnits(props.meat, { expandedFiles, foldedFiles, findings: shownFindings })
      : []),
    [props.meat, expandedFiles, foldedFiles, shownFindings],
  );
  /**
   * Rows each unit occupies. The detail pane's budget is in terminal rows and a
   * unit is anywhere from one row to a whole screen, so scrolling has to be
   * measured the same way the pane renders.
   */
  const unitRows = useMemo(
    () => unitHeights(units, props.threads, showThreads),
    [units, props.threads, showThreads],
  );
  /**
   * Manual comments plus every accepted finding, in one list, once. A restored
   * draft already holds the comment an accepted finding produced, so the id
   * decides: the same finding cannot be staged twice by being reloaded.
   */
  const staged = useMemo(() => {
    const byId = new Map<string, StagedComment>();
    for (const comment of [...draft.comments, ...toStagedComments(findings)]) {
      byId.set(comment.id, comment);
    }
    return [...byId.values()];
  }, [draft.comments, findings]);
  const fullDraft = useMemo(() => ({ ...draft, comments: staged }), [draft, staged]);

  // One row for the horizontal rule, one for the status line.
  const bodyHeight = Math.max(1, rows - 2);
  const listRows = visibleEntryCount(bodyHeight, mode === 'search');
  // Notes render under the detail pane, so the pane's budget pays for them —
  // otherwise adding one pushes the status bar off the bottom again. Scrolling
  // and rendering must agree on this number or the cursor leaves the window.
  const findingsFailed = findingsStatus === 'failed';
  const noteRows = (props.status ? 1 : 0) + (findingsFailed ? 1 : 0);
  const detailHeight = Math.max(0, bodyHeight - noteRows);
  const detailRows = props.meat
    ? Math.max(0, detailHeight - detailHeaderRows(props.meat, props.checks))
    : 0;

  // Folding shrinks the unit list under the cursor, and a query shrinks the
  // pull-request list under it; clamp on the way out rather than trusting the
  // stored index anywhere downstream.
  const prCursor = clampCursor(listCursor, visiblePrs.length);
  const cursor = clampCursor(unitCursor, units.length);

  // A newly opened pull request starts at the top of its own diff.
  const openNumber = props.pr?.number ?? null;
  useEffect(() => {
    if (openNumber === null) return;
    setUnitCursor(0);
    setUnitScroll(0);
    setConfirmQuit(false);
    setMode('detail');
  }, [openNumber]);

  // A draft recovered from disk, or carried over from an earlier head. Keyed on
  // the object rather than the number: it arrives after the pull request does.
  const { initialDraft } = props;
  useEffect(() => {
    setDraft(initialDraft ?? { verdict: null, body: '', comments: [] });
  }, [initialDraft]);

  // The two agent passes. Both swallow their own failures and yield nothing on
  // one, so every branch below renders identically whether they succeed, come
  // back empty, or never run — findings are additive, never load-bearing.
  const { transport, cwd, model } = props;
  const openPr = props.pr;
  const openMeat = props.meat;
  useEffect(() => {
    setFindings([]);
    setFindingsStatus('idle');
    if (!openPr || !openMeat || !transport || !cwd) return;

    let cancelled = false;
    let failed = false;
    setFindingsStatus('running');

    void (async () => {
      const found = await runFindings(
        transport,
        model,
        {
          prTitle: openPr.title,
          prBody: openPr.body,
          meat: openMeat,
          threads: props.threads,
          failingChecks: props.checks.filter((c) => c.conclusion === 'failure'),
        },
        cwd,
        () => {
          failed = true;
        },
      );
      if (cancelled) return;
      // "Found nothing" and "could not run" are different answers, and the
      // reviewer is entitled to know which one they got.
      setFindingsStatus(failed ? 'failed' : 'ok');
      if (found.length === 0) return;

      // Progressive reveal: findings appear the moment they exist and the
      // verifier's verdicts fill in behind them. `plausible` is what an
      // unverified finding is, and scoreVerdict says the same for no evidence.
      setFindings(
        initTriage(found.map((f) => ({ ...f, verdict: 'plausible' as const, refutations: [] }))),
      );

      const verified = await runVerify(transport, model, found, cwd);
      if (cancelled) return;
      setFindings((held) => mergeTriage(held, verified));
    })();

    return () => {
      cancelled = true;
    };
    // Threads and checks arrive with the pull request itself; keying on them
    // too would only re-bill the model for a review it already did.
  }, [openPr, openMeat, transport, cwd, model, findingsAttempt]);

  // Triage and staged comments are written through as they change, so closing
  // the laptop is not the same as throwing the review away. Nothing is written
  // for a review with no work in it — an empty file for every pull request
  // merely opened would make `findPreviousHead` useless.
  const { onPersist } = props;
  const hasUnsubmittedWork = staged.length > 0 || draft.body.trim().length > 0;
  useEffect(() => {
    if (!openPr || !hasUnsubmittedWork) return;
    onPersist?.(fullDraft);
  }, [fullDraft, openPr, hasUnsubmittedWork, onPersist]);

  // Findings arriving grows the unit list under the cursor and `v` shrinks it
  // again. The cursor indexes that list, so it and the viewport are pulled back
  // into range here rather than left pointing past the end.
  useEffect(() => {
    const clamped = clampCursor(unitCursor, units.length);
    setUnitCursor(clamped);
    setUnitScroll((prev) => nextRowScrollTop(unitRows, detailRows, clamped, prev));
  }, [units.length]);

  function moveList(next: number) {
    const clamped = clampCursor(next, visiblePrs.length);
    setListCursor(clamped);
    setListScroll((prev) => nextScrollTop(visiblePrs.length, listRows, clamped, prev));
  }

  function moveUnits(next: number) {
    const clamped = clampCursor(next, units.length);
    setUnitCursor(clamped);
    setUnitScroll((prev) => nextRowScrollTop(unitRows, detailRows, clamped, prev));
  }

  /**
   * Half a page of ROWS, not of units: a page of one-row file headers and a
   * page of forty-line hunks are the same distance on screen, and ctrl-d has to
   * mean the same thing in both.
   */
  function halfPage(dir: -1 | 1) {
    if (mode === 'list') return moveList(prCursor + dir * Math.floor(bodyHeight / 2));
    const from = rowOffsets(unitRows)[cursor] ?? 0;
    const target = indexAtRow(unitRows, from + dir * Math.floor(detailRows / 2));
    // A hunk taller than half a page would otherwise swallow the keystroke:
    // the target row is still inside the unit the cursor is already on.
    return moveUnits(target === cursor ? cursor + dir : target);
  }

  function move(next: number) {
    if (mode === 'list') moveList(next);
    else moveUnits(next);
  }

  function applyQuery(next: string) {
    setQuery(next);
    // The cursor indexes the filtered list, so narrowing must pull it back in
    // range immediately — otherwise enter opens whatever the stale index hits.
    const narrowed = filterPrs(props.prs, next);
    const clamped = clampCursor(listCursor, narrowed.length);
    setListCursor(clamped);
    setListScroll(nextScrollTop(narrowed.length, listRows, clamped, 0));
  }

  function toggleIn(set: ReadonlySet<string>, path: string): ReadonlySet<string> {
    const next = new Set(set);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  }

  function currentPath(): string | null {
    return units[cursor]?.file.file.path ?? null;
  }

  function revealAll() {
    const all = props.meat?.files.map((f) => f.file.path) ?? [];
    setExpanded((s) => (s.size === all.length ? new Set() : new Set(all)));
  }

  function enterOverlay(next: Mode) {
    setUnderlay(mode);
    setMode(next);
  }

  function startComment(isSuggestion: boolean) {
    const anchor = anchorForUnit(units[cursor]);
    if (!anchor) return;
    setPending({ anchor, isSuggestion });
    enterOverlay('comment');
  }

  function currentFinding(): TriagedFinding | null {
    const unit = units[cursor];
    return unit && unit.kind === 'finding' ? unit.finding : null;
  }

  /** Every triage key is a no-op unless the cursor is actually on a finding. */
  function triage(change: (list: TriagedFinding[], id: string) => TriagedFinding[]) {
    const finding = currentFinding();
    if (finding) setFindings((list) => change(list, finding.id));
  }

  /**
   * Rewrites a finding in the reviewer's real editor, not a one-line input —
   * these become review comments, and a comment worth writing is worth writing
   * in vim.
   *
   * Raw mode is suspended here rather than inside `editInEditor`, because the
   * terminal belongs to Ink and `editInEditor` must stay testable without one.
   * `null` is rendered meanwhile so Ink does not repaint over the editor.
   */
  async function startEdit() {
    const finding = currentFinding();
    if (!finding) return;
    const initial = finding.editedBody ?? finding.body;
    const open = props.editText ?? editInEditor;

    setPending(null);
    setEditorOpen(true);
    if (isRawModeSupported) setRawMode(false);

    let edited = initial;
    try {
      edited = await open(initial);
    } catch {
      // No editor on this machine, or it could not be spawned. The finding is
      // untouched, which is the same outcome as quitting without saving.
    } finally {
      if (isRawModeSupported) setRawMode(true);
      setEditorOpen(false);
    }

    // `editInEditor` returns the original text on a non-zero exit, so text that
    // came back unchanged is indistinguishable from a cancel and is treated as
    // one. Keeping the model's exact wording is what `a` is for.
    const body = edited.trim();
    if (body.length > 0 && body !== initial) {
      setFindings((list) => edit(list, finding.id, body));
    }
  }

  function openChat() {
    const context = chatContextForUnit(units[cursor]);
    if (context === null) return;
    // A question about a different hunk is a different conversation; resuming
    // the old session would answer it with the wrong code in view.
    if (context !== chatAnchor) {
      chatToken.current += 1;
      setChat({ id: null, turns: [] });
      setChatAnchor(context);
    }
    enterOverlay('chat');
  }

  async function askAboutHunk(question: string) {
    // One question in flight at a time: two racing answers would resolve in
    // whatever order the model happened to finish them.
    if (!transport || !cwd || chatAnchor === null || chatPending) return;
    // The hunk goes in only on the opening turn; after that the session
    // already has it and the model is resumed rather than re-primed.
    const sent = chat.turns.length === 0 ? `${chatAnchor}\n\nQuestion: ${question}` : question;
    const asked = chat.turns.length;
    const token = (chatToken.current += 1);

    setChatPending(true);
    const next = await askAgent(transport, model, chat, sent, cwd);
    setChatPending(false);
    // The cursor moved to another hunk while this was out. The answer is about
    // code the reviewer is no longer looking at, so it is dropped rather than
    // shown under the wrong diff.
    if (token !== chatToken.current) return;
    // The reviewer reads back their own question, not the hunk pasted around it.
    setChat({
      id: next.id,
      turns: next.turns.map((t, i) => (i === asked ? { ...t, text: question } : t)),
    });
  }

  function saveComment(body: string) {
    if (pending && body.trim().length > 0) {
      const comment: StagedComment = {
        id: `${pending.anchor.path}:${pending.anchor.line}:${draft.comments.length}`,
        path: pending.anchor.path,
        line: pending.anchor.line,
        side: pending.anchor.side,
        startLine: null,
        body: pending.isSuggestion ? '' : body,
        suggestion: pending.isSuggestion ? body : null,
      };
      setDraft((d) => ({ ...d, comments: [...d.comments, comment] }));
    }
    setPending(null);
    setMode('detail');
  }

  function moveVerdict(delta: number) {
    const from = VERDICTS.indexOf(verdict);
    for (let step = 1; step <= VERDICTS.length; step += 1) {
      const candidate = VERDICTS[
        (from + delta * step + VERDICTS.length * step) % VERDICTS.length
      ];
      if (!candidate) continue;
      // GitHub rejects approving your own pull request, so the option is not
      // merely dimmed — it cannot be landed on.
      if (candidate === 'APPROVE' && props.pr?.viewerIsAuthor) continue;
      setVerdict(candidate);
      return;
    }
  }

  useInput((input, key) => {
    // The comment editor and the chat prompt own every key while they are up,
    // including esc. `$EDITOR` owns the actual terminal.
    if (mode === 'comment' || mode === 'chat' || editorOpen) return;

    // `q` used to discard every triaged finding, staged comment, and chat turn
    // without a word. Three keys, and none of them lose work by accident.
    if (confirmQuit) {
      if (key.escape) return setConfirmQuit(false);
      if (key.return) {
        props.onPersist?.(fullDraft);
        return exit();
      }
      if (input === 'x') {
        props.onDiscard?.();
        return exit();
      }
      return;
    }

    if (mode === 'search') {
      if (key.escape) {
        applyQuery('');
        setMode('list');
        return;
      }
      if (key.return) return setMode('list');
      if (key.backspace || key.delete) return applyQuery(query.slice(0, -1));
      if (key.ctrl || key.meta || input.length === 0) return;
      return applyQuery(query + input);
    }

    if (mode === 'submit') {
      if (key.escape) return setMode('detail');
      if (key.return) return props.onSubmit(fullDraft, verdict);
      if (key.downArrow || input === 'j') return moveVerdict(1);
      if (key.upArrow || input === 'k') return moveVerdict(-1);
      return;
    }

    const action = resolveAction(input, key, mode);
    if (!action) return;

    switch (action.type) {
      case 'move':
        return move((mode === 'list' ? prCursor : cursor) + action.delta);
      case 'half-page':
        return halfPage(action.dir);
      case 'file':
        return moveUnits(
          action.dir === 1 ? nextFileIndex(units, cursor) : prevFileIndex(units, cursor),
        );
      case 'finding':
        return moveUnits(
          action.dir === 1 ? nextFindingIndex(units, cursor) : prevFindingIndex(units, cursor),
        );
      case 'accept-finding':
        return triage(accept);
      case 'drop-finding':
        return triage(drop);
      case 'toggle-finding-suggestion':
        return triage(toggleSuggestion);
      case 'edit-finding':
        void startEdit();
        return;
      case 'toggle-refuted':
        return setShowRefuted((v) => !v);
      case 'chat':
        return openChat();
      case 'open': {
        const selected = visiblePrs[prCursor];
        if (selected) props.onOpenPr(selected.number);
        return;
      }
      case 'toggle-fold': {
        const path = currentPath();
        if (path) setFolded((s) => toggleIn(s, path));
        return;
      }
      case 'toggle-dropped': {
        const path = currentPath();
        if (path) setExpanded((s) => toggleIn(s, path));
        return;
      }
      // `d` is the whole-diff view: with nothing dropped there is no meat cut
      // left to see, which is the same state `Z` produces.
      case 'toggle-full-diff':
      case 'toggle-dropped-all':
        return revealAll();
      case 'toggle-threads':
        return setShowThreads((v) => !v);
      case 'comment':
        return startComment(false);
      case 'suggest':
        return startComment(true);
      case 'open-browser': {
        const anchor = anchorForUnit(units[cursor]);
        if (anchor && props.pr) props.onOpenUrl?.(hunkUrl(props.repoLabel, props.pr.number, anchor));
        return;
      }
      case 'filter':
        return props.onFilter?.(action.filter);
      case 'refresh':
        // In the detail pane `R` is also how a failed model pass is retried;
        // the reviewer should not have to close and reopen the pull request.
        if (mode === 'detail') setFindingsAttempt((n) => n + 1);
        return props.onRefresh?.();
      case 'search':
        return enterOverlay('search');
      case 'submit-screen':
        if (props.pr && props.meat) enterOverlay('submit');
        return;
      case 'help':
        return enterOverlay('help');
      case 'back':
        if (mode === 'help') return setMode(underlay);
        if (mode === 'detail') return setMode('list');
        if (query.length > 0) return applyQuery('');
        return;
      case 'quit':
        if (hasUnsubmittedWork) return setConfirmQuit(true);
        return exit();
      default:
        return;
    }
  });

  // The editor has the terminal. Anything drawn here would land on top of it.
  if (editorOpen) return null;

  if (mode === 'help') return <Help />;

  if (mode === 'submit' && props.pr && props.meat) {
    return (
      <SubmitScreen
        draft={fullDraft}
        files={props.meat.files.map((f) => f.file)}
        viewerIsAuthor={props.pr.viewerIsAuthor}
        selected={verdict}
      />
    );
  }

  if (mode === 'comment' && pending) {
    return (
      <CommentEditor
        initial=""
        isSuggestion={pending.isSuggestion}
        onSubmit={saveComment}
        onCancel={() => {
          setPending(null);
          setMode('detail');
        }}
      />
    );
  }

  if (mode === 'chat') {
    return (
      <ChatOverlay
        session={chat}
        pending={chatPending}
        onAsk={(question) => void askAboutHunk(question)}
        onClose={() => setMode(underlay)}
      />
    );
  }

  const paneRule = Array.from({ length: bodyHeight }, () => theme.glyph.rule).join('\n');

  const notes = (
    <>
      {/* Truncate, never wrap: a note that takes two rows costs a row the
          viewport already spent, and the status bar pays for it. */}
      {props.status && (
        <Text {...toneStyle(props.statusTone ?? 'muted')} wrap="truncate">{props.status}</Text>
      )}
      {/* No spinner while it runs — verdicts fill in progressively and there is
          nothing to wait on. A pass that DIED is the one thing worth saying. */}
      {findingsFailed && (
        <Text color={theme.color.danger} bold wrap="truncate">
          Model pass failed — press R to retry.
        </Text>
      )}
    </>
  );

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexGrow={1}>
        <PrList
          prs={props.prs}
          cursor={mode === 'list' || mode === 'search' ? prCursor : -1}
          scrollTop={listScroll}
          height={bodyHeight}
          filter={props.filter}
          width={theme.layout.sidebarWidth}
          query={query}
          searching={mode === 'search'}
        />
        {/* The one vertical rule in the product: two panes, no boxes. */}
        <Box width={1} marginLeft={1}>
          <Text {...theme.tier.muted}>{paneRule}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} marginLeft={1}>
          {props.pr && props.meat ? (
            <>
              <Detail
                pr={props.pr}
                meat={props.meat}
                units={units}
                cursor={cursor}
                scrollTop={unitScroll}
                height={detailHeight}
                checks={props.checks}
                threads={props.threads}
                showThreads={showThreads}
                stagedCount={staged.length}
              />
              {notes}
            </>
          ) : props.progress ? (
            <LoadingSteps progress={props.progress} />
          ) : (
            // One note, not two: with a pull request selected but no meat yet,
            // this branch and a second line below it both said the same thing.
            <Text {...toneStyle(props.statusTone ?? 'muted')}>
              {props.status ?? 'Select a pull request and press enter.'}
            </Text>
          )}
        </Box>
      </Box>

      <Text {...theme.tier.muted}>{theme.glyph.hrule.repeat(Math.max(1, columns))}</Text>

      {/* The confirm takes the status bar's row rather than adding one, so the
          layout does not shift under a question about losing work. */}
      {/* `pending`, not `danger`: the default here is to keep the work, so this
          is the yellow that nags about unsubmitted work, not a red confirm. */}
      {confirmQuit ? (
        <Text color={theme.color.pending} wrap="truncate">
          {`${staged.length} unsubmitted comment(s) · enter saves the draft and quits · x discards · esc stays`}
        </Text>
      ) : props.pr && props.meat ? (
        <StatusBar
          repoLabel={props.repoLabel}
          prNumber={props.pr.number}
          meat={props.meat}
          stagedCount={staged.length}
          model={props.model}
          worktreeOk={props.worktreeOk}
        />
      ) : (
        <Text {...theme.tier.muted}>
          {`${props.repoLabel} · ${visiblePrs.length} pull request${visiblePrs.length === 1 ? '' : 's'} · ? for keys`}
        </Text>
      )}
    </Box>
  );
}
