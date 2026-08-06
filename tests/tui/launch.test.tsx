import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { Launch } from '../../src/tui/components/Launch.js';
import { loadSteps, startStep, STEP } from '../../src/tui/progress.js';

describe('Launch', () => {
  test('the fetch state shows the wordmark, the repository, and the spinner label', () => {
    const out = renderToString(
      <Launch
        repoLabel="octocat/webapp" width={80} height={24}
        body={{ kind: 'spinner', label: 'fetching open pull requests…' }}
      />,
    );
    expect(out).toContain('█▄ ▄█');
    expect(out).toContain('a large diff, abridged to what carries meaning');
    expect(out).toContain('octocat/webapp');
    expect(out).toContain('fetching open pull requests…');
  });

  test('a failed fetch names the error and the two keys out of it', () => {
    const out = renderToString(
      <Launch
        repoLabel="octocat/webapp" width={80} height={24}
        body={{ kind: 'error', message: 'Could not list pull requests: boom' }}
      />,
    );
    expect(out).toContain('Could not list pull requests: boom');
    expect(out).toContain('r retry · q quit');
  });

  test('a direct open hosts the loading steps in the frame', () => {
    const progress = { prNumber: 42, steps: startStep(loadSteps(), STEP.pull, 0) };
    const out = renderToString(
      <Launch
        repoLabel="octocat/webapp" width={80} height={24}
        body={{ kind: 'steps', progress }} now={0}
      />,
    );
    expect(out).toContain('Loading #42');
  });

  // Covers the branch that steps down the wordmark's tier once the steps body
  // is hosted, so the loading progress stays the one bold element on screen.
  // renderToString runs without a TTY in this harness and emits no ANSI at
  // all (checked directly: no `bold`/`dim` escape codes appear for any tier),
  // so boldness itself isn't assertable here — this only proves the branch
  // still renders both the wordmark and the steps body together.
  test('hosting steps still draws the wordmark alongside the loading progress', () => {
    const progress = { prNumber: 42, steps: startStep(loadSteps(), STEP.pull, 0) };
    const out = renderToString(
      <Launch
        repoLabel="octocat/webapp" width={80} height={24}
        body={{ kind: 'steps', progress }} now={0}
      />,
    );
    expect(out).toContain('█▄ ▄█');
    expect(out).toContain('Loading #42');
  });

  test('a short terminal types the wordmark instead of drawing it', () => {
    const out = renderToString(
      <Launch
        repoLabel="octocat/webapp" width={80} height={10}
        body={{ kind: 'spinner', label: 'fetching open pull requests…' }}
      />,
    );
    expect(out).not.toContain('█▄ ▄█');
    expect(out).toContain('marrow');
  });
});
