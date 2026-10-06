import { describe, expect, test } from 'bun:test';
import { reviewArrived, type ReviewProgress } from '../../src/web/lib/notify.js';

function progress(status: ReviewProgress['findings']['status'], scores: (number | null)[] = [], over: Partial<ReviewProgress> = {}): ReviewProgress {
  return {
    id: 's1',
    number: 123,
    pr: { title: 'Rework the cache' },
    scoreThreshold: 80,
    findings: { status, items: scores.map((score) => ({ score })), error: null },
    ...over,
  };
}

describe('reviewArrived', () => {
  test('announces findings when the review finishes scoring', () => {
    expect(reviewArrived(progress('verifying'), progress('done', [95, 85, 40, 20, 70]))).toEqual({
      title: '#123 Rework the cache',
      body: '2 findings · 3 low confidence',
    });
  });

  test('announces a review that ran without scoring', () => {
    expect(reviewArrived(progress('finding'), progress('done', [null]))?.body).toBe('1 finding');
  });

  test('says so when the review found nothing', () => {
    expect(reviewArrived(progress('verifying'), progress('done'))?.body).toBe('No findings');
  });

  test('announces a failed review with its summary', () => {
    const failed = progress('failed', [], { findings: { status: 'failed', items: [], error: { summary: 'Rate limited; retry later.' } } });
    expect(reviewArrived(progress('finding'), failed)?.body).toBe('Review failed: Rate limited; retry later.');
  });

  test('stays quiet for a cached reopen that arrives already done', () => {
    expect(reviewArrived(null, progress('done', [95]))).toBeNull();
    expect(reviewArrived(progress('idle'), progress('done', [95]))).toBeNull();
  });

  test('stays quiet between find and score', () => {
    expect(reviewArrived(progress('finding'), progress('verifying', [95]))).toBeNull();
  });

  test('stays quiet on a patch that leaves a finished review finished', () => {
    expect(reviewArrived(progress('done', [95]), progress('done', [95]))).toBeNull();
  });

  test('stays quiet when the find pass is off', () => {
    expect(reviewArrived(progress('idle'), progress('off'))).toBeNull();
  });

  test('does not carry a running status across to another pull request', () => {
    expect(reviewArrived(progress('verifying'), progress('done', [95], { id: 's2' }))).toBeNull();
  });

  test('falls back to the number before the pull request has loaded', () => {
    expect(reviewArrived(progress('finding'), progress('done', [], { pr: null }))?.title).toBe('#123');
  });
});
