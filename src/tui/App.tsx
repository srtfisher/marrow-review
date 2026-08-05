import { createHash } from 'node:crypto';
import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import type { Hunk } from '../core/diff/types.js';
import type {
  CheckRun, PullFilter, PullRequestDetail, PullRequestSummary, ReviewThread,
} from '../core/github/types.js';
import type { MeatResult } from '../core/meat/index.js';
import type { ReviewDraft, Side, StagedComment, Verdict } from '../core/review/types.js';
import { buildUnits, nextFileIndex, prevFileIndex, type ReviewUnit } from './units.js';
import { nextScrollTop } from './viewport.js';
import { resolveAction, type Mode } from './keymap.js';
import { filterPrs } from './search.js';
import { CommentEditor } from './components/CommentEditor.js';
import { Detail, detailHeaderRows } from './components/Detail.js';
import { Help } from './components/Help.js';
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
  onOpenPr: (number: number) => void;
  onSubmit: (draft: ReviewDraft, verdict: Verdict) => void;
  onFilter?: (filter: PullFilter) => void;
  onRefresh?: () => void;
  onOpenUrl?: (url: string) => void;
}

/** Where a staged comment attaches, in GitHub's own terms. */
export interface CommentAnchor {
  path: string;
  line: number;
  side: Side;
}

/** Same order as the submit screen renders them, so j/k matches what you see. */
const VERDICTS: readonly Verdict[] = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];

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

export function App(props: AppProps) {
  const { exit } = useApp();
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

  const visiblePrs = useMemo(() => filterPrs(props.prs, query), [props.prs, query]);
  const units = useMemo(
    () => (props.meat ? buildUnits(props.meat, { expandedFiles, foldedFiles }) : []),
    [props.meat, expandedFiles, foldedFiles],
  );

  // One row for the horizontal rule, one for the status line.
  const bodyHeight = Math.max(1, rows - 2);
  const listRows = visibleEntryCount(bodyHeight, mode === 'search');
  const detailRows = props.meat
    ? Math.max(0, bodyHeight - detailHeaderRows(props.meat, props.checks))
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
    setMode('detail');
  }, [openNumber]);

  function moveList(next: number) {
    const clamped = clampCursor(next, visiblePrs.length);
    setListCursor(clamped);
    setListScroll((prev) => nextScrollTop(visiblePrs.length, listRows, clamped, prev));
  }

  function moveUnits(next: number) {
    const clamped = clampCursor(next, units.length);
    setUnitCursor(clamped);
    setUnitScroll((prev) => nextScrollTop(units.length, detailRows, clamped, prev));
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
    // The comment editor owns every key while it is up, including esc.
    if (mode === 'comment') return;

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
      if (key.return) return props.onSubmit(draft, verdict);
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
        return move(
          (mode === 'list' ? prCursor : cursor) + action.dir * Math.floor(bodyHeight / 2),
        );
      case 'file':
        return moveUnits(
          action.dir === 1 ? nextFileIndex(units, cursor) : prevFileIndex(units, cursor),
        );
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
        return exit();
      default:
        return;
    }
  });

  if (mode === 'help') return <Help />;

  if (mode === 'submit' && props.pr && props.meat) {
    return (
      <SubmitScreen
        draft={draft}
        files={props.meat.files.map((f) => f.file)}
        viewerIsAuthor={props.pr.viewerIsAuthor}
        selected={verdict}
        onSelect={setVerdict}
        onConfirm={() => props.onSubmit(draft, verdict)}
        onCancel={() => setMode('detail')}
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

  const paneRule = Array.from({ length: bodyHeight }, () => theme.glyph.rule).join('\n');

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
            <Detail
              pr={props.pr}
              meat={props.meat}
              units={units}
              cursor={cursor}
              scrollTop={unitScroll}
              height={bodyHeight}
              checks={props.checks}
              threads={props.threads}
              showThreads={showThreads}
            />
          ) : (
            <Text {...theme.tier.muted}>
              {props.status ?? 'Select a pull request and press enter.'}
            </Text>
          )}
          {props.pr && props.status && <Text color={theme.color.pending}>{props.status}</Text>}
        </Box>
      </Box>

      <Text {...theme.tier.muted}>{theme.glyph.hrule.repeat(Math.max(1, columns))}</Text>

      {props.pr && props.meat ? (
        <StatusBar
          repoLabel={props.repoLabel}
          prNumber={props.pr.number}
          meat={props.meat}
          stagedCount={draft.comments.length}
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
