import { Box, Text } from 'ink';
import type { PullFilter, PullRequestSummary } from '../../core/github/types.js';
import { relativeTime } from '../../core/render/time.js';
import { Viewport } from './Viewport.js';
import { theme } from '../theme.js';
import { filterPrs } from '../search.js';

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

/** Every list entry is two terminal rows: title, then a dimmed metadata row. */
const ROWS_PER_ENTRY = 2;

/**
 * How many entries fit in a pane `height` rows tall. Exported because the app
 * scrolls this pane and must use the same number the pane renders with —
 * otherwise the cursor leaves the window before the view follows it.
 */
export function visibleEntryCount(height: number, searching: boolean): number {
  const headerLines = searching ? 2 : 1;
  return Math.floor(Math.max(0, height - headerLines) / ROWS_PER_ENTRY);
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
    </Box>
  );

  if (prs.length === 0) {
    return (
      <Box flexDirection="column" width={width}>
        {header}
        <Text {...theme.tier.muted}>No pull requests.</Text>
      </Box>
    );
  }

  if (visible.length === 0) {
    return (
      <Box flexDirection="column" width={width}>
        {header}
        <Text {...theme.tier.muted}>No match for &quot;{query}&quot;.</Text>
      </Box>
    );
  }

  const visibleEntries = visibleEntryCount(height, searching);

  const items = visible.map((pr, i) => {
    const selected = i === cursor;
    return (
      <Box key={pr.number} flexDirection="column">
        <Text bold inverse={selected} wrap="truncate">
          {`#${pr.number} ${pr.isDraft ? '[draft] ' : ''}${pr.title}`}
        </Text>
        {/* `pulls.list` sends no file count, so there is none to show. When it
            was last touched is what actually helps pick the next review. */}
        <Text {...theme.tier.muted} wrap="truncate">
          {`  ${pr.author} · ${relativeTime(pr.updatedAt)}`}
        </Text>
      </Box>
    );
  });

  return (
    <Box flexDirection="column" width={width}>
      {header}
      <Viewport
        items={items}
        height={visibleEntries}
        cursor={cursor}
        scrollTop={scrollTop}
      />
    </Box>
  );
}
