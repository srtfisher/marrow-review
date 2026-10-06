import { AgentRunError, type AgentRequest, type AgentRun, type AgentTransport, type UsageSummary } from './types.js';

export const USAGE_PASSES = ['abridge', 'group', 'find', 'verify', 'chat'] as const;
export type UsagePass = (typeof USAGE_PASSES)[number];

export interface PassUsage {
  runs: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  /** Summed per run, so concurrent runs add up past the wall clock. */
  durationMs: number;
}

export type UsageReport = Partial<Record<UsagePass, PassUsage>>;

const ZERO: PassUsage = {
  runs: 0, failed: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, durationMs: 0,
};

function add(total: PassUsage, usage: UsageSummary | null, failed: boolean): PassUsage {
  return {
    runs: total.runs + 1,
    failed: total.failed + (failed ? 1 : 0),
    inputTokens: total.inputTokens + (usage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (usage?.outputTokens ?? 0),
    cacheReadTokens: total.cacheReadTokens + (usage?.cacheReadTokens ?? 0),
    cacheCreationTokens: total.cacheCreationTokens + (usage?.cacheCreationTokens ?? 0),
    costUsd: total.costUsd + (usage?.costUsd ?? 0),
    durationMs: total.durationMs + (usage?.durationMs ?? 0),
  };
}

export function totalUsage(report: UsageReport): PassUsage {
  return Object.values(report).reduce<PassUsage>((sum, p) => ({
    runs: sum.runs + p.runs,
    failed: sum.failed + p.failed,
    inputTokens: sum.inputTokens + p.inputTokens,
    outputTokens: sum.outputTokens + p.outputTokens,
    cacheReadTokens: sum.cacheReadTokens + p.cacheReadTokens,
    cacheCreationTokens: sum.cacheCreationTokens + p.cacheCreationTokens,
    costUsd: sum.costUsd + p.costUsd,
    durationMs: sum.durationMs + p.durationMs,
  }), ZERO);
}

/**
 * Counts what each pass spends by wrapping the transport it is handed, so no
 * pass has to know it is being metered. A failed run still counts: the tokens
 * were spent whether or not an answer came back.
 */
export class UsageMeter {
  private report: UsageReport = {};

  constructor(private readonly onChange: (report: UsageReport) => void = () => {}) {}

  snapshot(): UsageReport {
    return this.report;
  }

  transport(pass: UsagePass, inner: AgentTransport): AgentTransport {
    return {
      run: async (req: AgentRequest): Promise<AgentRun> => {
        try {
          const run = await inner.run(req);
          this.record(pass, run.usage, false);
          return run;
        } catch (error) {
          this.record(pass, error instanceof AgentRunError ? error.usage : null, true);
          throw error;
        }
      },
    };
  }

  private record(pass: UsagePass, usage: UsageSummary | null, failed: boolean): void {
    this.report = { ...this.report, [pass]: add(this.report[pass] ?? ZERO, usage, failed) };
    this.onChange(this.report);
  }
}
