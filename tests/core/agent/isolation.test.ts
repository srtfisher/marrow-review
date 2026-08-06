import { test, expect, describe } from 'bun:test';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { SdkTransport, buildQueryOptions } from '../../../src/core/agent/sdk.js';
import { DENIED_TOOLS, READ_ONLY_TOOLS } from '../../../src/core/findings/find.js';
import { ask } from '../../../src/core/findings/chat.js';
import { runFindings } from '../../../src/core/findings/find.js';
import { runVerify } from '../../../src/core/findings/verify.js';
import type { AgentRequest } from '../../../src/core/agent/types.js';
import type { MeatResult } from '../../../src/core/meat/index.js';

/**
 * `cwd` is a worktree at the pull request's head, so it is attacker-controlled
 * content. `settingSources: []` is what keeps `.claude/settings.json` — and the
 * shell commands its hooks can define — from being loaded out of it.
 */
function recordingQuery(seen: Options[]) {
  return ({ options }: { prompt: string; options: Options }): AsyncIterable<SDKMessage> => {
    seen.push(options);
    return (async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        session_id: 's1',
        result: '{}',
        structured_output: { findings: [], refuted: false, reasoning: 'x' },
        num_turns: 1,
        usage: { input_tokens: 1, output_tokens: 1 },
      } as unknown as SDKMessage;
    })();
  };
}

const meat: MeatResult = {
  summary: '', files: [], keptLines: 0, totalLines: 0, keptFiles: 0, totalFiles: 0,
  keptAdditions: 0, keptDeletions: 0, totalAdditions: 0, totalDeletions: 0,
  unclassified: 0,
};

describe('SdkTransport isolation', () => {
  test('never loads filesystem settings from the untrusted worktree', async () => {
    const seen: Options[] = [];
    const transport = new SdkTransport({ env: {}, query: recordingQuery(seen) });

    await transport.run({ model: 'opus', cwd: '/tmp/worktree', prompt: 'hi' });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.settingSources).toEqual([]);
  });

  test('every request the transport builds is isolated, whatever the caller asks for', async () => {
    const seen: Options[] = [];
    const transport = new SdkTransport({ env: {}, query: recordingQuery(seen) });

    const requests: AgentRequest[] = [
      { model: 'opus', cwd: '/tmp/w', prompt: 'plain' },
      { model: 'opus', cwd: '/tmp/w', prompt: 'resumed', resume: 'session-1' },
      { model: 'opus', cwd: '/tmp/w', prompt: 'schema', schema: { type: 'object' } },
      { model: 'opus', prompt: 'no cwd', systemPrompt: 'sys', maxTurns: 2 },
    ];
    for (const request of requests) await transport.run(request);

    expect(seen).toHaveLength(requests.length);
    for (const options of seen) expect(options.settingSources).toEqual([]);
  });

  test('the isolation survives every pass that reaches the worktree', async () => {
    const seen: Options[] = [];
    const transport = new SdkTransport({ env: {}, query: recordingQuery(seen) });
    const finding = {
      id: 'f1', path: 'a.ts', line: 1, side: 'RIGHT' as const, startLine: null,
      severity: 'minor' as const, title: 't', body: 'b',
      confidence: 'low' as const, suggestion: null,
    };

    await runFindings(transport, 'opus', {
      prTitle: 't', prBody: '', meat, threads: [], failingChecks: [],
    }, '/tmp/w');
    await runVerify(transport, 'opus', [finding], '/tmp/w');
    await ask(transport, 'opus', { id: null, turns: [] }, 'why?', '/tmp/w');

    expect(seen.length).toBeGreaterThanOrEqual(4);
    for (const options of seen) expect(options.settingSources).toEqual([]);
  });

  test('buildQueryOptions carries the stripped env through unchanged', () => {
    const options = buildQueryOptions({ model: 'opus', prompt: 'x' }, { PATH: '/usr/bin' });
    expect(options.settingSources).toEqual([]);
    expect(options.env).toEqual({ PATH: '/usr/bin' });
  });
});

describe('DENIED_TOOLS', () => {
  test('names every escape hatch rather than trusting a default', () => {
    for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'Task', 'WebFetch', 'WebSearch']) {
      expect(DENIED_TOOLS).toContain(tool as never);
    }
  });

  test('never denies a tool the read-only passes rely on', () => {
    for (const tool of READ_ONLY_TOOLS) {
      expect(DENIED_TOOLS).not.toContain(tool as never);
    }
  });
});
