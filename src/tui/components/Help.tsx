import { Box, Text } from 'ink';
import { KEY_HELP } from '../keymap.js';
import { theme } from '../theme.js';

/**
 * Generated from `KEY_HELP` rather than written by hand, so a binding cannot
 * exist without being documented — the drift only ever goes one way otherwise.
 */
export function Help() {
  const width = Math.max(...KEY_HELP.map((e) => e.keys.length));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text {...theme.tier.primary}>Keys</Text>
      {KEY_HELP.map((entry) => (
        <Text key={entry.keys}>
          {`  ${entry.keys.padEnd(width, ' ')}  `}
          <Text {...theme.tier.muted}>{entry.description}</Text>
        </Text>
      ))}
      <Text {...theme.tier.muted}>esc to close</Text>
    </Box>
  );
}
