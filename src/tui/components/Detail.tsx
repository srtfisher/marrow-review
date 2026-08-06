import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { CheckRun, PullRequestDetail } from '../../core/github/types.js';
import type { MeatResult } from '../../core/meat/index.js';
import type { DetailRow } from '../rows.js';
import { DiffLineRow } from './DiffLines.js';
import { Viewport } from './Viewport.js';
import { theme } from '../theme.js';
import { meatGauge } from '../gauge.js';
import { layoutFileIndex, fileIndexRows, type FileIndexEntry } from '../fileindex.js';

/**
 * Where the model pass got to. `ok` and `failed` are distinct on purpose: the
 * pass returns nothing both when it found nothing and when it never ran, and
 * those are not the same news.
 */
export type FindingsStatus = 'idle' | 'running' | 'ok' | 'failed';

export interface DetailProps {
  pr: PullRequestDetail;
  meat: MeatResult;
  rows: DetailRow[];
  /** Row index, not unit index — the cursor addresses a line. */
  cursor: number;
  scrollTop: number;
  height: number;
  width: number;
  checks: CheckRun[];
  /** `d`: every hunk shown, not only the ones the meat pass kept. */
  fullDiff: boolean;
  /** Paths the reviewer has checked off. */
  reviewed: ReadonlySet<string>;
  /** Unsubmitted comments, shown here as well as in the hint bar. */
  stagedCount?: number;
  /** Rows swept by `V`, a drag, or a shift-click. Inclusive at both ends. */
  selection?: { from: number; to: number } | null;
  findingsStatus?: FindingsStatus;
  /** Findings actually on screen, so the number matches what `n` walks. */
  findingCount?: number;
  model: string;
  /**
   * False means no worktree, so the model reasoned from the diff alone. Stated,
   * never hidden: a degraded review that looks identical to a full one is how a
   * reviewer comes to trust findings that had half the evidence.
   */
  worktreeOk: boolean;
}

const SEVERITY_MARK: Record<string, string> = { critical: '!!', important: '!', minor: '·' };

/**
 * Cyan `▸` for the current row, a thin bar for the rest of a `V` selection, two
 * blank columns otherwise.
 *
 * Never reverse video and never a background: reverse is reserved for the list
 * pane's title row, and a background wash behind selected lines would fight the
 * add/del colors those same lines are carrying.
 */
function cursorMark(selected: boolean, inSelection = false) {
  const glyph = selected
    ? theme.glyph.cursor
    : inSelection ? theme.glyph.selected : ' ';
  return <Text color={theme.color.structure}>{`${glyph} `}</Text>;
}

/**
 * One row to one `<Text>`. The pane slices this array, so a row must never
 * render more than a single line: everything truncates, nothing wraps. A
 * wrapped line would push every row below it down by one and the cursor would
 * stop pointing at what the reviewer sees.
 */
export function renderRow(
  row: DetailRow,
  selected: boolean,
  gutterWidth: number,
  inSelection = false,
): ReactNode {
  switch (row.kind) {
    case 'blank':
      return <Text> </Text>;

    case 'file-header': {
      const dropped = row.file.dropped;
      return (
        <Text dimColor={dropped !== null} wrap="truncate">
          {cursorMark(selected, inSelection)}
          <Text color={theme.color.structure}>{theme.glyph.cut}</Text>
          {` ${row.path}`}
          {dropped ? `  · dropped: ${dropped.rule}` : ''}
        </Text>
      );
    }

    case 'hunk-header':
      return (
        <Text {...theme.tier.muted} wrap="truncate">
          {cursorMark(selected, inSelection)}
          {`${row.hunk.header}  [${row.reason}]`}
        </Text>
      );

    case 'diff-line':
      return (
        <Box>
          {cursorMark(selected, inSelection)}
          <DiffLineRow line={row.line} gutterWidth={gutterWidth} />
        </Box>
      );

    case 'thread':
      return (
        <Text wrap="truncate">
          {'    '}
          <Text {...theme.tier.muted}>{`${row.author}: `}</Text>
          {row.body}
        </Text>
      );

    case 'dropped-summary': {
      const label = `${row.count} hunk${row.count === 1 ? '' : 's'} folded`;
      return (
        <Text {...theme.tier.muted} wrap="truncate">
          {cursorMark(selected, inSelection)}
          {`${theme.glyph.fold.repeat(3)} ${label} · ${row.reasons.join(', ')} — press z to reveal ${theme.glyph.fold.repeat(3)}`}
        </Text>
      );
    }

    case 'comment':
      return renderCommentRow(row, selected);

    case 'composer':
      return renderComposerRow(row);

    case 'finding':
      return renderFindingRow(row, selected);
  }
}

