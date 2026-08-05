import { Box, Text } from 'ink';
import type { TriagedFinding } from '../../core/findings/triage.js';
import { theme } from '../theme.js';

/** Typographic severity marks — no colored badge, no emoji: emoji cell width
 *  is unreliable across terminals and reads as toy. */
const SEVERITY_MARK: Record<TriagedFinding['severity'], string> = {
  critical: '!!',
  important: '!',
  minor: '·',
};

export interface FindingCardProps {
  finding: TriagedFinding;
  selected: boolean;
}

/**
 * A finding is model-authored content end to end — same rule as ChatPane's
 * agent turns — so the whole card renders in `theme.color.agent`, the one
 * token reserved for the model's words. Nothing else here reaches for another
 * color: that reservation is what lets a reviewer tell at a glance what the
 * model said apart from a colleague's thread comment or the code itself.
 *
 * The one exception is a refuted finding, which renders dim instead: the
 * verifier is telling you not to trust it, and dim is how this app always
 * says "still here, but discount it" (see the folded-noise rule).
 *
 * Selection follows the detail pane's cursor convention — a cyan `▸` in the
 * margin, never reverse video, which would fight the agent color here.
 */
export function FindingCard({ finding, selected }: FindingCardProps) {
  const refuted = finding.verdict === 'refuted';
  const body = finding.editedBody ?? finding.body;
  const cursor = selected ? `${theme.glyph.cursor} ` : '  ';

  return (
    <Box flexDirection="column" marginLeft={3}>
      <Text color={refuted ? undefined : theme.color.agent} dimColor={refuted}>
        <Text color={theme.color.structure}>{cursor}</Text>
        {`${SEVERITY_MARK[finding.severity]} ${finding.title}`}
        <Text {...theme.tier.muted}>{`  ${finding.severity}`}</Text>
        {finding.verdict !== 'confirmed' && (
          <Text {...theme.tier.muted}>{`  ${finding.verdict}`}</Text>
        )}
        {finding.state === 'accepted' && (
          <Text color={theme.color.pending}>{`  ${theme.glyph.staged} staged`}</Text>
        )}
      </Text>

      <Text color={refuted ? undefined : theme.color.agent} dimColor={refuted}>
        {`    ${body}`}
      </Text>

      {finding.suggestion !== null && (
        <Text {...theme.tier.muted}>{'    suggestion available — press s'}</Text>
      )}

      {refuted &&
        finding.refutations.map((r, i) => (
          <Text key={i} {...theme.tier.muted}>{`    refuted (${r.lens}): ${r.reasoning}`}</Text>
        ))}
    </Box>
  );
}
