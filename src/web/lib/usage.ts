import type { PassUsage, UsagePass, UsageReport } from './types.js';

const ORDER: Array<{ pass: UsagePass; label: string }> = [
  { pass: 'abridge', label: 'Abridge' },
  { pass: 'group', label: 'Group' },
  { pass: 'find', label: 'Review' },
  { pass: 'verify', label: 'Score' },
  { pass: 'chat', label: 'Ask Claude' },
];

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/**
 * The headline figure: what the passes sent and received. Cache reads are
 * left out — they are the same context re-read at a tenth of the price, and
 * counting them makes a cheap run look enormous.
 */
export function headlineTokens(p: PassUsage): number {
  return p.inputTokens + p.cacheCreationTokens + p.outputTokens;
}

const NOTHING: PassUsage = {
  runs: 0, running: 0, failed: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, durationMs: 0, turns: 0, reads: 0,
};

/** `notes` say why a pass cost little or nothing, and give it a row even when it made no call. */
export function usageRows(
  report: UsageReport,
  notes: Partial<Record<UsagePass, string>> = {},
): Array<{ label: string; usage: PassUsage; note: string | null }> {
  return ORDER.flatMap(({ pass, label }) => {
    const usage = report[pass];
    const note = notes[pass] ?? null;
    if (!usage && !note) return [];
    return [{ label, usage: usage ?? NOTHING, note }];
  });
}