/**
 * A staged comment of the reviewer's own, sitting under the lines it is about.
 *
 * `pending` yellow and the same `●` the header counts with: it is the same
 * unsubmitted work, stated in the one place where it can be read against the
 * code it is criticising.
 */
function renderCommentRow(row: Extract<DetailRow, { kind: 'comment' }>, selected: boolean) {
  if (row.part === 'head') {
    return (
      <Text color={theme.color.pending} wrap="truncate">
        {cursorMark(selected)}
        {`  ${row.text}`}
      </Text>
    );
  }

  // Already wrapped by `buildRows`, so this is exactly one row however long the
  // comment is.
  return <Text wrap="truncate">{`       ${row.text}`}</Text>;
}

/**
 * One row of the composer's box.
 *
 * `structure` cyan, because the box is telling you *where* in the diff you are
 * writing — the same thing the file marker and the cursor say. The title uses
 * GitHub's own wording so the anchor is never in doubt.
 */
function renderComposerRow(row: Extract<DetailRow, { kind: 'composer' }>) {
  const { view } = row;
  // The box is indented two columns and `view.width` is the whole of it, so the
  // caller must pass a width the pane can actually afford. Everything below is
  // derived from it, which is what keeps the four borders in one column.
  const box = Math.max(8, view.width);
  const rule = (label: string) => {
    const text = ` ${label} `.slice(0, box - 2);
    return `${theme.glyph.hrule}${text}`.padEnd(box - 2, theme.glyph.hrule);
  };

  if (row.part === 'top') {
    return (
      <Text color={theme.color.structure} wrap="truncate">{`  ╭${rule(view.title)}╮`}</Text>
    );
  }

  if (row.part === 'bottom') {
    return (
      <Text color={theme.color.structure} wrap="truncate">{`  ╰${rule(view.footer)}╯`}</Text>
    );
  }

  const width = box - 4;
  const text = (view.lines[row.lineIndex ?? 0] ?? '').slice(0, width);
  const caretHere = (row.lineIndex ?? 0) === view.row;
  const col = Math.min(view.col, width - 1);

  return (
    <Text wrap="truncate">
      <Text color={theme.color.structure}>{'  │ '}</Text>
      {/* Reverse video on the character under the caret, or on the space past
          the end of the line. A composer with no visible caret is one the
          reviewer cannot tell is focused, or find their place in. */}
      {caretHere ? (
        <>
          {text.slice(0, col)}
          <Text inverse>{text[col] ?? ' '}</Text>
          {text.slice(col + 1).padEnd(width - col - 1, ' ')}
        </>
      ) : text.padEnd(width, ' ')}
      <Text color={theme.color.structure}>{' │'}</Text>
    </Text>
  );
}

/**
 * A finding is model-authored content end to end, so it renders in
 * `theme.color.agent` — the one token reserved for the model's words. A refuted
 * finding renders dim instead: the verifier is telling you to discount it, and
 * dim is how this app always says "still here, but discount it".
 */
