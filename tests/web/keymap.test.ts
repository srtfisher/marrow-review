import { test, expect } from 'bun:test';
import { actionFor, ariaKey, keyLabel, SHORTCUTS } from '../../src/web/lib/keymap.js';

test('no key is bound twice', () => {
  const keys = SHORTCUTS.map((s) => s.key);
  expect(new Set(keys).size).toBe(keys.length);
});

test('submit is not on a letter beside the triage keys', () => {
  expect(actionFor('!')).toBe('submit');
  expect(actionFor('f')).toBeNull();
});

test('shifted keys are labeled and announced as shifted', () => {
  expect(keyLabel('range')).toBe('⇧V');
  expect(ariaKey('range')).toBe('Shift+V');
  expect(ariaKey('comment')).toBe('c');
});

test('arrow keys move like j and k', () => {
  expect(actionFor('ArrowDown')).toBe('down');
  expect(actionFor('ArrowUp')).toBe('up');
});
