import { Text } from 'ink';
import { theme } from '../theme.js';
import { fitHints, type Hint } from '../hints.js';

export interface HintBarProps {
  hints: readonly Hint[];
  /** Columns available, so hints degrade rather than truncate mid-word. */
  width: number;
  /** Unsubmitted work leads the bar in yellow — the one thing allowed to nag. */
  stagedCount?: number;
}

/**
 * The bottom row: what you can do to the thing under the cursor, right now.
 *
 * This replaced a status bar that restated the repository, the pull request
 * number, and the meat gauge — all three already in the header two rows up —
 * while the keys that actually operate the tool lived only behind `?`. A review
 * tool you have to memorise before you can use it is one you stop using, so the
 * one row we have goes to the verbs, and it changes with the cursor: a finding
 * offers accept and drop, a diff line offers comment and suggest.
 */
export function HintBar({ hints, width, stagedCount = 0 }: HintBarProps) {
  const nag = stagedCount > 0 ? `${theme.glyph.staged} ${stagedCount} staged   ` : '';
  const shown = fitHints(hints, Math.max(0, width - nag.length));

  return (
    <Text wrap="truncate">
      {nag.length > 0 && <Text color={theme.color.pending}>{nag}</Text>}
      {shown.map((hint, i) => (
        <Text key={hint.keys}>
          {i > 0 && <Text {...theme.tier.muted}>{'   '}</Text>}
          {/* The key is the only lit part: the eye lands on what to press. */}
          <Text color={theme.color.structure}>{hint.keys}</Text>
          <Text {...theme.tier.muted}>{` ${hint.label}`}</Text>
        </Text>
      ))}
    </Text>
  );
}