function renderFindingRow(row: Extract<DetailRow, { kind: 'finding' }>, selected: boolean) {
  const finding = row.finding;
  const refuted = finding.verdict === 'refuted';
  const agent = { color: refuted ? undefined : theme.color.agent, dimColor: refuted };

  if (row.part === 'title') {
    return (
      <Text {...agent} wrap="truncate">
        {cursorMark(selected)}
        {`  ${SEVERITY_MARK[finding.severity] ?? '·'} ${finding.title}`}
        <Text {...theme.tier.muted}>{`  ${finding.severity}`}</Text>
        {finding.verdict !== 'confirmed' && (
          <Text {...theme.tier.muted}>{`  ${finding.verdict}`}</Text>
        )}
        {finding.state === 'accepted' && (
          <Text color={theme.color.pending}>{`  ${theme.glyph.staged} staged`}</Text>
        )}
      </Text>
    );
  }

  if (row.part === 'body') {
    return <Text {...agent} wrap="truncate">{`       ${finding.editedBody ?? finding.body}`}</Text>;
  }

  if (row.part === 'suggestion') {
    return <Text {...theme.tier.muted} wrap="truncate">{'       suggestion available — press s'}</Text>;
  }

  const r = row.refutation;
  return (
    <Text {...theme.tier.muted} wrap="truncate">
      {`       refuted (${r?.lens ?? ''}): ${r?.reasoning ?? ''}`}
    </Text>
  );
}

/**
 * The findings segment of the meta row.
 *
 * `failed` renders nothing because the red banner under the pane already says
 * it, and the same problem stated twice reads as two problems. `idle` renders
 * nothing because there is not yet anything to report. Everything else is
 * stated out loud — including zero, which is the case that used to be silent.
 */
function findingsNote(status: FindingsStatus, count: number): ReactNode {
  if (status === 'running') return <Text {...theme.tier.muted}>{' · findings…'}</Text>;
  if (status !== 'ok') return null;
  if (count === 0) return <Text {...theme.tier.muted}>{' · no findings'}</Text>;

  return (
    <>
      <Text {...theme.tier.muted}>{' · '}</Text>
      {/* `agent` magenta and not dim: a count of what the model produced is
          model-authored content, not chrome. */}
      <Text color={theme.color.agent} dimColor={false}>
        {`${count} finding${count === 1 ? '' : 's'}`}
      </Text>
    </>
  );
}

function indexEntries(meat: MeatResult, currentPath: string | null, reviewed: ReadonlySet<string>): FileIndexEntry[] {
  return meat.files.map((f) => ({
    path: f.file.path,
    dropped: f.dropped !== null,
    reviewed: reviewed.has(f.file.path),
    current: f.file.path === currentPath,
  }));
}

/**
 * Rows the header block occupies, so the app can budget the body. Exported
 * because scrolling and rendering must agree on this number exactly — when they
 * disagreed, the cursor walked off the bottom of the window.
 */
export function detailHeaderRows(
  meat: MeatResult,
  checks: CheckRun[],
  width: number,
): number {
  const failing = checks.some((c) => c.conclusion === 'failure');
  // title, meta, gauge, blank
  return 4 + (failing ? 1 : 0) + (meat.summary.length > 0 ? 1 : 0)
    + fileIndexRows(meat.files.map((f) => f.file.path), width);
}

