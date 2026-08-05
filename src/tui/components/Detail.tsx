import { Box, Text } from 'ink';
import type { CheckRun, PullRequestDetail, ReviewThread } from '../../core/github/types.js';
import type { MeatResult } from '../../core/meat/index.js';
import type { ReviewUnit } from '../units.js';
import { DiffLines } from './DiffLines.js';
import { Viewport } from './Viewport.js';
import { FindingCard } from './FindingCard.js';
import { theme } from '../theme.js';
import { meatGauge } from '../gauge.js';

export interface DetailProps {
  pr: PullRequestDetail;
  meat: MeatResult;
  units: ReviewUnit[];
  cursor: number;
  scrollTop: number;
  height: number;
  checks: CheckRun[];
  threads: ReviewThread[];
  showThreads: boolean;
  /** Unsubmitted comments, shown here as well as in the status bar. */
  stagedCount?: number;
}

/** Cyan `▸` for the current row, two blank columns otherwise. Never reverse
 *  video here — that's reserved for the list pane's title row, and would fight
 *  the diff's own add/del colors. */
function cursorMark(selected: boolean) {
  return <Text color={theme.color.structure}>{selected ? `${theme.glyph.cursor} ` : '  '}</Text>;
}

/**
 * Reading is tight, navigating breathes: no blank rows inside a hunk, one
 * before every hunk after a file's first, and one before every file after the
 * first. A finding sits flush under the hunk it is about, because it is part of
 * reading that hunk rather than the next thing to navigate to.
 */
function leadsWithBlank(units: ReviewUnit[], index: number): boolean {
  const unit = units[index];
  if (!unit || index === 0) return false;
  if (unit.kind === 'file-header') return true;
  if (unit.kind === 'finding') return false;
  return units[index - 1]!.kind !== 'file-header';
}

function threadRows(unit: ReviewUnit, threads: ReviewThread[], showThreads: boolean): number {
  if (!showThreads) return 0;
  return threads
    .filter((t) => t.path === unit.file.file.path)
    .reduce((sum, t) => sum + t.comments.length, 0);
}

/**
 * Rows a unit occupies, which is what the viewport windows on. Long lines that
 * wrap are counted once — the pane clips rather than reflowing, so a wrapped
 * line costs a row of the next unit's space instead of the whole layout.
 */
export function unitHeight(
  units: ReviewUnit[],
  index: number,
  threads: ReviewThread[],
  showThreads: boolean,
): number {
  const unit = units[index];
  if (!unit) return 0;
  const lead = leadsWithBlank(units, index) ? 1 : 0;

  if (unit.kind === 'file-header' || unit.kind === 'dropped-summary') return lead + 1;

  if (unit.kind === 'hunk') {
    return lead + 1 + unit.hunk.hunk.lines.length + threadRows(unit, threads, showThreads);
  }

  const finding = unit.finding;
  const refutations = finding.verdict === 'refuted' ? finding.refutations.length : 0;
  return lead + 2 + (finding.suggestion !== null ? 1 : 0) + refutations;
}

export function unitHeights(
  units: ReviewUnit[],
  threads: ReviewThread[],
  showThreads: boolean,
): number[] {
  return units.map((_, i) => unitHeight(units, i, threads, showThreads));
}

function renderFileHeader(unit: Extract<ReviewUnit, { kind: 'file-header' }>, selected: boolean) {
  const dropped = unit.file.dropped;
  const path = unit.file.file.path;
  return (
    <Text dimColor={dropped !== null}>
      {cursorMark(selected)}
      <Text color={theme.color.structure}>{theme.glyph.cut}</Text>
      {` ${path}`}
      {dropped ? `  · dropped: ${dropped.rule}` : ''}
    </Text>
  );
}

function renderDroppedSummary(unit: Extract<ReviewUnit, { kind: 'dropped-summary' }>, selected: boolean) {
  const reasons = [...new Set(unit.file.hunks.filter((h) => !h.keep).map((h) => h.reason))];
  const label = `${unit.count} hunk${unit.count === 1 ? '' : 's'} folded`;
  return (
    <Text {...theme.tier.muted}>
      {cursorMark(selected)}
      {`${theme.glyph.fold.repeat(3)} ${label} · ${reasons.join(', ')} — press z to reveal ${theme.glyph.fold.repeat(3)}`}
    </Text>
  );
}

