import { test, expect } from 'bun:test';
import { initialSteps, setStep } from '../../../src/core/session/steps.js';

test('updating a running step keeps its start time, so its timer keeps counting', () => {
  let steps = setStep(initialSteps(), 'find', 'running', 1000);
  steps = setStep(steps, 'find', 'running', 5000, '3 files read');
  const find = steps.find((s) => s.id === 'find')!;
  expect(find.startedAt).toBe(1000);
  expect(find.detail).toBe('3 files read');
});

test('a step run again after finishing starts its timer over', () => {
  let steps = setStep(initialSteps(), 'find', 'running', 1000);
  steps = setStep(steps, 'find', 'done', 2000);
  steps = setStep(steps, 'find', 'running', 9000);
  expect(steps.find((s) => s.id === 'find')!.startedAt).toBe(9000);
});
