import { describe, expect, it } from 'vitest';
import { smallestFailing } from '../src/reduce.js';

describe('smallestFailing', () => {
  it('returns the low end when that already fails', async () => {
    const seen: number[] = [];
    const result = await smallestFailing(0, 500, async (value) => {
      seen.push(value);
      return true;
    });
    expect(result.value).toBe(0);
    expect(seen).toEqual([0]);
  });

  it('finds the threshold', async () => {
    const result = await smallestFailing(0, 40, async (value) => value >= 10);
    expect(result.value).toBe(10);
    expect(result.steps.some((step) => step.value === 10 && step.failed)).toBe(true);
    expect(result.steps.some((step) => step.value < 10 && step.failed)).toBe(false);
  });

  it('returns null when nothing fails', async () => {
    const result = await smallestFailing(0, 8, async () => false, 4);
    expect(result.value).toBeNull();
    expect(result.steps.length).toBeLessThanOrEqual(4);
  });

  it('stops at the step budget', async () => {
    const result = await smallestFailing(0, 10_000, async (value) => value >= 9_000, 3);
    expect(result.steps).toHaveLength(3);
  });
});
