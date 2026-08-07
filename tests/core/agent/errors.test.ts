import { test, expect } from 'bun:test';
import { agentErrorMessage, describeAgentFailure } from '../../../src/core/agent/errors.js';

test('names an install that has no Claude Code binary', () => {
  const failure = describeAgentFailure(
    new Error(
      'Claude Code native binary not found at /app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude.',
    ),
  );
  expect(failure.summary).toMatch(/reinstall marrow/i);
  // Claude Code ships with marrow, so `npm i -g @anthropic-ai/claude-code`
  // would send the reviewer after the wrong afternoon's work.
  expect(failure.summary).not.toMatch(/install claude code/i);
});

test('matches what the SDK actually says with its platform package missing', () => {
  // Verbatim from @anthropic-ai/claude-agent-sdk 0.3.222 with
  // node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64 removed.
  const failure = describeAgentFailure(
    new Error(
      'Native CLI binary for darwin-arm64 not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable.',
    ),
  );
  expect(failure.summary).toMatch(/reinstall marrow/i);
  // The SDK's own advice is about the SDK. Nobody installed it on purpose.
  expect(failure.retryable).toBe(false);
});

test('a spawn failure is the same fault under another name', () => {
  expect(describeAgentFailure(new Error('spawn claude ENOENT')).summary).toMatch(
    /reinstall marrow/i,
  );
});

test('sends an unauthenticated agent to sign in, not to reinstall', () => {
  const failure = describeAgentFailure(new Error('Invalid API key · Please run /login'));
  expect(failure.summary).toMatch(/could not authenticate/i);
  expect(failure.summary).toMatch(/--use-api-key/);
  expect(failure.summary).not.toMatch(/reinstall/i);
});

test('offers no retry for a cause that will not change between attempts', () => {
  expect(describeAgentFailure(new Error('spawn claude ENOENT')).retryable).toBe(false);
  expect(describeAgentFailure(new Error('Please run /login')).retryable).toBe(false);
});

test('an unrecognised failure is quoted, not guessed at, and is worth retrying', () => {
  const failure = describeAgentFailure(new Error('Agent run failed: error_during_execution'));
  expect(failure.summary).toBe('Agent run failed: error_during_execution');
  expect(failure.retryable).toBe(true);
});

test('keeps the failure own words even where the cause was recognised', () => {
  expect(describeAgentFailure(new Error('spawn claude ENOENT')).detail).toBe('spawn claude ENOENT');
});

test('never summarises to an empty string, which would render as no note at all', () => {
  expect(describeAgentFailure(new Error('')).summary).toMatch(/without saying why/);
});

test('takes the first line of a failure that quotes a whole stderr dump', () => {
  expect(agentErrorMessage(new Error('the reason\n  at somewhere\n  at elsewhere'))).toBe(
    'the reason',
  );
});
