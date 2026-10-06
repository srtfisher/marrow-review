import { test, expect } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { SdkTransport } from '../../../src/core/agent/sdk.js';

function scripted(messages: unknown[]) {
  return (): AsyncIterable<SDKMessage> => (async function* () {
    for (const m of messages) yield m as SDKMessage;
  })();
}

test('a run that exhausts its schema retries says what the schema rejected', async () => {
  const rejection = {
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 't1',
        is_error: true,
        content: "Output does not match required schema: root: must have required property 'verdicts'",
      }],
    },
  };
  const transport = new SdkTransport({
    env: {},
    query: scripted([
      rejection,
      { type: 'result', subtype: 'error_max_structured_output_retries', session_id: 's1', errors: [] },
    ]),
  });

  await expect(transport.run({ model: 'haiku', prompt: 'x', schema: {} })).rejects.toThrow(
    "Agent run failed: error_max_structured_output_retries (root: must have required property 'verdicts')",
  );
});

test('a failure with no schema rejection is reported by its subtype alone', async () => {
  const transport = new SdkTransport({
    env: {},
    query: scripted([{ type: 'result', subtype: 'error_max_turns', session_id: 's1', errors: [] }]),
  });

  await expect(transport.run({ model: 'haiku', prompt: 'x' })).rejects.toThrow(
    /^Agent run failed: error_max_turns$/,
  );
});

test('in-process tools are served under the marrow MCP server', async () => {
  const { buildQueryOptions } = await import('../../../src/core/agent/sdk.js');
  const { toolName } = await import('../../../src/core/agent/types.js');
  const options = buildQueryOptions({
    model: 'haiku',
    prompt: 'x',
    tools: [{
      name: 'read_file',
      description: 'Reads a file.',
      params: { path: { type: 'string', description: 'Repository path.' } },
      handler: async () => 'contents',
    }],
  }, {});

  expect(Object.keys(options.mcpServers ?? {})).toEqual(['marrow']);
  expect(toolName('read_file')).toBe('mcp__marrow__read_file');
});

test('a run without tools starts no MCP server', async () => {
  const { buildQueryOptions } = await import('../../../src/core/agent/sdk.js');
  expect(buildQueryOptions({ model: 'haiku', prompt: 'x' }, {}).mcpServers).toBeUndefined();
});

test('a successful run reports its tokens, cache use, cost, and duration', async () => {
  const transport = new SdkTransport({
    env: {},
    query: scripted([{
      type: 'result', subtype: 'success', session_id: 's1', result: 'ok', num_turns: 2, duration_ms: 1234,
      total_cost_usd: 0.042, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 },
    }]),
  });
  const run = await transport.run({ model: 'haiku', prompt: 'x' });
  expect(run.usage).toEqual({
    inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, cacheCreationTokens: 50, costUsd: 0.042, durationMs: 1234, numTurns: 2,
  });
});

test('a failed run carries what it spent on the error', async () => {
  const { AgentRunError } = await import('../../../src/core/agent/types.js');
  const transport = new SdkTransport({
    env: {},
    query: scripted([{
      type: 'result', subtype: 'error_max_turns', session_id: 's1', errors: [], num_turns: 9, duration_ms: 5000,
      total_cost_usd: 0.3, usage: { input_tokens: 4000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }]),
  });
  const error = await transport.run({ model: 'haiku', prompt: 'x' }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AgentRunError);
  expect((error as InstanceType<typeof AgentRunError>).usage.inputTokens).toBe(4000);
});
