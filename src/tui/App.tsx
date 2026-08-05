import { Box, Text } from 'ink';
import { theme } from './theme.js';

export interface AppProps {
  repoLabel: string;
}

export function App({ repoLabel }: AppProps) {
  return (
    <Box flexDirection="column">
      <Text {...theme.tier.primary}>{repoLabel}</Text>
    </Box>
  );
}
