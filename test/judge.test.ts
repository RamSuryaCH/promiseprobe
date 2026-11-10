import { describe, expect, it } from 'vitest';
import { isPremature, judge } from '../src/judge.js';
import type { Observation, Verdict } from '../src/types.js';

function obs(patch: Partial<Observation>): Observation {
  return {
    guarantee: 'remote',
    scenario: 'response-delay',
    indicatorShown: false,
    indicatorAtMs: null,
    responseReceivedAtMs: null,
    durableAtMs: null,
    watchingDurability: false,
    persistence: { count: 0 },
    expectedCount: 1,
    ...patch,
  };
}

describe('judge', () => {
  const cases: Array<[string, Observation, Verdict]> = [
    [
      'early indicator, then one remote write',
      obs({ indicatorShown: true, indicatorAtMs: 20, responseReceivedAtMs: 800, persistence: { count: 1 } }),
      'premature-indicator',
    ],
    [
      'indicator after the response',
      obs({ indicatorShown: true, indicatorAtMs: 900, responseReceivedAtMs: 800, persistence: { count: 1 } }),
      'honoured',
    ],
    [
      'indicator inside the sampling slack',
      obs({ indicatorShown: true, indicatorAtMs: 140, responseReceivedAtMs: 180, persistence: { count: 1 } }),
      'honoured',
    ],
    [
      'claimed success and the request never landed',
      obs({
        scenario: 'request-dropped',
        indicatorShown: true,
        indicatorAtMs: 15,
        persistence: { count: 0 },
      }),
      'broken-promise',
    ],
    [
      'failed closed when the request was dropped',
      obs({ scenario: 'request-dropped', persistence: { count: 0 } }),
      'honoured',
    ],
    [
      'lost ack, honest UI, one committed write',
      obs({ scenario: 'response-dropped', persistence: { count: 1 } }),
      'honoured',
    ],
    [
      'lost ack, success shown, exactly one write',
      obs({
        scenario: 'response-dropped',
        indicatorShown: true,
        indicatorAtMs: 10,
        persistence: { count: 1 },
      }),
      'premature-indicator',
    ],
    [
      'lost ack retried into a second write',
      obs({
        scenario: 'response-dropped',
        indicatorShown: true,
        indicatorAtMs: 10,
        responseReceivedAtMs: 1400,
        persistence: { count: 2 },
      }),
      'duplicate-side-effect',
    ],
    [
      'restart cut the write',
      obs({
        scenario: 'restart-after-success',
        indicatorShown: true,
        indicatorAtMs: 20,
        persistence: { count: 0 },
      }),
      'broken-promise',
    ],
    [
      'restart kept a write that had been claimed early',
      obs({
        scenario: 'restart-after-success',
        indicatorShown: true,
        indicatorAtMs: 10,
        responseReceivedAtMs: 400,
        persistence: { count: 1 },
      }),
      'honoured',
    ],
    [
      'offline and no claim',
      obs({ scenario: 'offline', persistence: { count: 0 } }),
      'honoured',
    ],
    [
      'local write lands before the indicator',
      obs({
        guarantee: 'local',
        watchingDurability: true,
        indicatorShown: true,
        indicatorAtMs: 30,
        durableAtMs: 20,
        persistence: { count: 1 },
      }),
      'honoured',
    ],
    [
      'local indicator leads the durable write',
      obs({
        guarantee: 'local',
        watchingDurability: true,
        indicatorShown: true,
        indicatorAtMs: 10,
        durableAtMs: 400,
        persistence: { count: 1 },
      }),
      'premature-indicator',
    ],
    [
      'local claim with an empty store',
      obs({
        guarantee: 'local',
        scenario: 'offline',
        watchingDurability: true,
        indicatorShown: true,
        indicatorAtMs: 10,
        persistence: { count: 0 },
      }),
      'broken-promise',
    ],
    [
      'local guarantee ignores a missing network ack when the local write is there',
      obs({
        guarantee: 'local',
        scenario: 'request-dropped',
        watchingDurability: true,
        indicatorShown: true,
        indicatorAtMs: 40,
        durableAtMs: 30,
        persistence: { count: 1 },
      }),
      'honoured',
    ],
  ];

  it.each(cases)('%s', (_name, observation, verdict) => {
    expect(judge(observation).verdict).toBe(verdict);
  });

  it('keeps a premature flag on a duplicate', () => {
    const judgment = judge(
      obs({
        indicatorShown: true,
        indicatorAtMs: 5,
        responseReceivedAtMs: 900,
        persistence: { count: 2 },
      }),
    );
    expect(judgment.verdict).toBe('duplicate-side-effect');
    expect(judgment.flags).toContain('premature');
  });

  it('treats the slack boundary as not premature', () => {
    expect(isPremature(obs({ indicatorShown: true, indicatorAtMs: 100, responseReceivedAtMs: 150 }))).toBe(false);
    expect(isPremature(obs({ indicatorShown: true, indicatorAtMs: 100, responseReceivedAtMs: 151 }))).toBe(true);
  });

  it('does not call a local promise premature without a durability signal', () => {
    expect(
      isPremature(
        obs({
          guarantee: 'local',
          watchingDurability: false,
          indicatorShown: true,
          indicatorAtMs: 10,
        }),
      ),
    ).toBe(false);
  });
});
