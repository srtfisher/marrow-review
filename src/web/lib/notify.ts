import { isLow } from './findings.js';
import type { SessionSnapshot } from './types.js';

export interface ReviewProgress {
  id: string;
  number: number;
  pr: { title: string } | null;
  scoreThreshold: number;
  findings: {
    status: SessionSnapshot['findings']['status'];
    items: { score: number | null }[];
    error: { summary: string } | null;
  };
}

export interface ReviewNotice {
  title: string;
  body: string;
}

const RUNNING: readonly string[] = ['finding', 'verifying'];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * What to announce when a review lands, or null. Only a review seen running
 * counts: a cached reopen arrives already `done`, and saying so would be noise.
 */
export function reviewArrived(prev: ReviewProgress | null, next: ReviewProgress): ReviewNotice | null {
  if (!prev || prev.id !== next.id || !RUNNING.includes(prev.findings.status)) return null;
  const title = next.pr ? `#${next.number} ${next.pr.title}` : `#${next.number}`;
  if (next.findings.status === 'failed') {
    return { title, body: `Review failed: ${next.findings.error?.summary ?? 'unknown error'}` };
  }
  if (next.findings.status !== 'done') return null;
  const low = next.findings.items.filter((f) => isLow(f, next.scoreThreshold)).length;
  const shown = next.findings.items.length - low;
  if (shown === 0 && low === 0) return { title, body: 'No findings' };
  const parts = [plural(shown, 'finding')];
  if (low > 0) parts.push(`${low} low confidence`);
  return { title, body: parts.join(' · ') };
}
