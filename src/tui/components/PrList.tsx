import { Box, Text } from 'ink';
import type { PullFilter, PullRequestSummary } from '../../core/github/types.js';
import { relativeTime } from '../../core/render/time.js';
import { Viewport } from './Viewport.js';
import { theme } from '../theme.js';
import { filterPrs } from '../search.js';
import { computeWindow } from '../viewport.js';

export function filterLabel(filter: PullFilter): string {
  if (filter === 'open') return 'Open';
  if (filter === 'review-requested') return 'Needs my review';
  return 'All';
}

export interface PrListProps {
  prs: PullRequestSummary[];
  cursor: number;
  scrollTop: number;
  height: number;
  filter: PullFilter;
  width: number;
  /** Live search text. Empty means no narrowing. */
  query: string;
  /** True while the user is typing a query, so the input line is shown. */
  searching: boolean;
}

/**
 * Three terminal rows per entry: title, a dimmed `author · when` row, then a
 * blank one. Dense within a row, airy between groups — two-row entries stacked
 * flush against each other got the first half right and read as a wall.
 */
const ROWS_PER_ENTRY = 3;

/**
 * Rows the pane spends on itself: the filter line, the query line while
 * searching, the blank row under the header, and the position indicator.
 *
 * The indicator's row is reserved whether or not it is showing. It appears the
 * moment the list scrolls, and a row that arrives unbudgeted would push the
 * status bar off the bottom of the screen.
 */
function chromeRows(searching: boolean): number {
  return (searching ? 2 : 1) + 1 + 1;
}

/**
 * How many entries fit in a pane `height` rows tall. Exported because the app
 * scrolls this pane and must use the same number the pane renders with —
 * otherwise the cursor leaves the window before the view follows it.
 */
export function visibleEntryCount(height: number, searching: boolean): number {
  return Math.floor(Math.max(0, height - chromeRows(searching)) / ROWS_PER_ENTRY);
}

export function PrList({
  prs, cursor, scrollTop, height, filter, width, query, searching,
}: PrListProps) {
  const visible = filterPrs(prs, query);
  const narrowed = query.length > 0 && visible.length !== prs.length;

  const header = (
    <Box flexDirection="column">
      <Text>
        {filterLabel(filter)} · {visible.length}
        {narrowed ? ` of ${prs.length}` : ''}
      </Text>
      {/* The query is navigation state, so it takes the structure token — not
          bold, which is reserved for the one focal element per view. */}
      {searching && <Text color={theme.color.structure}>/{query}</Text>}
      {/* Air under the header, before the first entry. */}
      <Text> </Text>
    </Box>
  );

  // paddingX on every pane: text flush against the terminal edge reads as
  // unfinished, and the reference project pads the same way.
  if (prs.length === 0) {
    return (
      <Box flexDirection="column" width={width} paddingX={1}>
        {header}
        <Text {...theme.tier.muted}>No pull requests.</Text>
      </Box>
    );
  }

  if (visible.length === 0) {
    return (
      <Box flexDirection="column" width={width} paddingX={1}>
        {header}
        <Text {...theme.tier.muted}>No match for &quot;{query}&quot;.</Text>
      </Box>
    );
  }

  const visibleEntries = visibleEntryCount(height, searching);
  const window = computeWindow(visible.length, visibleEntries, cursor, scrollTop);
  const scrolls = visible.length > visibleEntries;

  const items = visible.map((pr, i) => {
    const selected = i === cursor;
    return (
      <Box key={pr.number} flexDirection="column">
        <Text wrap="truncate">
          {/* A marker and brightness, never reverse video: a full-width inverse
              bar is the heaviest thing on screen and fights everything around
              it. Unselected rows get two spaces, so the text does not shift
              sideways as the cursor moves. */}
          <Text color={theme.color.structure}>
            {selected ? `${theme.glyph.select} ` : '  '}
          </Text>
          <Text bold={selected}>
            {`#${pr.number} ${pr.isDraft ? '[draft] ' : ''}${pr.title}`}
          </Text>
        </Text>
        {/* `pulls.list` sends no file count, so there is none to show. When it
            was last touched is what actually helps pick the next review. */}
        <Text {...theme.tier.muted} wrap="truncate">
          {`    ${pr.author} · ${relativeTime(pr.updatedAt)}`}
        </Text>
        <Text> </Text>
      </Box>
    );
  });

  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      {header}
      <Viewport
        items={items}
        height={visibleEntries}
        cursor={cursor}
        scrollTop={scrollTop}
      />
      {/* Where you are in a list you cannot see all of. Muted: it is chrome. */}
      {scrolls && (
        <Text {...theme.tier.muted} wrap="truncate">
          {`  ${window.start + 1}–${window.end} of ${visible.length}`}
        </Text>
      )}
    </Box>
  );
}