function renderHunk(
  unit: Extract<ReviewUnit, { kind: 'hunk' }>,
  selected: boolean,
  threads: ReviewThread[],
  showThreads: boolean,
) {
  const matching = showThreads
    ? threads.filter((t) => t.path === unit.file.file.path)
    : [];

  return (
    <Box flexDirection="column">
      <Text {...theme.tier.muted}>
        {cursorMark(selected)}
        {`${unit.hunk.hunk.header}  [${unit.hunk.reason}]`}
      </Text>
      <DiffLines hunk={unit.hunk.hunk} gutterWidth={theme.layout.gutterWidth} />
      {matching.map((thread, i) =>
        thread.comments.map((c, j) => (
          <Text key={`${i}-${j}`}>
            {'    '}
            <Text {...theme.tier.muted}>{`${c.author}: `}</Text>
            {c.body}
          </Text>
        )),
      )}
    </Box>
  );
}

function renderUnit(unit: ReviewUnit, selected: boolean, threads: ReviewThread[], showThreads: boolean) {
  if (unit.kind === 'file-header') return renderFileHeader(unit, selected);
  if (unit.kind === 'dropped-summary') return renderDroppedSummary(unit, selected);
  if (unit.kind === 'finding') return <FindingCard finding={unit.finding} selected={selected} />;
  return renderHunk(unit, selected, threads, showThreads);
}

/**
 * The header block is 4-6 rows depending on whether there's a failing check or
 * a summary; the viewport gets whatever height remains. Exported because the
 * app scrolls this pane and must use the same number the pane renders with.
 */
export function detailHeaderRows(meat: MeatResult, checks: CheckRun[]): number {
  const failing = checks.some((c) => c.conclusion === 'failure');
  return 2 + (failing ? 1 : 0) + (meat.summary.length > 0 ? 1 : 0) + 1;
}

export function Detail({
  pr, meat, units, cursor, scrollTop, height, checks, threads, showThreads, stagedCount = 0,
}: DetailProps) {
  const failing = checks.filter((c) => c.conclusion === 'failure');
  const heights = unitHeights(units, threads, showThreads);
  const items = units.map((unit, i) => (
    <Box key={unit.index} flexDirection="column" flexShrink={0}>
      {leadsWithBlank(units, i) && <Text> </Text>}
      {renderUnit(unit, unit.index === cursor, threads, showThreads)}
    </Box>
  ));
  const headerRows = detailHeaderRows(meat, checks);

  return (
    <Box flexDirection="column">
      {/* The PR title is the one bold element in this pane — nothing else competes. */}
      <Text {...theme.tier.primary}>{pr.title}</Text>
      <Text {...theme.tier.muted}>
        {`#${pr.number} · ${pr.author} · ${pr.baseRef} ← ${pr.headRef}`}
        {/* Unsubmitted work nags in both places it can be seen from. */}
        {stagedCount > 0 && (
          <Text color={theme.color.pending}>{`  ${theme.glyph.staged} ${stagedCount} staged`}</Text>
        )}
      </Text>
      {/* `danger` is red AND bold — that weight is the only thing separating it
          from `del`, which is the same red on every deleted line below. */}
      {failing.length > 0 && (
        <Text color={theme.color.danger} bold>
          {`failing: ${failing.map((c) => c.name).join(', ')}`}
        </Text>
      )}
      {meat.summary.length > 0 && <Text>{meat.summary}</Text>}
      {/* The meat gauge: the product's thesis in ten characters. Filled cells
          are green because they represent kept lines, which is the same meaning
          green carries everywhere else in this UI. */}
      <Text>
        <Text color={theme.color.add}>{meatGauge(meat.keptLines, meat.totalLines)}</Text>
        {/* "kept" is not redundant next to the gauge: a bare 1/2 could read as
            kept or as dropped, and the gauge does not disambiguate direction. */}
        {/* Not bold: the PR title is this pane's single focal element, and the
            gauge already carries the emphasis. Three bold things is none. */}
        <Text {...theme.tier.muted}>{'  kept '}</Text>
        {meat.keptLines}
        <Text {...theme.tier.muted}>{`/${meat.totalLines} lines · `}</Text>
        {meat.keptFiles}
        <Text {...theme.tier.muted}>{`/${meat.totalFiles} files`}</Text>
      </Text>
      <Viewport
        items={items}
        itemHeights={heights}
        height={Math.max(0, height - headerRows)}
        cursor={cursor}
        scrollTop={scrollTop}
      />
    </Box>
  );
}
