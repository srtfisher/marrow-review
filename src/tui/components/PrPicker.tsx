import { Box, Text } from 'ink';
import type { PullRequestSummary } from '../../core/github/types.js';
import { relativeTime } from '../../core/render/time.js';
import type { LoadProgress } from '../progress.js';
import { buildEntries, layoutPicker, pickerWindow } from '../picker.js';
import { TAGLINE, WORDMARK } from '../wordmark.js';
import { theme } from '../theme.js';
import { LoadingSteps } from './LoadingSteps.js';

export interface PrPickerProps {
  /** Already filtered by the query — App filters once, this renders. */
  prs: PullRequestSummary[];
  /** The unfiltered count, for `N of M`. */
  total: number;
  query: string;
  cursor: number;
  /** Entry index of the first visible entry (from pickerScroll). */
  scrollTop: number;
  height: number;
  width: number;
  warmPrNumber: number | null;
  /** A PR being opened from the picker: steps replace the entry region. */
  progress?: LoadProgress | null;
  now?: number;
}

const PREFIX = 'filter › ';
const CARET = theme.glyph.selected;

/**
 * The filter line's three zones: the fixed prefix and caret never move, the
 * query eats whatever room is left, and the count is pinned to the right
 * edge. When the query alone would overflow, it loses its front rather than
 * its end — the character just typed is the one that has to stay visible.
 */
function filterLine(query: string, matched: number, total: number, innerWidth: number) {
  const narrowed = query.length > 0 && matched !== total;
  const right = narrowed ? `${matched} of ${total}` : `${total}`;
  const budget = Math.max(0, innerWidth - PREFIX.length - CARET.length - right.length);
  const shown = query.length > budget ? query.slice(query.length - budget) : query;
  const left = `${PREFIX}${shown}${CARET}`;
  const middle = ' '.repeat(Math.max(0, innerWidth - left.length - right.length));
  return { shown, middle, right };
}

export function PrPicker({
  prs, total, query, cursor, scrollTop, height, width, warmPrNumber, progress, now,
}: PrPickerProps) {
  const innerWidth = Math.max(0, width - 2);
  const layout = layoutPicker(height, innerWidth);
  const entries = buildEntries(prs, innerWidth);
  const { shown, middle, right } = filterLine(query, prs.length, total, innerWidth);

  const heights = entries.map((entry) => entry.height);
  const window = pickerWindow(heights, layout.entryRows, scrollTop);
  const visible = entries.slice(window.start, window.end);
  const scrolls = window.end - window.start < entries.length;

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1}>
      {layout.banner && (
        <>
          {WORDMARK.map((line, i) => (
            <Text key={i} {...theme.tier.primary} wrap="truncate">{line}</Text>
          ))}
          <Text {...theme.tier.tertiary} wrap="truncate">{TAGLINE}</Text>
          <Text> </Text>
        </>
      )}
      <Text wrap="truncate">
        <Text color={theme.color.structure}>{PREFIX}</Text>
        <Text {...theme.tier.secondary}>{shown}</Text>
        <Text color={theme.color.structure}>{CARET}</Text>
        {middle}
        <Text {...theme.tier.muted}>{right}</Text>
      </Text>
      <Text> </Text>
      {progress != null ? (
        <LoadingSteps progress={progress} now={now} />
      ) : prs.length === 0 ? (
        <Box height={layout.entryRows} alignItems="center" justifyContent="center">
          <Text {...theme.tier.muted} wrap="truncate">
            {total === 0 ? 'No pull requests.' : `No match for "${query}".`}
          </Text>
        </Box>
      ) : (
        <>
          <Box flexDirection="column">
            {visible.map((entry, i) => {
              const index = window.start + i;
              const selected = index === cursor;
              const warm = entry.pr.number === warmPrNumber;
              return (
                <Box key={entry.pr.number} flexDirection="column">
                  {entry.titleLines.map((line, lineIndex) => (
                    <Text key={lineIndex} wrap="truncate">
                      {lineIndex === 0 ? (
                        <>
                          <Text color={theme.color.structure}>
                            {selected ? `${theme.glyph.select} ` : '  '}
                          </Text>
                          <Text bold={selected}>{line}</Text>
                        </>
                      ) : (
                        `      ${line}`
                      )}
                    </Text>
                  ))}
                  <Text {...theme.tier.muted} wrap="truncate">
                    {`    ${entry.pr.author} · ${relativeTime(entry.pr.updatedAt)}`}
                    {warm && (
                      <Text color={theme.color.pending}>
                        {` · ${theme.glyph.staged} reviewing`}
                      </Text>
                    )}
                  </Text>
                  <Text> </Text>
                </Box>
              );
            })}
          </Box>
          {scrolls && (
            <Text {...theme.tier.muted} wrap="truncate">
              {`  ${window.start + 1}–${window.end} of ${entries.length}`}
            </Text>
          )}
        </>
      )}
    </Box>
  );
}
