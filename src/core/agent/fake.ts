import type { AgentRequest, AgentRun, AgentTransport } from './types.js';

const EMPTY_RUN: AgentRun = {
  text: '',
  structured: null,
  sessionId: 'fake-session',
  usage: { inputTokens: 0, outputTokens: 0, numTurns: 1 },
  usageWarning: null,
};

/** Deterministic transport for tests. Never touches the network. */
export class FakeTransport implements AgentTransport {
  readonly requests: AgentRequest[] = [];
  private readonly queued: AgentRun[] = [];

  queue(run: Partial<AgentRun>): void {
    this.queued.push({ ...EMPTY_RUN, ...run });
  }

  async run(req: AgentRequest): Promise<AgentRun> {
    this.requests.push(req);
    const next = this.queued.shift();
    if (!next) {
      throw new Error(
        `FakeTransport queue is empty; got an unexpected run with prompt: ${req.prompt.slice(0, 80)}`,
      );
    }
    return next;
  }
}
