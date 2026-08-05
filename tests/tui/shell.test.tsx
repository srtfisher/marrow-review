import { test, expect } from 'bun:test';
import { renderToString } from 'ink';
import { App } from '../../src/tui/App.js';

test('renders the repo label in the shell', () => {
  const out = renderToString(<App repoLabel="srtfisher/marrow" />);
  expect(out).toContain('srtfisher/marrow');
});
