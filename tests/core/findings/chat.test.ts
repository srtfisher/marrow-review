import { test, expect, describe } from 'bun:test';
import { ask, buildChatContext } from '../../../src/core/findings/chat.js';
import { FakeTransport } from '../../../src/core/agent/fake.js';

const hunkContext = {
  path: 'src/api.ts',
  header: '@@ -10,2 +10,3 @@ retry()',
  lines: [
    { kind: 'context' as const, text: 'function retry() {' },
    { kind: 'add' as const, text: '  await sleep(0);' },
  ],
};

describe('buildChatContext', () => {
  test('includes the path, header, and lines with markers', () => {
    const ctx = buildChatContext(hunkContext);
    expect(ctx).toContain('src/api.ts');
    expect(ctx).toContain('@@ -10,2 +10,3 @@');
    expect(ctx).toContain('+  await sleep(0);');
  });
});

describe('ask', () => {
  test('the first question starts a session and records both turns', async () => {
    const transport = new FakeTransport();
    transport.queue({ text: 'Because sleep(0) resolves immediately.', sessionId: 's1' });

    const session = await ask(transport, 'opus', { id: null, turns: [] }, 'why?', '/tmp/wt');
    expect(session.id).toBe('s1');
    expect(session.turns).toEqual([
      { role: 'user', text: 'why?' },
      { role: 'agent', text: 'Because sleep(0) resolves immediately.' },
    ]);
    expect(transport.requests[0]!.resume).toBeUndefined();
  });

  test('a follow-up resumes the existing session rather than starting over', async () => {
    const transport = new FakeTransport();
    transport.queue({ text: 'second', sessionId: 's1' });

    await ask(transport, 'opus', { id: 's1', turns: [{ role: 'user', text: 'first' }] }, 'more?', '/tmp/wt');
    expect(transport.requests[0]!.resume).toBe('s1');
  });

  test('a failure appends an error turn instead of throwing', async () => {
    const transport = { async run() { throw new Error('SDK died'); } };
    const session = await ask(transport as never, 'opus', { id: null, turns: [] }, 'why?', '/tmp/wt');
    expect(session.turns).toHaveLength(2);
    expect(session.turns[1]!.role).toBe('agent');
    expect(session.turns[1]!.text.toLowerCase()).toContain('could not');
  });

  test('chat is read-only too', async () => {
    const transport = new FakeTransport();
    transport.queue({ text: 'x', sessionId: 's1' });
    await ask(transport, 'opus', { id: null, turns: [] }, 'q', '/tmp/wt');
    expect(transport.requests[0]!.disallowedTools).toContain('Bash');
  });
});
