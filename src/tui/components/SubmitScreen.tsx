import { Box, Text } from 'ink';
import type { DiffFile } from '../../core/diff/types.js';
import { findAnchorProblems } from '../../core/review/anchors.js';
import type { ReviewDraft, Verdict } from '../../core/review/types.js';
import { theme } from '../theme.js';

export interface SubmitScreenProps {
  draft: ReviewDraft;
  files: DiffFile[];
  viewerIsAuthor: boolean;
  selected: Verdict;
  onSelect: (verdict: Verdict) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const LABELS: Array<{ verdict: Verdict; label: string }> = [
  { verdict: 'APPROVE', label: 'Approve' },
  { verdict: 'REQUEST_CHANGES', label: 'Request changes' },
  { verdict: 'COMMENT', label: 'Comment' },
];

export function SubmitScreen({
  draft, files, viewerIsAuthor, selected,
}: SubmitScreenProps) {
  const problems = findAnchorProblems(draft, files);

  return (
    <Box flexDirection="column">
      <Text color={theme.heading}>Submit review</Text>

      {LABELS.map(({ verdict, label }) => {
        const blocked = verdict === 'APPROVE' && viewerIsAuthor;
        return (
          <Text key={verdict} inverse={verdict === selected} color={blocked ? theme.muted : undefined}>
            {`  ${label}${blocked ? '  (cannot approve your own pull request — GitHub rejects it)' : ''}`}
          </Text>
        );
      })}

      <Text> </Text>
      <Text color={theme.accent}>{draft.comments.length} inline comment(s)</Text>

      {problems.length > 0 && (
        <Text color={theme.danger}>
          {`${problems.length} comment(s) cannot anchor to the diff and will be moved into the review body.`}
        </Text>
      )}

      {draft.body.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted}>Review body:</Text>
          <Text>{draft.body}</Text>
        </Box>
      )}

      <Text color={theme.muted}>enter to submit · esc to go back</Text>
    </Box>
  );
}
