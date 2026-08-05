import { Box, Text } from 'ink';
import type { ChatSession } from '../../core/findings/chat.js';
import { theme } from '../theme.js';

export interface ChatPaneProps {
  session: ChatSession;
  pending: boolean;
}

/** Turn-by-turn chat about the hunk under the cursor. User turns read at the
 *  `secondary` tier — a colleague's words, no different from a comment body.
 *  Agent turns get the `agent` magenta, the one token reserved for
 *  model-authored content, so the two voices are never confused.
 *
 *  This is the one pane in the app allowed a pending indicator: the reviewer
 *  explicitly asked a question and is waiting on the answer, so a muted
 *  "thinking…" line is honest rather than decorative. */
export function ChatPane({ session, pending }: ChatPaneProps) {
  return (
    <Box flexDirection="column">
      {session.turns.length === 0 && !pending ? (
        <Text {...theme.tier.muted}>Ask a question about this hunk.</Text>
      ) : null}
      {session.turns.map((turn, i) => (
        <Text key={i} {...theme.tier.secondary} color={turn.role === 'agent' ? theme.color.agent : undefined}>
          {turn.text}
        </Text>
      ))}
      {pending ? <Text {...theme.tier.muted}>thinking…</Text> : null}
    </Box>
  );
}
