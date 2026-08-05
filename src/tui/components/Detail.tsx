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
}

/** Cyan `▸` for the current row, two blank columns otherwise. Never reverse
 *  video here — that's reserved for the list pane's title row, and would fight
 *  the diff's own add/del colors. */
function cursorMark(selected: boolean) {
  return <Text color={theme.color.structure}>{selected ? `${theme.glyph.cursor} ` : '  '}</Text>;
}

function renderFileHeader(unit: Extract<ReviewUnit, { kind: 'file-header' }>, selected: boolean) {
  const dropped = unit.file.dropped;
  const path = unit.file.file.path;
  return (
    <Text key={unit.index} dimColor={dropped !== null}>
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
    <Text key={unit.index} {...theme.tier.muted}>
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
    <Box key={unit.index} flexDirection="column">
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
  if (unit.kind === 'finding') {
    return <FindingCard key={unit.index} finding={unit.finding} selected={selected} />;
  }
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
  pr, meat, units, cursor, scrollTop, height, checks, threads, showThreads,
}: DetailProps) {
  const failing = checks.filter((c) => c.conclusion === 'failure');
  const items = units.map((u) => renderUnit(u, u.index === cursor, threads, showThreads));
  const headerRows = detailHeaderRows(meat, checks);

  return (
    <Box flexDirection="column">
      {/* The PR title is the one bold element in this pane — nothing else competes. */}
      <Text {...theme.tier.primary}>{pr.title}</Text>
      <Text {...theme.tier.muted}>
        {`#${pr.number} · ${pr.author} · ${pr.baseRef} ← ${pr.headRef}`}
      </Text>
      {failing.length > 0 && (
        <Text color={theme.color.danger}>{`failing: ${failing.map((c) => c.name).join(', ')}`}</Text>
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
        height={Math.max(0, height - headerRows)}
        cursor={cursor}
        scrollTop={scrollTop}
      />
    </Box>
  );
}
