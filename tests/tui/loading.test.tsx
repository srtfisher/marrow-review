import { test, expect, describe } from 'bun:test';
import { renderToString } from 'ink';
import { LoadingSteps } from '../../src/tui/components/LoadingSteps.js';
import {
  failStep, finishStep, loadSteps, startStep, withModelSteps, STEP,
  type LoadProgress, type ProgressStep,
} from '../../src/tui/progress.js';

function progress(steps: readonly ProgressStep[]): LoadProgress {
  return { prNumber: 547, steps };
}

/** Two steps done, the worktree running — the middle of a real open. */
function midFlight(): readonly ProgressStep[] {
  let steps: readonly ProgressStep[] = loadSteps();
  steps = finishStep(startStep(steps, STEP.pull, 0), STEP.pull, 600);
  steps = finishStep(startStep(steps, STEP.context, 600), STEP.context, 1_500);
  return startStep(steps, STEP.worktree, 1_500, 'git worktree at a3f21c8');
}

describe('LoadingSteps', () => {
  test('names the pull request it is loading', () => {
    const out = renderToString(<LoadingSteps progress={progress(loadSteps())} now={0} />);
    expect(out).toContain('Loading #547');
  });

  test('keeps completed steps on screen, marked done', () => {
    const out = renderToString(<LoadingSteps progress={progress(midFlight())} now={3_900} />);
    expect(out).toContain('pull request and diff');
    expect(out).toContain('review threads and checks');
    expect(out).toContain('✓');
  });

  test('shows elapsed time per step, frozen for the ones that finished', () => {
    const out = renderToString(<LoadingSteps progress={progress(midFlight())} now={3_900} />);
    expect(out).toContain('0.6s');
    expect(out).toContain('0.9s');
    // The running step is still counting: 3900 - 1500.
    expect(out).toContain('2.4s');
  });

  test('the running step is named, and steps yet to run are listed', () => {
    const out = renderToString(<LoadingSteps progress={progress(midFlight())} now={3_900} />);
    expect(out).toContain('git worktree at a3f21c8');
    expect(out).toContain('abridging the diff');
  });

  test('a step still pending shows no time at all', () => {
    const out = renderToString(<LoadingSteps progress={progress(loadSteps())} now={99_000} />);
    expect(out).not.toMatch(/\d+\.\d+s/);
    expect(out).not.toContain('✓');
  });

  // `NaN` beside a step, on the one screen whose job is to say nothing is
  // broken, is worse than saying nothing. It reached the render when a step
  // carried `undefined` for `startedAt` rather than `null` — the type says
  // `number | null`, but nothing stops a hand-built or round-tripped step.
  test('never renders NaN, whatever shape a pending step arrives in', () => {
    const hand: ProgressStep[] = [
      ...midFlight(),
      { id: 'x', label: 'abridging 12 files', state: 'pending', reason: null,
        startedAt: undefined as unknown as null, endedAt: undefined as unknown as null },
      { id: 'y', label: 'finding issues', state: 'pending', reason: null,
        startedAt: Number.NaN, endedAt: null },
    ];
    const out = renderToString(<LoadingSteps progress={progress(hand)} now={3_900} />);

    expect(out).not.toContain('NaN');
    expect(out).toContain('abridging 12 files');
    expect(out).toContain('finding issues');
  });

  test('renders without a React key warning', () => {
    const warnings: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    try {
      renderToString(<LoadingSteps progress={progress(midFlight())} now={3_900} />);
    } finally {
      console.error = realError;
    }
    expect(warnings).toEqual([]);
  });

  test('a failed step names its reason and the rest still run', () => {
    let steps: readonly ProgressStep[] = startStep(loadSteps(), STEP.worktree, 0);
    steps = failStep(steps, STEP.worktree, 'no space left on device', 400);
    steps = startStep(steps, STEP.abridge, 400, 'abridging 12 files');
    const out = renderToString(<LoadingSteps progress={progress(steps)} now={1_000} />);

    expect(out).toContain('no space left on device');
    expect(out).toContain('✗');
    expect(out).toContain('abridging 12 files');
  });

  test('lists the model passes once they are known to be coming', () => {
    const out = renderToString(
      <LoadingSteps progress={progress(withModelSteps(midFlight()))} now={3_900} />,
    );
    expect(out).toContain('finding issues');
    expect(out).toContain('verifying findings');
  });

  test('never uses an emoji marker', () => {
    const out = renderToString(<LoadingSteps progress={progress(midFlight())} now={3_900} />);
    expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
