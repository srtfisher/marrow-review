import { createHash } from 'node:crypto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin, useStdout, useWindowSize } from 'ink';
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
import type {
  CommentAnchor, ReviewDraft, StagedComment, Verdict,
} from '../core/review/types.js';
import { VERDICTS, blockedForAuthor } from '../core/review/verdicts.js';

export type { CommentAnchor };
import { buildUnits, type ReviewUnit } from './units.js';
import {
  anchorAtRow, buildRows, composerTitle, findingAtRow, hunkAtRow, nearestStop, nextFileRow,
  nextFindingRow,
  pathAtRow, prevFileRow, prevFindingRow, rangeAnchor, rowForAnchor, unitAtRow, unitStartRows,
  withComposer, type ComposerView, type DetailRow,
} from './rows.js';
import {
  backspace, fromText, insert, newline, toText, move as moveCaret, type Buffer,
} from './textarea.js';
import { editInEditor } from './editor.js';
import { nextScrollTop, scrollBy } from './viewport.js';
import { hitDetail } from './hittest.js';
import {
  MOUSE_DISABLE, MOUSE_ENABLE, WHEEL_ROWS, isDoubleClick, parseMouse, type Click,
} from './mouse.js';
import { planFileIndex } from './fileindex.js';
import { resolveAction, type Mode } from './keymap.js';
import { buildEntries, hitPicker, layoutPicker, nextFilter, pickerScroll } from './picker.js';
import { chromeLine } from './chrome.js';
import type { LoadProgress } from './progress.js';
import { filterPrs } from './search.js';
import { ChatPane } from './components/ChatPane.js';
import { Detail, detailHeaderRows } from './components/Detail.js';
import { Help } from './components/Help.js';
import { helpBodyRows, layoutHelp } from './help.js';
import { Launch } from './components/Launch.js';
import { LoadingSteps } from './components/LoadingSteps.js';
import { PrPicker } from './components/PrPicker.js';
import { HintBar } from './components/HintBar.js';
import { detailHints, pickerHints } from './hints.js';
import { SubmitScreen } from './components/SubmitScreen.js';
import { theme } from './theme.js';

export interface AppProps {
  repoLabel: string;
  /**
   * The open pull requests, or null while the first fetch is still out. The two
   * are different screens: null is the launch frame, an empty array is a
   * repository with nothing open. Collapsed into one, "No pull requests." was
   * the first thing a reviewer read while the list was still loading.
   */
  prs: PullRequestSummary[] | null;
  /** Why the list fetch failed, if it did. `r` on the launch frame retries. */
  listError?: string | null;
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
   * Syntax colouring in the code column. Off via `--no-highlight`, for a
   * terminal or a colour scheme it fights with. Defaults on.
   */
  highlight?: boolean;
  /**
   * Opens `initial` in the reviewer's editor. Injected only by tests — the
   * default really does spawn `$EDITOR`, which no test may do.
   */
  editText?: (initial: string) => Promise<string>;
}

/**
 * The chrome row and the rule under it, above every settled screen.
 *
 * Counted by the row budget and by both hit tests: the panes now start two rows
 * down, and a hit test that skipped the offset put the cursor two lines above
 * the one the reviewer clicked.
 */
const CHROME_ROWS = 2;

/** `danger` is red AND bold; the weight is what separates it from `del`. */
function toneStyle(tone: 'muted' | 'pending' | 'danger') {
  if (tone === 'danger') return { color: theme.color.danger, bold: true };
  if (tone === 'pending') return { color: theme.color.pending };
  return theme.tier.muted;
}

