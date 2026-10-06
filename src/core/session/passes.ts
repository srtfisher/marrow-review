/** Which model passes a review runs. Copied into each session when it opens. */
export interface PassSettings {
  abridge: boolean;
  group: boolean;
  find: boolean;
  verify: boolean;
}

export const PASS_NAMES = ['abridge', 'group', 'find', 'verify'] as const satisfies readonly (keyof PassSettings)[];

export const ALL_PASSES: PassSettings = { abridge: true, group: true, find: true, verify: true };

/** Every pass runs by default. Verify (scoring) is one cheap call per finding, and the threshold depends on it. */
export const DEFAULT_PASSES: PassSettings = { ...ALL_PASSES };

/** Null unless `raw` is exactly four booleans, one per pass. */
export function parsePassSettings(raw: unknown): PassSettings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!PASS_NAMES.every((name) => typeof r[name] === 'boolean')) return null;
  return { abridge: r.abridge as boolean, group: r.group as boolean, find: r.find as boolean, verify: r.verify as boolean };
}
