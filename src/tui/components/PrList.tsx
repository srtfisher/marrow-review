import { Box, Text } from 'ink';
import type { PullFilter, PullRequestSummary } from '../../core/github/types.js';
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
      {searching && <Text {...theme.tier.primary}>/{query}</Text>}
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

  const headerLines = searching ? 2 : 1;
  const entryRows = Math.max(0, height - headerLines);
  const visibleEntries = Math.floor(entryRows / ROWS_PER_ENTRY);

  const items = visible.map((pr, i) => {
    const selected = i === cursor;
    const files = pr.changedFiles === 1 ? 'file' : 'files';
    return (
      <Box key={pr.number} flexDirection="column">
        <Text bold inverse={selected} wrap="truncate">
          {`#${pr.number} ${pr.isDraft ? '[draft] ' : ''}${pr.title}`}
        </Text>
        <Text {...theme.tier.muted} wrap="truncate">
          {`  ${pr.author} · ${pr.changedFiles} ${files}`}
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