export function clampCursor(cursor: number, length: number): number {
  return Math.min(Math.max(cursor, 0), Math.max(0, length - 1));
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
 * The hunk under the cursor, as text a model can read. Rows outside a hunk — a
 * file header, a finding — have no code of their own to ask about.
 */
export function chatContextForRow(rows: DetailRow[], cursor: number): string | null {
  const hunk = hunkAtRow(rows, cursor);
  const path = pathAtRow(rows, cursor);
  if (!hunk || path === null) return null;
  return buildChatContext({
    path,
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
    <Box flexDirection="column" paddingX={1}>
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

/** The two keys that are not guessable. `esc` always is, and is said anyway. */
const COMPOSER_FOOTER = '^d save · ^o editor · esc cancel';

function composerView(
  composer: { anchor: CommentAnchor; buffer: Buffer },
  width: number,
): ComposerView {
  return {
    title: composerTitle(composer.anchor),
    lines: composer.buffer.lines,
    row: composer.buffer.row,
    col: composer.buffer.col,
    footer: COMPOSER_FOOTER,
    width,
  };
}

/**
 * What a suggestion starts out holding: GitHub's fence wrapped around the lines
 * it would replace.
 *
 * Only lines that exist in the post-image contribute. A deleted line is not
 * there to be replaced, and including it would make the suggestion re-add code
 * the author had just taken out.
 */
function suggestionBody(rows: DetailRow[], from: number, to: number): string {
  const replaced: string[] = [];
  for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) {
    const row = rows[i];
    if (row?.kind === 'diff-line' && row.line.newLine !== null) replaced.push(row.line.text);
  }
  return ['```suggestion', ...replaced, '```'].join('\n');
}

export function App(props: AppProps) {
  const { exit } = useApp();
  const { setRawMode, isRawModeSupported } = useStdin();
  const { stdout } = useStdout();
  const { columns, rows } = useWindowSize();

  const [mode, setMode] = useState<Mode>(props.pr ? 'detail' : 'picker');
  /** Where esc returns to from an overlay, so help never strands you. */
  const [underlay, setUnderlay] = useState<Mode>('picker');
  const [listCursor, setListCursor] = useState(0);
  const [listScroll, setListScroll] = useState(0);
  /** A ROW index. The cursor addresses the line the reviewer is looking at,
   *  which is what makes `C` mean "comment on this line". */
  const [rowCursor, setRowCursor] = useState(0);
  const [rowScroll, setRowScroll] = useState(0);
  const [query, setQuery] = useState('');
  /** Help scrolls when no arrangement of the bindings fits the terminal. */
  const [helpScroll, setHelpScroll] = useState(0);
  const [expandedFiles, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [foldedFiles, setFolded] = useState<ReadonlySet<string>>(new Set());
  /** `d`: show every hunk, not only the ones the meat pass kept. */
  const [fullDiff, setFullDiff] = useState(false);
  /** Files the reviewer has been through. Checked off in the file index. */
  const [reviewedFiles, setReviewed] = useState<ReadonlySet<string>>(new Set());
  const [showThreads, setShowThreads] = useState(false);
  const [draft, setDraft] = useState<ReviewDraft>({ verdict: null, body: '', comments: [] });
  const [verdict, setVerdict] = useState<Verdict>('COMMENT');
  /**
   * The open composer: where it is anchored, what has been typed, and the id of
   * the staged comment it is rewriting, if any.
   *
   * There is no `isSuggestion` flag. A suggestion is a fenced block typed into
   * the body like any other markdown, so `c` and `s` differ only in what the
   * buffer starts out holding.
   */
  const [composer, setComposer] = useState<
    { anchor: CommentAnchor; buffer: Buffer; editing: string | null } | null
  >(null);
  /**
   * Where `V` was pressed, as a row index. The selection runs from here to the
   * cursor in whichever direction it was swept.
   */
  const [selectAnchor, setSelectAnchor] = useState<number | null>(null);
  /** True while `$EDITOR` owns the terminal; Ink must not repaint over it. */
  const [editorOpen, setEditorOpen] = useState(false);
  /** Set by `q` when there is work on screen that has not been submitted. */
  const [confirmQuit, setConfirmQuit] = useState(false);
  /** Set by esc leaving the diff — the review stays warm either way, but esc
   *  is reflexive and the screen it swaps away is the reviewer's place in it. */
  const [confirmLeave, setConfirmLeave] = useState(false);
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
  /** The last left press, so the next one can tell whether it is a double. */
  const lastClick = useRef<Click | null>(null);

  const visiblePrs = useMemo(() => filterPrs(props.prs ?? [], query), [props.prs, query]);
  const shownFindings = useMemo(
    () => visibleFindings(findings, showRefuted),
    [findings, showRefuted],
  );
  // `d` reveals every hunk in every file at once; `z` reveals one file's. The
  // union is what the units are built from, so the two never fight each other.
  const revealed = useMemo(
    () => (fullDiff
      ? new Set(props.meat?.files.map((f) => f.file.path) ?? [])
      : expandedFiles),
    [fullDiff, expandedFiles, props.meat],
  );
  const units = useMemo(
    () => (props.meat
      ? buildUnits(props.meat, { expandedFiles: revealed, foldedFiles, findings: shownFindings })
      : []),
    [props.meat, revealed, foldedFiles, shownFindings],
  );
  /**
   * Every terminal row of the detail pane, in order. One array is what the pane
   * renders, what the viewport windows on, and what the cursor indexes — so a
   * height calculation can no longer disagree with what was drawn.
   */
  // Keyed on the mode, not merely on a pull request being loaded: `esc` sets the
  // mode back to `picker` without unloading it, so the hint bar has to follow
  // the screen the reviewer is looking at rather than what is still in memory.
  const browsing = mode === 'picker';
  const reviewing = props.pr !== null && props.meat !== null && !browsing;
  /**
   * The review still loaded behind the picker, by number, or null.
   *
   * That a diff is warm changes what two keys mean — esc goes back to it rather
   * than quitting, and enter on it switches modes rather than refetching — and
   * the hint bar names it. One derived value, so the three cannot disagree.
   */
  const warmPr = props.pr !== null && props.meat !== null ? props.pr.number : null;
  // Every pane is inset by one cell on either side, and nothing competes with
  // the body for width any more. Above the row list because the pane's width
  // decides where a comment body wraps, and wrapping happens when rows are built.
  const detailWidth = Math.max(1, columns - 2);
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
  const detailRowList = useMemo(() => {
    // The comment being rewritten is hidden while its composer is open —
    // otherwise the old wording sits directly above the box you are changing it
    // in, and the two disagree on screen.
    const shown = composer?.editing
      ? staged.filter((c) => c.id !== composer.editing)
      : staged;
    const base = buildRows(units, props.threads, showThreads, {
      staged: shown,
      commentWidth: detailWidth - 8,
      highlight: props.highlight !== false,
    });
    if (!composer) return base;

    const at = rowForAnchor(base, composer.anchor);
    // Less the two columns the box is indented by, so its right border lands
    // inside the pane instead of being truncated off the end of it.
    return at < 0 ? base : withComposer(base, at, composerView(composer, detailWidth - 2));
  }, [units, props.threads, showThreads, staged, composer, detailWidth]);
  const fullDraft = useMemo(() => ({ ...draft, comments: staged }), [draft, staged]);

  // The bottom horizontal rule and the status line, under the chrome row and
  // the rule of its own.
  const bodyHeight = Math.max(1, rows - CHROME_ROWS - 2);
  /** What a full-screen takeover gets: everything under the chrome row. Read by
   *  the renderer and by both scroll calculations, so they cannot split. */
  const overlayHeight = Math.max(1, rows - CHROME_ROWS);
  // Notes render under the body pane, so the pane's budget pays for them —
  // otherwise adding one pushes the status bar off the bottom again. Scrolling
  // and rendering must agree on this number or the cursor leaves the window.
  const findingsFailed = findingsStatus === 'failed';
  const noteRows = (props.status ? 1 : 0) + (findingsFailed ? 1 : 0);
  const paneHeight = Math.max(0, bodyHeight - noteRows);
  const detailHeaderHeight = props.meat
    ? detailHeaderRows(props.meat, props.checks, detailWidth)
    : 0;
  const detailRows = props.meat ? Math.max(0, paneHeight - detailHeaderHeight) : 0;
  // The picker's entries, measured once. Their heights vary with how many rows
  // a title needs, and the renderer, the scroll clamp, and the hit test all
  // count those rows — a second measurement is how they would come to disagree
  // about which pull request the cursor is on. `detailWidth` is the width
  // `PrPicker` wraps at: it is handed the whole terminal and pays for its own
  // inset out of it.
  const pickerEntries = useMemo(
    () => buildEntries(visiblePrs, detailWidth),
    [visiblePrs, detailWidth],
  );
  const pickerLayout = layoutPicker(paneHeight, detailWidth);
  const entryHeights = pickerEntries.map((entry) => entry.height);

  // The file index, planned once: the pane draws from this and a click is
  // resolved against it, so the two cannot disagree about where a cell is.
  const indexPaths = useMemo(
    () => props.meat?.files.map((f) => f.file.path) ?? [],
    [props.meat],
  );
  const indexPlan = useMemo(
    () => planFileIndex(indexPaths, detailWidth),
    [indexPaths, detailWidth],
  );
  /** Where the detail pane's content starts: its own one cell of padding. */
  const paneLeft = 1;

  // Folding shrinks the row list under the cursor, and a query shrinks the
  // pull-request list under it; clamp on the way out rather than trusting the
  // stored index anywhere downstream.
  const prCursor = clampCursor(listCursor, visiblePrs.length);
  const cursor = clampCursor(rowCursor, detailRowList.length);

  // A newly opened pull request starts at the top of its own diff, with its own
  // reading progress — checks from the last one would be a lie about this one.
  const openNumber = props.pr?.number ?? null;
  useEffect(() => {
    if (openNumber === null) return;
    setRowCursor(0);
    setRowScroll(0);
    setReviewed(new Set());
    setFullDiff(false);
    setConfirmQuit(false);
    setConfirmLeave(false);
    setMode('detail');
  }, [openNumber]);

  // Mouse reporting, on for as long as this app owns the terminal.
  //
  // Turned off again on the way out without fail, including while `$EDITOR` has
  // the terminal: a shell left in reporting mode prints `[<0;12;7M` every time
  // you click, and the reviewer has no idea what did that to their prompt.
  useEffect(() => {
    if (!isRawModeSupported || editorOpen) return;
    stdout.write(MOUSE_ENABLE);
    return () => {
      stdout.write(MOUSE_DISABLE);
    };
  }, [isRawModeSupported, editorOpen, stdout]);

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

  // Findings arriving grows the row list under the cursor and `v` shrinks it
  // again. The cursor indexes that list, so it and the viewport are pulled back
  // into range here rather than left pointing past the end.
  useEffect(() => {
    // Prefers upward: this exists to pull a cursor left past the end of a
    // shrunken list back into it.
    const rested = landing(rowCursor, -1);
    setRowCursor(rested);
    setRowScroll((prev) => nextScrollTop(detailRowList.length, detailRows, rested, prev));
  }, [detailRowList.length]);

  function moveList(next: number) {
    const clamped = clampCursor(next, visiblePrs.length);
    setListCursor(clamped);
    setListScroll((prev) => pickerScroll(entryHeights, pickerLayout.entryRows, clamped, prev));
  }

  /**
   * Where a cursor aimed at `row` actually comes to rest.
   *
   * Every write to the row cursor goes through here — keys, wheel, click — so
   * that "a blank separator is not a place" is stated once. There are five
   * writers, and enforcing a rule at five sites is how one of them gets missed.
   */
  function landing(row: number, prefer: 1 | -1): number {
    return nearestStop(detailRowList, clampCursor(row, detailRowList.length), prefer);
  }

  function moveRows(next: number) {
    // The direction of travel, so that stepping off the bottom of a file
    // reaches the next one and stepping off the top reaches the previous one.
    const rested = landing(next, next >= cursor ? 1 : -1);
    setRowCursor(rested);
    setRowScroll((prev) => nextScrollTop(detailRowList.length, detailRows, rested, prev));
    markSeen(rested);
  }

  /**
   * A file the cursor has passed the end of has been read, so it gets its check
   * without the reviewer having to ask for it — that is what "go through a file"
   * means. `m` remains for the two cases this cannot see: skipping a file
   * deliberately, and un-checking one you want to come back to.
   */
  function markSeen(row: number) {
    const path = pathAtRow(detailRowList, row);
    if (path === null) return;
    // The last row that is a *place*. The gap after a file carries that file's
    // path and the cursor can never land on it, so counting it would mean no
    // file ever earned its check again.
    const lastRowOfPath = detailRowList.findLastIndex(
      (r) => r.path === path && r.kind !== 'blank',
    );
    if (row < lastRowOfPath) return;
    setReviewed((s) => (s.has(path) ? s : new Set(s).add(path)));
  }

  /** Half a page of rows — the cursor and the budget are the same unit now. */
  function halfPage(dir: -1 | 1) {
    if (mode === 'help') {
      return moveHelp(dir * Math.max(1, Math.floor(helpBodyRows(overlayHeight) / 2)));
    }
    if (mode === 'picker') return moveList(prCursor + dir * Math.floor(bodyHeight / 2));
    return moveRows(cursor + dir * Math.max(1, Math.floor(detailRows / 2)));
  }

  /** The help overlay scrolls rather than clipping; this is its offset. */
  function moveHelp(delta: number) {
    const layout = layoutHelp(columns, overlayHeight);
    const body = helpBodyRows(overlayHeight);
    setHelpScroll((prev) => Math.min(
      Math.max(0, prev + delta),
      Math.max(0, layout.rows.length - body),
    ));
  }

  function move(next: number) {
    if (mode === 'picker') moveList(next);
    else moveRows(next);
  }

  function applyQuery(next: string) {
    setQuery(next);
    // The cursor indexes the filtered list, so narrowing must pull it back in
    // range immediately — otherwise enter opens whatever the stale index hits.
    const narrowed = filterPrs(props.prs ?? [], next);
    const clamped = clampCursor(listCursor, narrowed.length);
    setListCursor(clamped);
    // The narrowed list's own heights: the ones measured above still belong to
    // the query this call is replacing.
    setListScroll(pickerScroll(
      buildEntries(narrowed, detailWidth).map((entry) => entry.height),
      pickerLayout.entryRows,
      clamped,
      0,
    ));
  }

  function toggleIn(set: ReadonlySet<string>, path: string): ReadonlySet<string> {
    const next = new Set(set);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  }

  function currentPath(): string | null {
    return pathAtRow(detailRowList, cursor);
  }

  function revealAll() {
    const all = props.meat?.files.map((f) => f.file.path) ?? [];
    setExpanded((s) => (s.size === all.length ? new Set() : new Set(all)));
  }

  function enterOverlay(next: Mode) {
    setUnderlay(mode);
    // Help opens at the top every time. Reopening it halfway down the list it
    // was left at reads as the overlay having lost its first section.
    if (next === 'help') setHelpScroll(0);
    setMode(next);
  }

  /** The swept range, or the single row the cursor is on. */
  function selectedRows(): { from: number; to: number } {
    if (selectAnchor === null) return { from: cursor, to: cursor };
    return { from: Math.min(selectAnchor, cursor), to: Math.max(selectAnchor, cursor) };
  }

  function startComment(isSuggestion: boolean, at?: { from: number; to: number }) {
    const { from, to } = at ?? selectedRows();
    // `rangeAnchor` returns null on rows that are not diff lines; `anchorAtRow`
    // then degrades to the enclosing hunk, so a comment is never simply refused.
    const anchor = rangeAnchor(detailRowList, from, to) ?? anchorAtRow(detailRowList, from);
    if (!anchor) return;

    setComposer({
      anchor,
      buffer: fromText(isSuggestion ? suggestionBody(detailRowList, from, to) : ''),
      editing: null,
    });
    setSelectAnchor(null);
    enterOverlay('comment');
  }

  function closeComposer() {
    setComposer(null);
    setSelectAnchor(null);
    setMode('detail');
  }

  function editBuffer(change: (buffer: Buffer) => Buffer) {
    setComposer((c) => (c ? { ...c, buffer: change(c.buffer) } : c));
  }

  /** The staged comment under the cursor, if the cursor is on one. */
  function commentAtCursor(): StagedComment | null {
    const row = detailRowList[cursor];
    return row?.kind === 'comment' ? row.comment : null;
  }

  function currentFinding(): TriagedFinding | null {
    return findingAtRow(detailRowList, cursor);
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

    setComposer(null);
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
    const context = chatContextForRow(detailRowList, cursor);
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

  function saveComment() {
    if (!composer) return;
    const { anchor, editing } = composer;
    const body = toText(composer.buffer).trim();

    if (body.length > 0) {
      setDraft((d) => {
        const comment: StagedComment = {
          id: editing ?? `${anchor.path}:${anchor.line}:${d.comments.length}`,
          path: anchor.path,
          line: anchor.line,
          side: anchor.side,
          startLine: anchor.startLine ?? null,
          body,
          // A composed comment carries its own markdown, fence and all —
          // `renderCommentBody` passes a null-suggestion body through verbatim.
          // The field stays for findings, which is the only path that fills it.
          suggestion: null,
        };
        return {
          ...d,
          comments: editing
            ? d.comments.map((c) => (c.id === editing ? comment : c))
            : [...d.comments, comment],
        };
      });
    }

    closeComposer();
  }

  /**
   * Every key while the composer is up. It owns all of them, escape included —
   * a stray `!` or `q` in the middle of a comment must never be a command.
   */
  function handleComposerKey(input: string, key: Parameters<typeof resolveAction>[1] & {
    leftArrow?: boolean; rightArrow?: boolean; backspace?: boolean; delete?: boolean;
    meta?: boolean;
  }) {
    // A mouse report is one input event naming no key. Left in, `[<0;42;13M`
    // would be typed into the comment as text.
    if (parseMouse(input)) return;

    if (key.escape) return closeComposer();

    if (key.ctrl) {
      // Not ctrl-s: that is XOFF, and on a terminal that has not disabled flow
      // control it freezes the session with no clue as to what happened.
      if (input === 'd') return saveComment();
      if (input === 'o') return void composeInEditor();
      if (input === 'a') return editBuffer((b) => moveCaret(b, 'home'));
      if (input === 'e') return editBuffer((b) => moveCaret(b, 'end'));
      return;
    }

    if (key.return) return editBuffer(newline);
    // macOS sends DEL for the backspace key, which Ink reports as `delete`.
    if (key.backspace || key.delete) return editBuffer(backspace);
    if (key.leftArrow) return editBuffer((b) => moveCaret(b, 'left'));
    if (key.rightArrow) return editBuffer((b) => moveCaret(b, 'right'));
    if (key.upArrow) return editBuffer((b) => moveCaret(b, 'up'));
    if (key.downArrow) return editBuffer((b) => moveCaret(b, 'down'));
    if (key.meta) return;

    // A paste arrives as one event, so this is a chunk and not a character.
    if (input.length > 0) editBuffer((b) => insert(b, input));
  }

  /** ctrl-o: hand the body to `$EDITOR` for anything longer than a sentence. */
  async function composeInEditor() {
    if (!composer) return;
    const initial = toText(composer.buffer);
    const open = props.editText ?? editInEditor;

    setEditorOpen(true);
    if (isRawModeSupported) setRawMode(false);

    let edited = initial;
    try {
      edited = await open(initial);
    } catch {
      // No editor on this machine. The body is untouched, which is the same
      // outcome as quitting the editor without saving.
    } finally {
      if (isRawModeSupported) setRawMode(true);
      setEditorOpen(false);
    }

    editBuffer(() => fromText(edited));
  }

  /**
   * The wheel and the left button, in the two panes that have rows.
   *
   * Everything here is also a key, and stays one: this is a keyboard tool, and
   * the mouse is here because a reviewer scrolling a diff reaches for the wheel
   * without deciding to. Returns true when the report was consumed, so a report
   * this app has no use for cannot fall through to the keymap.
   */
  function handleMouse(report: NonNullable<ReturnType<typeof parseMouse>>): boolean {
    const wheel = report.action === 'wheel-up' ? -1 : 1;

    if (mode === 'picker') {
      // One entry per notch, not three rows: an entry is three or four rows
      // tall, and a list of a dozen pull requests is chosen from rather than
      // scrolled through.
      if (report.action === 'wheel-up' || report.action === 'wheel-down') {
        moveList(prCursor + wheel);
        return true;
      }
      if (report.action !== 'press' || report.button !== 'left') return true;
      // While the loading steps own the entry region there are no entries drawn
      // there to aim at, and a press resolved against them would fetch a pull
      // request the reviewer cannot see and abandon the one they asked for.
      if (props.progress) return true;

      // The row alone decides: the picker is the full width of the terminal, so
      // there is no neighbouring pane for a click to miss into.
      const hit = hitPicker({
        headerRows: pickerLayout.headerRows + CHROME_ROWS,
        heights: entryHeights,
        scrollTop: listScroll,
        viewRows: pickerLayout.entryRows,
      }, report.row);
      if (hit === null) return true;

      // Clicking the entry that is already selected opens it. One click to aim
      // and one to commit, so a stray click cannot spend a minute fetching a
      // pull request nobody asked for.
      if (hit === prCursor) {
        const selected = visiblePrs[hit];
        if (!selected) return true;
        // The same short-circuit enter takes: reopening the warm review would
        // refetch it and lose the reviewer's place in a diff they never left.
        if (selected.number === warmPr) setMode('detail');
        else props.onOpenPr(selected.number);
      } else {
        moveList(hit);
      }
      return true;
    }

    if (mode !== 'detail' || !props.meat) return true;

    if (report.action === 'wheel-up' || report.action === 'wheel-down') {
      // The view leads and the cursor follows, which is the opposite of `j`.
      const next = scrollBy(
        detailRowList.length, detailRows, cursor, rowScroll, wheel * WHEEL_ROWS,
      );
      setRowScroll(next.scrollTop);
      // `scrollBy` drags the cursor to the nearest row in the new window, which
      // can be a blank. Push it on the way the wheel is already going.
      const rested = landing(next.cursor, wheel);
      setRowCursor(rested);
      markSeen(rested);
      return true;
    }

    const dragging = report.action === 'drag' && report.button === 'left';
    if (!dragging && (report.action !== 'press' || report.button !== 'left')) return true;

    const hit = hitDetail({
      headerRows: detailHeaderHeight + CHROME_ROWS,
      indexRows: indexPlan.rows,
      indexColumns: indexPlan.columns,
      indexCellWidth: indexPlan.cellWidth,
      indexCells: indexPlan.shownCount + (indexPlan.hidden > 0 ? 1 : 0),
      viewportRows: detailRows,
      scrollTop: rowScroll,
      totalRows: detailRowList.length,
      paneLeft,
    }, report.column, report.row);
    if (!hit) return true;

    if (hit.kind === 'diff-row') {
      // A drag extends from wherever the button went down, and shift-click from
      // wherever the cursor already is. Both are the gesture GitHub sweeps a
      // line range with; neither starts a new selection if one is open.
      if (dragging || report.shift) {
        setSelectAnchor((at) => at ?? cursor);
      } else {
        const now = { row: hit.index, at: Date.now() };
        if (isDoubleClick(lastClick.current, now)) {
          lastClick.current = null;
          const rested = landing(hit.index, 1);
          setRowCursor(rested);
          markSeen(rested);
          startComment(false, { from: rested, to: rested });
          return true;
        }
        lastClick.current = now;
        // A fresh click starts over rather than growing what was there.
        setSelectAnchor(null);
      }

      // Not `moveRows`: the row is already on screen, so recentring the view
      // under the reviewer's own click would be the pane moving for no reason.
      const rested = landing(hit.index, 1);
      setRowCursor(rested);
      markSeen(rested);
      return true;
    }

    // A cell on the index. The overflow cell names a count, not a file.
    const path = indexPaths[hit.index];
    if (path === undefined) return true;
    const row = detailRowList.findIndex((r) => r.path === path);
    if (row >= 0) moveRows(row);
    return true;
  }

  function moveVerdict(delta: number) {
    const from = VERDICTS.indexOf(verdict);
    for (let step = 1; step <= VERDICTS.length; step += 1) {
      const candidate = VERDICTS[
        (from + delta * step + VERDICTS.length * step) % VERDICTS.length
      ];
      if (!candidate) continue;
      // GitHub rejects both an approval and a change request on your own pull
      // request, so neither is merely dimmed — they cannot be landed on.
      if (blockedForAuthor(candidate, props.pr?.viewerIsAuthor ?? false)) continue;
      setVerdict(candidate);
      return;
    }
  }

  useInput((input, key) => {
    // The comment editor and the chat prompt own every key while they are up,
    // including esc. `$EDITOR` owns the actual terminal.
    // `$EDITOR` owns the actual terminal. The chat prompt owns every key while
    // it is up. The composer does too — but it renders inside the diff rather
    // than over it, so it takes its keys here instead of returning early.
    if (editorOpen) return;
    if (mode === 'comment' && composer) return handleComposerKey(input, key);
    if (mode === 'comment' || mode === 'chat') return;

    // Mouse reports arrive as one input event each and name no key, so they are
    // taken off the front here. Left in, `[<0;42;13M` would reach the keymap as
    // a string starting with `[` — the binding for "previous file".
    const mouse = parseMouse(input);
    if (mouse) {
      // A question about losing work, or about leaving the diff, owns the
      // screen; scrolling behind it would move a cursor the reviewer cannot
      // see the effect of.
      if (!confirmQuit && !confirmLeave) handleMouse(mouse);
      return;
    }

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

    // Leaving is cheap — the review stays warm and the draft is on disk — but
    // esc is also the most reflexive key in the app, and the screen it swaps
    // away is the reviewer's place in a diff. One question, every time.
    if (confirmLeave) {
      if (key.return) {
        setConfirmLeave(false);
        return setMode('picker');
      }
      if (key.escape) return setConfirmLeave(false);
      return;
    }

    // The picker is search-first: it owns every printable key, so its bindings
    // are resolved here rather than in the keymap, which would have to be told
    // that `q` is a letter in this one mode. Escape unwinds one layer at a time
    // — the query, then the review behind it, then the program.
    if (mode === 'picker') {
      // The launch frame has no filter to type into, so it has exactly the two
      // keys it names. Everything else waits for the list rather than editing a
      // query that is not on screen.
      if (props.prs === null) {
        if (input === 'q') return exit();
        if (input === 'r' && props.listError) return props.onRefresh?.();
        return;
      }
      if (key.escape) {
        if (query.length > 0) return applyQuery('');
        if (warmPr !== null) return setMode('detail');
        if (hasUnsubmittedWork) return setConfirmQuit(true);
        return exit();
      }
      if (key.return) {
        const selected = visiblePrs[prCursor];
        if (!selected) return;
        // Returning to the warm review is a mode switch, not a reload: openPr
        // would refetch, re-run the meat pass, and lose the reviewer's place.
        if (selected.number === warmPr) return setMode('detail');
        return props.onOpenPr(selected.number);
      }
      if (key.upArrow || (key.ctrl && input === 'p')) return moveList(prCursor - 1);
      if (key.downArrow || (key.ctrl && input === 'n')) return moveList(prCursor + 1);
      if (key.tab) return props.onFilter?.(nextFilter(props.filter));
      if (key.ctrl && input === 'r') return props.onRefresh?.();
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

    // Several keys act on whatever the cursor is on rather than meaning one
    // fixed command, so the keymap is told what that is.
    const atCursor = detailRowList[cursor];
    const action = resolveAction(input, key, mode, {
      onFinding: atCursor?.kind === 'finding',
      onComment: atCursor?.kind === 'comment',
    });
    if (!action) return;

    switch (action.type) {
      case 'move':
        if (mode === 'help') return moveHelp(action.delta);
        // `browsing`, not `mode === 'picker'`: the picker handler returns before
        // the keymap is consulted, so the compiler knows the mode is `detail`
        // here and rejects the comparison outright.
        return move((browsing ? prCursor : cursor) + action.delta);
      case 'half-page':
        return halfPage(action.dir);
      case 'file':
        return moveRows(
          action.dir === 1
            ? nextFileRow(detailRowList, cursor)
            : prevFileRow(detailRowList, cursor),
        );
      case 'finding':
        return moveRows(
          action.dir === 1
            ? nextFindingRow(detailRowList, cursor)
            : prevFindingRow(detailRowList, cursor),
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
      // Its own state, not an alias for `Z`. On a diff the meat pass barely cut
      // — 1038 of 1040 lines kept — revealing the dropped hunks changes nothing
      // visible, so a `d` that only did that was indistinguishable from a `d`
      // that did nothing. The header now names the view either way.
      case 'toggle-full-diff':
        return setFullDiff((v) => !v);
      case 'toggle-dropped-all':
        return revealAll();
      case 'toggle-reviewed': {
        const path = currentPath();
        if (path) setReviewed((s) => toggleIn(s, path));
        return;
      }
      case 'toggle-threads':
        return setShowThreads((v) => !v);
      case 'comment':
        return startComment(false);
      case 'suggest':
        return startComment(true);
      case 'select':
        // Pressing it again clears, which is the only way out that does not
        // also mean something else.
        return setSelectAnchor((at) => (at === null ? cursor : null));
      case 'edit-comment': {
        const comment = commentAtCursor();
        if (!comment) return;
        setComposer({
          anchor: {
            path: comment.path,
            line: comment.line,
            side: comment.side,
            startLine: comment.startLine,
          },
          buffer: fromText(comment.body),
          editing: comment.id,
        });
        return enterOverlay('comment');
      }
      case 'delete-comment': {
        const comment = commentAtCursor();
        if (!comment) return;
        setDraft((d) => ({ ...d, comments: d.comments.filter((c) => c.id !== comment.id) }));
        return;
      }
      case 'open-browser': {
        const anchor = anchorAtRow(detailRowList, cursor);
        if (anchor && props.pr) props.onOpenUrl?.(hunkUrl(props.repoLabel, props.pr.number, anchor));
        return;
      }
      case 'refresh':
        // In the detail pane `R` is also how a failed model pass is retried;
        // the reviewer should not have to close and reopen the pull request.
        if (mode === 'detail') setFindingsAttempt((n) => n + 1);
        return props.onRefresh?.();
      case 'submit-screen':
        if (props.pr && props.meat) enterOverlay('submit');
        return;
      case 'help':
        return enterOverlay('help');
      case 'back':
        if (mode === 'help') return setMode(underlay);
        // A selection is the innermost thing esc can be about, so it goes
        // first: esc that left the diff while lines were still highlighted read
        // as the key having skipped a step.
        if (selectAnchor !== null) return setSelectAnchor(null);
        if (mode === 'detail') return setConfirmLeave(true);
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

  const chrome = chromeLine({
    repoLabel: props.repoLabel,
    filter: props.filter,
    // Named on every screen except the review itself, where the title block two
    // rows down already says it — twice on one screen is noise.
    warm: mode === 'picker' || mode === 'help' || mode === 'submit' || mode === 'chat'
      ? warmPr
      : null,
    width: Math.max(1, columns - 2),
  });
  const chromeRow = (
    <Box flexDirection="column">
      <Box paddingX={1} justifyContent="space-between">
        <Text {...theme.tier.tertiary} wrap="truncate">{chrome.left}</Text>
        {chrome.right !== '' && <Text color={theme.color.structure}>{chrome.right}</Text>}
      </Box>
      <Text {...theme.tier.muted}>{theme.glyph.hrule.repeat(Math.max(1, columns))}</Text>
    </Box>
  );

  // A takeover owns everything under the chrome row, and decides its own column
  // count from the width it is given.
  if (mode === 'help') {
    return (
      <Box flexDirection="column" height={rows}>
        {chromeRow}
        <Help width={columns} height={overlayHeight} scrollTop={helpScroll} />
      </Box>
    );
  }

  if (mode === 'submit' && props.pr && props.meat) {
    return (
      <Box flexDirection="column" height={rows}>
        {chromeRow}
        <SubmitScreen
          draft={fullDraft}
          files={props.meat.files.map((f) => f.file)}
          viewerIsAuthor={props.pr.viewerIsAuthor}
          selected={verdict}
        />
      </Box>
    );
  }

  if (mode === 'chat') {
    return (
      <Box flexDirection="column" height={rows}>
        {chromeRow}
        <ChatOverlay
          session={chat}
          pending={chatPending}
          onAsk={(question) => void askAboutHunk(question)}
          onClose={() => setMode(underlay)}
        />
      </Box>
    );
  }

  // Before there is a list there is nothing to frame: no chrome row, because the
  // launch frame is the brand moment and a header saying "marrow" above a banner
  // saying "marrow" is the same word twice.
  if (mode === 'picker' && props.prs === null) {
    return (
      <Launch
        repoLabel={props.repoLabel}
        width={columns}
        height={rows}
        body={props.progress
          ? { kind: 'steps', progress: props.progress }
          : props.listError
            ? { kind: 'error', message: props.listError }
            : { kind: 'spinner', label: 'fetching open pull requests…' }}
      />
    );
  }

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
      {chromeRow}
      {mode === 'picker' ? (
        <Box flexDirection="column" flexGrow={1}>
          {/* The whole terminal width: PrPicker owns its own inset, which is why
              `detailWidth` is the width its titles wrap at. */}
          <PrPicker
            prs={visiblePrs}
            total={props.prs?.length ?? 0}
            query={query}
            cursor={prCursor}
            scrollTop={listScroll}
            height={paneHeight}
            width={columns}
            warmPrNumber={warmPr}
            progress={props.progress ?? null}
          />
          {noteRows > 0 && (
            <Box flexDirection="column" paddingX={1}>{notes}</Box>
          )}
        </Box>
      ) : (
        /* paddingX rather than marginLeft: nothing sits flush against either
           terminal edge. */
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          {props.pr && props.meat ? (
            <>
              <Detail
                pr={props.pr}
                meat={props.meat}
                rows={detailRowList}
                cursor={cursor}
                scrollTop={rowScroll}
                height={paneHeight}
                width={detailWidth}
                checks={props.checks}
                fullDiff={fullDiff}
                reviewed={reviewedFiles}
                stagedCount={staged.length}
                model={props.model}
                worktreeOk={props.worktreeOk}
                selection={selectAnchor === null ? null : selectedRows()}
                findingsStatus={findingsStatus}
                // The shown findings, not every one held: `v` hides refuted
                // ones, and a count that outran what `n` walks through is a
                // count the reviewer cannot reconcile with the diff.
                findingCount={shownFindings.length}
              />
              {notes}
            </>
          ) : props.progress ? (
            <LoadingSteps progress={props.progress} />
          ) : props.status ? (
            // One note, not two: with a pull request selected but no meat yet,
            // this branch and a second line below it both said the same thing.
            <Text {...toneStyle(props.statusTone ?? 'muted')}>{props.status}</Text>
          ) : null}
        </Box>
      )}

      <Text {...theme.tier.muted}>{theme.glyph.hrule.repeat(Math.max(1, columns))}</Text>

      {/* The confirm takes the status bar's row rather than adding one, so the
          layout does not shift under a question about losing work. */}
      {/* `pending`, not `danger`: the default here is to keep the work, so this
          is the yellow that nags about unsubmitted work, not a red confirm. */}
      <Box paddingX={1}>
        {confirmQuit ? (
          <Text color={theme.color.pending} wrap="truncate">
            {`${staged.length} unsubmitted comment(s) · enter saves the draft and quits · x discards · esc stays`}
          </Text>
        ) : confirmLeave ? (
          <Text color={theme.color.pending} wrap="truncate">
            {'leave this review? it stays warm — esc returns to it · ⏎ leave · esc stay'}
          </Text>
        ) : (
          // The verbs, not the metadata. Repository, number, and gauge already
          // sit in the header; what was missing was any way to learn the keys
          // without going looking for them.
          <HintBar
            hints={reviewing
              ? detailHints(detailRowList[cursor], fullDiff, shownFindings.length)
              : pickerHints(warmPr)}
            width={Math.max(1, columns - 2)}
            stagedCount={staged.length}
          />
        )}
      </Box>
    </Box>
  );
}
