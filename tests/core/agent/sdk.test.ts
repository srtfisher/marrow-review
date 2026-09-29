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
