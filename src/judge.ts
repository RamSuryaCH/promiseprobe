import type { Judgment, Observation } from './types.js';

/**
 * Tolerance for the gap between "we noticed the indicator" and "the ack arrived".
 * Sampling runs every few tens of milliseconds, so a smaller gap is not evidence.
 */
export const PREMATURE_SLACK_MS = 50;

export function isPremature(observation: Observation): boolean {
  if (!observation.indicatorShown || observation.indicatorAtMs == null) return false;
  if (observation.guarantee === 'remote') {
    if (observation.responseReceivedAtMs == null) return true;
    return observation.indicatorAtMs + PREMATURE_SLACK_MS < observation.responseReceivedAtMs;
  }
  if (!observation.watchingDurability) return false;
  if (observation.durableAtMs == null) return true;
  return observation.indicatorAtMs + PREMATURE_SLACK_MS < observation.durableAtMs;
}

function formatMs(ms: number): string {
  return `${Math.round(ms)}ms`;
}

function guaranteeWord(observation: Observation): string {
  return observation.guarantee === 'remote' ? 'remote' : 'local';
}

function effects(count: number): string {
  return `${count} ${count === 1 ? 'effect' : 'effects'}`;
}

function prematureDetail(observation: Observation): string {
  const shown = formatMs(observation.indicatorAtMs ?? 0);
  if (observation.guarantee === 'remote') {
    if (observation.responseReceivedAtMs == null) {
      return `The success indicator appeared at ${shown}, and the page never received a successful response.`;
    }
    return `The success indicator appeared at ${shown}, before the response arrived at ${formatMs(observation.responseReceivedAtMs)}.`;
  }
  if (observation.durableAtMs == null) {
    return `The success indicator appeared at ${shown}, before the local write was durable.`;
  }
  return `The success indicator appeared at ${shown}, before the local write became durable at ${formatMs(observation.durableAtMs)}.`;
}

/**
 * Score one scenario.
 *
 * Duplicate effects win, because the user can observe two real writes.
 * A success claim with nothing recoverable is a broken promise, even if the
 * claim was also early. An early claim that does land exactly once is a
 * premature indicator. Restart is the exception: once the cut has happened,
 * that scenario asks whether the effect survived, and the delay scenario is
 * what scores an early indicator.
 *
 * A run that never claims success is honoured. PromiseProbe scores false
 * claims and duplicated effects, not a button that quietly does nothing.
 */
export function judge(observation: Observation): Judgment {
  const count = observation.persistence.count;
  const expected = observation.expectedCount;
  const premature = isPremature(observation);
  const persisted = observation.persistence.ok !== false && count === expected;
  const where = guaranteeWord(observation);

  if (count > expected) {
    return {
      verdict: 'duplicate-side-effect',
      flags: premature ? ['premature'] : [],
      rationale: `One action left ${effects(count)}; a ${where} guarantee expects ${expected}.`,
    };
  }

  if (observation.indicatorShown && !persisted) {
    return {
      verdict: 'broken-promise',
      flags: premature ? ['premature'] : [],
      rationale: premature
        ? `${prematureDetail(observation)} The ${where} check then found ${effects(count)}, not ${expected}.`
        : `The success indicator was shown, but the ${where} check found ${effects(count)}, not ${expected}.`,
    };
  }

  if (
    observation.indicatorShown &&
    persisted &&
    premature &&
    observation.scenario !== 'restart-after-success'
  ) {
    return {
      verdict: 'premature-indicator',
      flags: ['premature'],
      rationale: prematureDetail(observation),
    };
  }

  if (!observation.indicatorShown && !persisted) {
    return {
      verdict: 'honoured',
      flags: [],
      rationale: `The app did not claim success, and nothing was persisted. The interruption failed closed.`,
    };
  }

  if (!observation.indicatorShown && persisted) {
    return {
      verdict: 'honoured',
      flags: [],
      rationale: `The app did not claim success. The ${where} check still found the effect, so a reload can recover it without a second write.`,
    };
  }

  if (premature) {
    return {
      verdict: 'honoured',
      flags: ['premature'],
      rationale: `${prematureDetail(observation)} The effect still survived this scenario.`,
    };
  }

  return {
    verdict: 'honoured',
    flags: [],
    rationale: `The success indicator matched a single recoverable ${where} effect.`,
  };
}
