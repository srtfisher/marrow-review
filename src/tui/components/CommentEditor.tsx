import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from '../theme.js';

export interface CommentEditorProps {
  initial: string;
  isSuggestion: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

/** Inline comment/suggestion input. The prompt line is the `structure` token
 *  (position/navigation), the hint is `muted` (chrome) — never accent or
 *  danger, since typing a comment is neither unsubmitted-work nor a warning. */
export function CommentEditor({ initial, isSuggestion, onSubmit, onCancel }: CommentEditorProps) {
  const [value, setValue] = useState(initial);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column">
      <Text color={theme.color.structure}>{isSuggestion ? 'Suggestion' : 'Comment'}</Text>
      <TextInput value={value} onChange={setValue} onSubmit={() => onSubmit(value)} />
      <Text {...theme.tier.muted}>enter to save · esc to cancel</Text>
    </Box>
  );
}
