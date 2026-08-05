import { test, expect } from 'bun:test';
import { MARROW_VERSION } from '../src/core/version.js';

test('exports a semver version string', () => {
  expect(MARROW_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
