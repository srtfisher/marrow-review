import { test, expect } from 'bun:test';
import { buildSubprocessEnv } from '../../../src/core/agent/sdk.js';

const source = {
  PATH: '/usr/bin',
  HOME: '/Users/srtfisher',
  ANTHROPIC_API_KEY: 'sk-ant-leaked',
  ANTHROPIC_AUTH_TOKEN: 'tok-leaked',
};

test('strips Anthropic credentials so the subscription is used', () => {
  const env = buildSubprocessEnv(source, false);
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  expect(env.PATH).toBe('/usr/bin');
  expect(env.HOME).toBe('/Users/srtfisher');
});

test('preserves credentials when the user opts into API billing', () => {
  const env = buildSubprocessEnv(source, true);
  expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-leaked');
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok-leaked');
});

test('identifies marrow in the User-Agent', () => {
  const env = buildSubprocessEnv(source, false);
  expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toMatch(/^marrow\//);
});
