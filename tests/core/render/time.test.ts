import { test, expect, describe } from 'bun:test';
import { relativeTime } from '../../../src/core/render/time.js';

const now = new Date('2026-08-05T12:00:00Z');

/** `seconds` before `now`, as GitHub would send it. */
function ago(seconds: number): string {
  return new Date(now.getTime() - seconds * 1000).toISOString();
}

describe('relativeTime', () => {
  test('anything under a minute is just now', () => {
    expect(relativeTime(ago(0), now)).toBe('just now');
    expect(relativeTime(ago(59), now)).toBe('just now');
  });

  test('crosses into minutes at exactly sixty seconds', () => {
    expect(relativeTime(ago(60), now)).toBe('1m ago');
    expect(relativeTime(ago(5 * 60), now)).toBe('5m ago');
    expect(relativeTime(ago(59 * 60 + 59), now)).toBe('59m ago');
  });

  test('crosses into hours at exactly an hour', () => {
    expect(relativeTime(ago(3600), now)).toBe('1h ago');
    expect(relativeTime(ago(2 * 3600), now)).toBe('2h ago');
    expect(relativeTime(ago(23 * 3600 + 3599), now)).toBe('23h ago');
  });

  test('crosses into days at exactly a day', () => {
    expect(relativeTime(ago(86400), now)).toBe('1d ago');
    expect(relativeTime(ago(3 * 86400), now)).toBe('3d ago');
    expect(relativeTime(ago(6 * 86400 + 86399), now)).toBe('6d ago');
  });

  test('crosses into weeks at exactly seven days', () => {
    expect(relativeTime(ago(7 * 86400), now)).toBe('1w ago');
    expect(relativeTime(ago(6 * 7 * 86400), now)).toBe('6w ago');
  });

  test('crosses into years rather than counting past fifty weeks', () => {
    expect(relativeTime(ago(365 * 86400), now)).toBe('1y ago');
    expect(relativeTime(ago(2 * 365 * 86400), now)).toBe('2y ago');
  });

  // GitHub's clock and this machine's disagree by a second or two often enough
  // that `-1s ago` would be a real thing reviewers saw.
  test('a future timestamp reads just now, not a negative age', () => {
    expect(relativeTime(ago(-30), now)).toBe('just now');
  });

  test('an unparseable timestamp says so instead of NaN', () => {
    expect(relativeTime('not a date', now)).toBe('unknown');
  });

  test('defaults to the real clock when no now is supplied', () => {
    expect(relativeTime(new Date().toISOString())).toBe('just now');
  });
});
