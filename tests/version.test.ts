import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { MARROW_VERSION } from '../src/core/version.js';

test('exports a semver version string', () => {
  expect(MARROW_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

// `npm version` rewrites package.json and nothing else, so the constant the
// agent reports as its client version would silently keep the old number. This
// test is the only thing that makes a forgotten bump fail rather than ship.
test('matches the version in package.json', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  expect(MARROW_VERSION).toBe(pkg.version);
});
