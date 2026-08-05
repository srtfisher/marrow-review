import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { FindingCard } from '../../src/tui/components/FindingCard.js';
import { initTriage, accept } from '../../src/core/findings/triage.js';
import type { VerifiedFinding } from '../../src/core/findings/verify.js';

const base: VerifiedFinding = {
  id: 'f1', path: 'src/api.ts', line: 11, side: 'RIGHT', startLine: null,
  severity: 'important', title: 'Busy-wait', body: 'sleep(0) does not yield to the loop.',
  confidence: 'high', suggestion: null, verdict: 'confirmed', refutations: [],
};

describe('FindingCard', () => {
  test('shows the title, body, and severity', () => {
    const [f] = initTriage([base]);
    const out = renderToString(<FindingCard finding={f!} selected={false} />);
    expect(out).toContain('Busy-wait');
    expect(out).toContain('sleep(0) does not yield');
    expect(out.toLowerCase()).toContain('important');
  });

  test('marks an accepted finding as staged', () => {
    const list = accept(initTriage([base]), 'f1');
    const out = renderToString(<FindingCard finding={list[0]!} selected={false} />);
    expect(out).toContain('staged');
  });

  test('shows the refutation reasoning on a refuted finding', () => {
    const [f] = initTriage([{
      ...base, verdict: 'refuted',
      refutations: [{ lens: 'reachability', refuted: true, reasoning: 'guarded upstream' }],
    }]);
    const out = renderToString(<FindingCard finding={f!} selected={false} />);
    expect(out).toContain('guarded upstream');
  });

  test('distinguishes plausible from confirmed', () => {
    const [conf] = initTriage([base]);
    const [plaus] = initTriage([{ ...base, verdict: 'plausible' }]);
    const a = renderToString(<FindingCard finding={conf!} selected={false} />);
    const b = renderToString(<FindingCard finding={plaus!} selected={false} />);
    expect(a).not.toBe(b);
    expect(b.toLowerCase()).toContain('plausible');
  });

  test('shows that a suggestion is available', () => {
    const [f] = initTriage([{ ...base, suggestion: 'await sleep(1);' }]);
    const out = renderToString(<FindingCard finding={f!} selected={false} />);
    expect(out.toLowerCase()).toContain('suggestion');
  });
});
