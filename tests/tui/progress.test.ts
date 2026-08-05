import { test, expect, describe } from 'bun:test';
import {
  elapsedMs, failStep, finishStep, formatElapsed, loadSteps, startStep, withModelSteps, STEP,
  type ProgressStep,
} from '../../src/tui/progress.js';

function byId(steps: readonly ProgressStep[], id: string): ProgressStep {
  const step = steps.find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
}

describe('loadSteps', () => {
  test('names the blocking work in the order it runs, all pending', () => {
    const steps = loadSteps();
    expect(steps.map((s) => s.id)).toEqual([STEP.pull, STEP.context, STEP.worktree, STEP.abridge]);
    expect(steps.every((s) => s.state === 'pending')).toBe(true);
    expect(byId(steps, STEP.pull).label).toBe('pull request and diff');
    expect(byId(steps, STEP.context).label).toBe('review threads and checks');
  });

  test('the model passes are appended only when they will run', () => {
    expect(loadSteps().map((s) => s.id)).not.toContain(STEP.findings);
    const withModel = withModelSteps(loadSteps());
    expect(withModel.map((s) => s.id)).toEqual([
      STEP.pull, STEP.context, STEP.worktree, STEP.abridge, STEP.findings, STEP.verify,
    ]);
  });
});

describe('transitions', () => {
  test('a step runs, then finishes, keeping its start time', () => {
    let steps: readonly ProgressStep[] = loadSteps();
    steps = startStep(steps, STEP.pull, 1_000);
    expect(byId(steps, STEP.pull).state).toBe('running');
    expect(byId(steps, STEP.pull).endedAt).toBeNull();

    steps = finishStep(steps, STEP.pull, 1_600);
    expect(byId(steps, STEP.pull).state).toBe('done');
    expect(byId(steps, STEP.pull).startedAt).toBe(1_000);
    expect(byId(steps, STEP.pull).endedAt).toBe(1_600);
  });

  test('a step can name itself as it starts', () => {
    const steps = startStep(loadSteps(), STEP.abridge, 0, 'abridging 12 files');
    expect(byId(steps, STEP.abridge).label).toBe('abridging 12 files');
  });

  // A failed worktree already degraded the review to diff-only silently. The
  // steps after it must still be reachable, and the reason must be on screen.
  test('a failure records its reason and blocks nothing after it', () => {
    let steps: readonly ProgressStep[] = startStep(loadSteps(), STEP.worktree, 0);
    steps = failStep(steps, STEP.worktree, 'fatal: not a git repository', 500);
    expect(byId(steps, STEP.worktree).state).toBe('failed');
    expect(byId(steps, STEP.worktree).reason).toBe('fatal: not a git repository');

    steps = startStep(steps, STEP.abridge, 600);
    expect(byId(steps, STEP.abridge).state).toBe('running');
    expect(byId(steps, STEP.worktree).state).toBe('failed');
  });

  test('transitions do not mutate the list they are given', () => {
    const before = loadSteps();
    startStep(before, STEP.pull, 1);
    expect(before[0]!.state).toBe('pending');
  });
});

describe('elapsedMs', () => {
  test('is null while a step has not started', () => {
    expect(elapsedMs(loadSteps()[0]!, 5_000)).toBeNull();
  });

  test('counts up from the start while running', () => {
    const steps = startStep(loadSteps(), STEP.pull, 1_000);
    expect(elapsedMs(byId(steps, STEP.pull), 3_400)).toBe(2_400);
  });

  // `number | null` on the type does not stop `undefined` arriving from a
  // hand-built step, and the arithmetic turned it into NaN on screen.
  test('is null for a start time that is not a number', () => {
    const step = { ...loadSteps()[0]!, state: 'running' as const };
    expect(elapsedMs({ ...step, startedAt: undefined as unknown as null }, 5_000)).toBeNull();
    expect(elapsedMs({ ...step, startedAt: Number.NaN }, 5_000)).toBeNull();
    expect(elapsedMs({ ...step, startedAt: 0 }, Number.NaN)).toBeNull();
  });

  test('is null for a step marked pending however it got there', () => {
    const stale = { ...loadSteps()[0]!, startedAt: 1_000 };
    expect(elapsedMs(stale, 5_000)).toBeNull();
  });

  test('freezes at the end time once settled', () => {
    const steps = finishStep(startStep(loadSteps(), STEP.pull, 1_000), STEP.pull, 1_600);
    expect(elapsedMs(byId(steps, STEP.pull), 90_000)).toBe(600);
  });
});

describe('formatElapsed', () => {
  test('one decimal under a minute, so the counter visibly moves', () => {
    expect(formatElapsed(600)).toBe('0.6s');
    expect(formatElapsed(2_400)).toBe('2.4s');
    expect(formatElapsed(59_900)).toBe('59.9s');
  });

  test('minutes and padded seconds past a minute', () => {
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(124_000)).toBe('2m 04s');
  });

  test('nothing at all for a duration that is not a duration', () => {
    expect(formatElapsed(Number.NaN)).toBe('');
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('');
  });
});
