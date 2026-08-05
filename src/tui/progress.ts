/**
 * Staged progress for opening a pull request.
 *
 * Pure: every transition takes `now` and returns a new list, so the whole model
 * is testable without a clock and the only thing that has to tick is the
 * component reading `elapsed`.
 */

export type StepState = 'pending' | 'running' | 'done' | 'failed';

export interface ProgressStep {
  readonly id: string;
  readonly label: string;
  readonly state: StepState;
  /** Why it failed. Null unless `state` is `failed`. */
  readonly reason: string | null;
  /** Epoch ms it started running; null while still pending. */
  readonly startedAt: number | null;
  /** Epoch ms it settled, done or failed; null while running. */
  readonly endedAt: number | null;
}

export interface LoadProgress {
  readonly prNumber: number;
  readonly steps: readonly ProgressStep[];
}

/** Step ids, so the caller never spells one wrong in a string literal. */
export const STEP = {
  pull: 'pull',
  context: 'context',
  worktree: 'worktree',
  abridge: 'abridge',
  findings: 'findings',
  verify: 'verify',
} as const;

export function pendingStep(id: string, label: string): ProgressStep {
  return { id, label, state: 'pending', reason: null, startedAt: null, endedAt: null };
}

/**
 * The blocking steps, in the order they run. The model passes are not here:
 * they start only once the diff is on screen, and are appended by
 * `withModelSteps` when a worktree and a transport mean they will run at all.
 */
export function loadSteps(): ProgressStep[] {
  return [
    pendingStep(STEP.pull, 'pull request and diff'),
    pendingStep(STEP.context, 'review threads and checks'),
    pendingStep(STEP.worktree, 'git worktree'),
    pendingStep(STEP.abridge, 'abridging the diff'),
  ];
}

export function withModelSteps(steps: readonly ProgressStep[]): ProgressStep[] {
  return [
    ...steps,
    pendingStep(STEP.findings, 'finding issues'),
    pendingStep(STEP.verify, 'verifying findings'),
  ];
}

function replace(
  steps: readonly ProgressStep[],
  id: string,
  change: (step: ProgressStep) => ProgressStep,
): ProgressStep[] {
  return steps.map((step) => (step.id === id ? change(step) : step));
}

export function startStep(
  steps: readonly ProgressStep[],
  id: string,
  now: number,
  label?: string,
): ProgressStep[] {
  return replace(steps, id, (step) => ({
    ...step,
    // A step names itself as it starts, so `abridging 12 files` can only be
    // written once the file count exists.
    label: label ?? step.label,
    state: 'running',
    reason: null,
    startedAt: now,
    endedAt: null,
  }));
}

export function finishStep(
  steps: readonly ProgressStep[],
  id: string,
  now: number,
  label?: string,
): ProgressStep[] {
  return replace(steps, id, (step) => ({
    ...step,
    label: label ?? step.label,
    state: 'done',
    endedAt: now,
  }));
}

/**
 * A failed step stays in the list, red, with its reason — and everything after
 * it still runs. A worktree that could not be created already degrades the
 * review to diff-only; that has always been true and is now visible.
 */
export function failStep(
  steps: readonly ProgressStep[],
  id: string,
  reason: string,
  now: number,
): ProgressStep[] {
  return replace(steps, id, (step) => ({
    ...step,
    state: 'failed',
    reason,
    endedAt: now,
  }));
}

/**
 * How long the step has been running, or ran for. Null when there is no
 * answer — a step that has not started has not taken any time.
 *
 * Null rather than a number for every absent case, including a `startedAt`
 * that arrived as `undefined` or a clock that is not a number. The arithmetic
 * yields `NaN` there, and `NaN` printed beside a step on a screen whose whole
 * job is to say nothing is broken is worse than printing nothing at all.
 */
export function elapsedMs(step: ProgressStep, now: number): number | null {
  if (step.state === 'pending') return null;
  if (typeof step.startedAt !== 'number') return null;
  const ms = Math.max(0, (step.endedAt ?? now) - step.startedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * `0.6s` up to a minute, `2m 04s` past it. One decimal is what makes the
 * counter visibly move; minutes and seconds is what keeps a five-minute
 * abridging pass readable.
 */
export function formatElapsed(ms: number): string {
  // Nothing, rather than `NaNm NaNs`, for a duration that is not a duration.
  if (!Number.isFinite(ms)) return '';
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds - minutes * 60);
  return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}
