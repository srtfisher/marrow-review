import { Box, Text } from 'ink';
import type { PullFilter } from '../../core/github/types.js';
import { theme } from '../theme.js';

export interface WelcomeProps {
  /** `owner/name`, the repository this run is pointed at. */
  repoLabel: string;
  /** How many pull requests the current filter matched. */
  count: number;
  filter: PullFilter;
  /** Rows the pane may use. The panel is centred in them. */
  height: number;
  /** Columns the pane may use. A wrapped line breaks the row budget. */
  width: number;
}

/** The product in one line, when there is room for it. */
const TAGLINE = 'a large diff, abridged to what carries meaning';

/**
 * What is waiting, said in the filter's own terms. `9 open` is a lie when the
 * list is showing "needs my review", and `0 open` next to a hint about pressing
 * enter to review something is worse — it offers work that is not there.
 */
export function waitingLabel(count: number, filter: PullFilter): string {
  if (count === 0) {
    if (filter === 'review-requested') return 'nothing awaiting your review';
    if (filter === 'all') return 'no pull requests';
    return 'no open pull requests';
  }
  if (filter === 'review-requested') return `${count} awaiting your review`;
  if (filter === 'all') return `${count} pull request${count === 1 ? '' : 's'}`;
  return `${count} open`;
}

interface Hint {
  keys: string;
  label: string;
}

/**
 * Five or six keys, not the keymap — `?` is one of them and owns the rest.
 * Each entry is the pair that shares a row: navigation on the left, the
 * single-character commands on the right.
 *
 * With nothing in the list, the keys that act on a pull request are replaced
 * by the ones that would find one. Offering `enter  review` over an empty
 * list is a promise the screen cannot keep.
 */
export function starterHints(count: number): readonly (readonly [Hint, Hint])[] {
  if (count === 0) {
    return [
      [{ keys: '1 2 3', label: 'filter' }, { keys: '?', label: 'all keys' }],
      [{ keys: 'R', label: 'refresh' }, { keys: 'q', label: 'quit' }],
    ];
  }
  return [
    [{ keys: '↑↓  j k', label: 'move' }, { keys: '/', label: 'search' }],
    [{ keys: 'enter', label: 'review' }, { keys: '?', label: 'all keys' }],
    [{ keys: '1 2 3', label: 'filter' }, { keys: 'q', label: 'quit' }],
  ];
}

/**
 * The right pane before a pull request is open. The largest region on screen
 * at the moment a reviewer has the least idea what the tool is, so it answers
 * three questions and stops: what this is, where it is pointed, and which
 * handful of keys start the work.
 *
 * The rounded border is the one the reference project puts on its header, and
 * the design system sanctions it here for the same reason: a panel floating in
 * empty space needs an edge or it reads as stray text. Panes still separate by
 * tonal tiers, not boxes.
 */
/** Two border rows plus the wordmark and the repository line. */
const PANEL_MIN_ROWS = 4;
/** Those plus the tagline and the blank row under it. */
const PANEL_FULL_ROWS = 6;

/** Two border columns and the panel's own `paddingX`. */
const PANEL_CHROME_COLS = 4;

/**
 * What the panel can afford in this space. Ink does not clip a column that
 * overflows a fixed height — it draws the rows on top of each other — so the
 * panel sheds parts itself, in order of what a reviewer can most spare.
 *
 * Width matters for the same reason height does: a tagline that wraps costs a
 * row nobody budgeted, and the bottom border pays for it.
 */
export function welcomeFit(height: number, width: number, hintRows: number): {
  tagline: boolean;
  hints: boolean;
} {
  const room = width >= TAGLINE.length + PANEL_CHROME_COLS;
  if (room && height >= PANEL_FULL_ROWS + 1 + hintRows) return { tagline: true, hints: true };
  if (height >= PANEL_MIN_ROWS + 1 + hintRows) return { tagline: false, hints: true };
  return { tagline: false, hints: false };
}

export function Welcome({ repoLabel, count, filter, height, width }: WelcomeProps) {
  const rows = starterHints(count);
  // Each of the three columns is padded to its own contents, so the keys line
  // up as a grid instead of drifting apart behind the widest cell anywhere.
  const keyWidth = Math.max(...rows.map(([left]) => left.keys.length));
  const labelWidth = Math.max(...rows.map(([left]) => left.label.length));
  const rightKeyWidth = Math.max(...rows.map(([, right]) => right.keys.length));

  const fit = welcomeFit(height, width, rows.length);

  return (
    // Centred in the pane's own height: the empty space above and below is
    // what makes this read as composed rather than as an unfinished screen.
    // Never shorter than its contents, or Ink overdraws instead of clipping.
    <Box
      flexDirection="column"
      height={Math.max(height, PANEL_MIN_ROWS)}
      width={Math.max(1, width)}
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        alignSelf="flex-start"
        paddingX={1}
        borderStyle="round"
        borderColor={theme.color.structure}
        borderDimColor
      >
        {/* The one primary element on this screen. */}
        <Text {...theme.tier.primary} wrap="truncate">marrow</Text>
        {fit.tagline && (
          <>
            {/* truncate, never wrap: the row budget above assumes one row. */}
            <Text {...theme.tier.tertiary} wrap="truncate">{TAGLINE}</Text>
            <Text> </Text>
          </>
        )}
        <Text {...theme.tier.tertiary} wrap="truncate">
          {repoLabel}
          <Text {...theme.tier.muted}> · </Text>
          {waitingLabel(count, filter)}
        </Text>
      </Box>

      {/* marginTop rather than a blank <Text>: a spacer row is content Ink has
          to fit, and it collides with the panel once the pane gets short. */}
      {fit.hints && (
        <Box flexDirection="column" marginTop={1}>
          {rows.map(([left, right]) => (
            <Text key={left.keys}>
              {'  '}
              {/* The keys take the structure token so the eye can separate what
                  you press from what it does; the descriptions stay muted,
                  because they are chrome you read once. */}
              <Text color={theme.color.structure}>{left.keys.padEnd(keyWidth, ' ')}</Text>
              <Text {...theme.tier.muted}>{`  ${left.label.padEnd(labelWidth, ' ')}`}</Text>
              {'     '}
              <Text color={theme.color.structure}>{right.keys.padEnd(rightKeyWidth, ' ')}</Text>
              <Text {...theme.tier.muted}>{`  ${right.label}`}</Text>
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
