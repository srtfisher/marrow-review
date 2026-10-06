export type StepId = 'pull' | 'context' | 'source' | 'abridge' | 'group' | 'find' | 'verify';
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface Step {
  id: StepId;
  label: string;
  state: StepState;
  detail: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

const LABELS: Record<StepId, string> = {
  pull: 'Fetch pull request',
  context: 'Threads and checks',
  source: 'Prepare review source',
  abridge: 'Abridge the diff',
  group: 'Group by intent',
  find: 'Review',
  verify: 'Verify findings',
};

export function initialSteps(): Step[] {
  return (Object.keys(LABELS) as StepId[]).map((id) => ({
    id, label: LABELS[id], state: 'pending', detail: null, startedAt: null, finishedAt: null,
  }));
}

export function setStep(
  steps: readonly Step[],
  id: StepId,
  state: StepState,
  now: number,
  detail?: string | null,
): Step[] {
  return steps.map((s) => {
    if (s.id !== id) return s;
    return {
      ...s,
      state,
      detail: detail === undefined ? s.detail : detail,
      startedAt: state === 'running' ? now : s.startedAt,
      finishedAt: state === 'running' || state === 'pending' ? null : now,
    };
  });
}
