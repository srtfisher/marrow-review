/** Seconds in each unit, largest last. */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

/**
 * How long ago `iso` was, in the shortest form that still says something:
 * `just now`, `5m ago`, `2h ago`, `3d ago`, `6w ago`, `2y ago`.
 *
 * `now` is a parameter rather than a call to `Date.now()` inside, so the
 * boundaries are testable without mocking the clock.
 *
 * Anything in the future — clock skew between GitHub and this machine — reads
 * `just now` rather than a negative age.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';

  const seconds = Math.floor((now.getTime() - then) / 1000);
  if (seconds < MINUTE) return 'just now';
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
  if (seconds < WEEK) return `${Math.floor(seconds / DAY)}d ago`;
  if (seconds < YEAR) return `${Math.floor(seconds / WEEK)}w ago`;
  return `${Math.floor(seconds / YEAR)}y ago`;
}
