import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { LoadProgress } from '../progress.js';
import { TAGLINE, WORDMARK } from '../wordmark.js';
import { LoadingSteps } from './LoadingSteps.js';
import { theme } from '../theme.js';

export type LaunchBody =
  | { kind: 'spinner'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'steps'; progress: LoadProgress };

export interface LaunchProps {
  repoLabel: string;
  width: number;
  height: number;
  body: LaunchBody;
  /** Frozen clock forwarded to LoadingSteps in tests. */
  now?: number;
}

/** Wordmark + tagline + blank + repo + blank + at least four body rows. */
const FULL_ROWS = 14;

/**
 * What running `marrow` shows before there is anything to pick from: the app
 * visibly starts, then loads. Errors land in this same frame rather than as
 * text dumped under the prompt — the alternate screen is already up, and a
 * reviewer mid-launch should be told what failed where they are looking.
 */
export function Launch({ repoLabel, width, height, body, now }: LaunchProps) {
  const art = height >= FULL_ROWS;

  return (
    <Box
      flexDirection="column"
      height={height}
      width={width}
      justifyContent="center"
      alignItems="center"
    >
      {art ? (
        WORDMARK.map((line, i) => (
          <Text key={i} {...theme.tier.primary} wrap="truncate">{line}</Text>
        ))
      ) : (
        <Text {...theme.tier.primary}>marrow</Text>
      )}
      {art && <Text {...theme.tier.tertiary} wrap="truncate">{TAGLINE}</Text>}
      <Text> </Text>
      <Text {...theme.tier.tertiary} wrap="truncate">{repoLabel}</Text>
      <Text> </Text>
      {body.kind === 'spinner' && (
        <Text {...theme.tier.tertiary} wrap="truncate">
          <Text color={theme.color.structure}><Spinner type="dots" />{'  '}</Text>
          {body.label}
        </Text>
      )}
      {body.kind === 'error' && (
        <Box flexDirection="column" alignItems="center">
          <Text color={theme.color.danger} bold wrap="truncate">{body.message}</Text>
          <Text {...theme.tier.muted}>r retry · q quit</Text>
        </Box>
      )}
      {body.kind === 'steps' && <LoadingSteps progress={body.progress} now={now} />}
    </Box>
  );
}
