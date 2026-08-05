import { Text } from 'ink';
import type { MeatResult } from '../../core/meat/index.js';
import { theme } from '../theme.js';
import { meatGauge } from '../gauge.js';

export interface StatusBarProps {
  repoLabel: string;
  prNumber: number;
  meat: MeatResult;
  stagedCount: number;
  model: string;
  worktreeOk: boolean;
}

/** One line, dim throughout except the staged count — unsubmitted work is the
 *  one thing here allowed to nag, so it gets the `pending` yellow. */
export function StatusBar({
  repoLabel, prNumber, meat, stagedCount, model, worktreeOk,
}: StatusBarProps) {
  return (
    <Text {...theme.tier.muted}>
      {`${repoLabel}#${prNumber}  `}
      <Text color={theme.color.add}>{meatGauge(meat.keptLines, meat.totalLines)}</Text>
      {` kept ${meat.keptLines}/${meat.totalLines} · `}
      <Text color={theme.color.pending}>{`${theme.glyph.staged} ${stagedCount} staged`}</Text>
      {` · ${model} · ${worktreeOk ? 'worktree ok' : 'diff-only'}`}
    </Text>
  );
}