export function Detail({
  pr, meat, rows, cursor, scrollTop, height, width, checks, fullDiff, reviewed,
  stagedCount = 0, model, worktreeOk, findingsStatus = 'idle', findingCount = 0,
  selection = null,
}: DetailProps) {
  const failing = checks.filter((c) => c.conclusion === 'failure');
  const currentPath = rows[cursor]?.path ?? null;
  const index = layoutFileIndex(indexEntries(meat, currentPath, reviewed), width);
  const headerRows = detailHeaderRows(meat, checks, width);

  const body = rows.map((row, i) => renderRow(
    row,
    i === cursor,
    theme.layout.gutterWidth,
    selection !== null && i >= selection.from && i <= selection.to,
  ));

  return (
    <Box flexDirection="column">
      {/* The PR title is the one bold element in this pane — nothing else competes. */}
      <Text {...theme.tier.primary} wrap="truncate">{pr.title}</Text>
      <Text {...theme.tier.muted} wrap="truncate">
        {`#${pr.number} · ${pr.author} · ${pr.baseRef} ← ${pr.headRef} · ${model}`}
        {!worktreeOk && ' · diff-only'}
        {findingsNote(findingsStatus, findingCount)}
        {/* Unsubmitted work nags in both places it can be seen from. */}
        {stagedCount > 0 && (
          <Text color={theme.color.pending}>{`  ${theme.glyph.staged} ${stagedCount} staged`}</Text>
        )}
      </Text>
      {/* `danger` is red AND bold — that weight is the only thing separating it
          from `del`, which is the same red on every deleted line below. */}
      {failing.length > 0 && (
        <Text color={theme.color.danger} bold wrap="truncate">
          {`failing: ${failing.map((c) => c.name).join(', ')}`}
        </Text>
      )}
      {meat.summary.length > 0 && <Text wrap="truncate">{meat.summary}</Text>}
      {/* The meat gauge: the product's thesis in ten characters. Filled cells
          are green because they represent kept lines, which is the same meaning
          green carries everywhere else in this UI. */}
      <Text wrap="truncate">
        <Text color={theme.color.add}>{meatGauge(meat.keptLines, meat.totalLines)}</Text>
        {/* "kept" is not redundant next to the gauge: a bare 1/2 could read as
            kept or as dropped, and the gauge does not disambiguate direction. */}
        <Text {...theme.tier.muted}>{'  kept '}</Text>
        {meat.keptLines}
        <Text {...theme.tier.muted}>{`/${meat.totalLines} lines · `}</Text>
        {/* The size of the view you are actually in, so `d` visibly does
            something on a diff nothing was cut from — where the label used to
            be the only thing that changed. Same two tokens as every diff line
            below, carrying the same meaning. */}
        <Text color={theme.color.add}>{`+${fullDiff ? meat.totalAdditions : meat.keptAdditions}`}</Text>
        {' '}
        {/* U+2212, not a hyphen: it matches the `+` in width and weight. */}
        <Text color={theme.color.del}>{`−${fullDiff ? meat.totalDeletions : meat.keptDeletions}`}</Text>
        <Text {...theme.tier.muted}>{' · '}</Text>
        {meat.keptFiles}
        <Text {...theme.tier.muted}>{`/${meat.totalFiles} files · `}</Text>
        {/* Which view you are in, always stated. `d` toggling between two views
            that look identical on a diff nothing was cut from is indistinguishable
            from `d` being broken. */}
        <Text color={fullDiff ? theme.color.pending : theme.color.structure}>
          {fullDiff ? 'full diff' : 'meat'}
        </Text>
        {/* Said out loud, because the alternative is a gauge reading 1038/1040
            that looks like a judgment and is actually a shortfall. */}
        {meat.unclassified > 0 && (
          <Text color={theme.color.pending}>
            {`  ${meat.unclassified} hunk${meat.unclassified === 1 ? '' : 's'} unclassified`}
          </Text>
        )}
      </Text>

      {/* Every file in the pull request, always. The reviewer's map. */}
      {index.grid.map((gridRow, r) => (
        <Text key={r} wrap="truncate">
          {gridRow.map((cell, c) => (
            <Text key={c}>
              <Text color={theme.color.structure}>{cell.cursor}</Text>
              {/* The check is green for the same reason kept lines are: it is
                  the reviewer's own progress through the diff, not chrome. */}
              <Text color={theme.color.add}>{cell.check}</Text>
              {' '}
              <Text
                color={cell.entry?.current ? theme.color.structure : undefined}
                dimColor={cell.entry === null || cell.entry.dropped || !cell.entry.current}
              >
                {cell.label}
              </Text>
            </Text>
          ))}
        </Text>
      ))}

      <Text> </Text>

      <Viewport
        items={body}
        height={Math.max(0, height - headerRows)}
        cursor={cursor}
        scrollTop={scrollTop}
      />
    </Box>
  );
}
