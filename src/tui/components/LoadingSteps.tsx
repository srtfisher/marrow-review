import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { elapsedMs, formatElapsed, type LoadProgress, type ProgressStep } from '../progress.js';
import { theme } from '../theme.js';

/**
 * Fast enough that the tenths digit really moves. The counter, not the step
 * list, is what proves the process is alive — a static list of named steps is
 * as indistinguishable from a hang as `Loading #547…` was.
 */
const TICK_MS = 100;

/** Widest label plus a gap, so the elapsed times line up in a column. */
const LABEL_WIDTH = 28;

export interface LoadingStepsProps {
  progress: LoadProgress;
  /** A frozen clock, for tests. Live and ticking when omitted. */
  now?: number;
}

function marker(step: ProgressStep) {
  if (step.state === 'done') return <Text {...theme.tier.muted}>{`${theme.glyph.done}  `}</Text>;
  if (step.state === 'failed') {
    return <Text color={theme.color.danger} bold>{`${theme.glyph.failed}  `}</Text>;
  }
  if (step.state === 'running') {
    // Same spinner, same type, same accent slot as the reference project.
    return (
      <Text color={theme.color.structure}>
        <Spinner type="dots" />
        {'  '}
      </Text>
    );
  }
  return <Text>{'   '}</Text>;
}

function StepRow({ step, now }: { step: ProgressStep; now: number }) {
  const ms = elapsedMs(step, now);
  const time = ms === null ? '' : formatElapsed(ms);

  if (step.state === 'failed') {
    return (
      <Text wrap="truncate">
        {marker(step)}
        {/* Named and red, and the steps after it still run: a worktree that
            could not be made degrades the review to diff-only rather than
            ending it, and that has to be visible rather than merely true. */}
        <Text color={theme.color.danger} bold>
          {`${step.label} — ${step.reason ?? 'failed'}`}
        </Text>
      </Text>
    );
  }

  const tone = step.state === 'running'
    ? theme.tier.secondary
    : step.state === 'done'
      ? theme.tier.tertiary
      : theme.tier.muted;

  return (
    <Text wrap="truncate">
      {marker(step)}
      {/* Padded into a column only when there is a time to line up against;
          a step that has not started shows no time and needs no column. */}
      <Text {...tone}>{time === '' ? step.label : step.label.padEnd(LABEL_WIDTH)}</Text>
      {time !== '' && <Text {...theme.tier.muted}>{time}</Text>}
    </Text>
  );
}

/**
 * What opening a pull request looks like while it is happening: every step
 * named, the finished ones kept on screen, the running one spinning, and an
 * elapsed counter that advances. Fetching, worktree, and abridging take seconds
 * to minutes, and the reviewer is blocked on all of it.
 */
export function LoadingSteps({ progress, now }: LoadingStepsProps) {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (now !== undefined) return;
    const id = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [now]);

  const clock = now ?? tick;

  return (
    // No paddingX here: the pane this renders into already has it, and two
    // panels' worth would indent the steps twice.
    <Box flexDirection="column">
      {/* This pane's one bold element while it is loading. */}
      <Text {...theme.tier.primary}>{`Loading #${progress.prNumber}`}</Text>
      <Text> </Text>
      {progress.steps.map((step) => (
        <StepRow key={step.id} step={step} now={clock} />
      ))}
    </Box>
  );
}
