export interface ShrinkAttempt {
  value: number;
  failed: boolean;
}

/**
 * Smallest integer in `[low, high]` that still fails.
 *
 * Assumes a single threshold: once a value fails, every larger value fails too.
 * The search probes `low` first, so a bug that fails with no added delay
 * collapses in one extra run. `fails` is invoked at most `maxSteps` times.
 */
export async function smallestFailing(
  low: number,
  high: number,
  fails: (value: number) => Promise<boolean>,
  maxSteps = 6,
): Promise<{ value: number | null; steps: ShrinkAttempt[] }> {
  if (low > high) return { value: null, steps: [] };
  const steps: ShrinkAttempt[] = [];

  const probe = async (value: number): Promise<boolean> => {
    const failed = await fails(value);
    steps.push({ value, failed });
    return failed;
  };

  if (steps.length >= maxSteps) return { value: null, steps };
  if (await probe(low)) return { value: low, steps };

  let lo = low + 1;
  let hi = high;
  let best: number | null = null;
  while (lo <= hi && steps.length < maxSteps) {
    const mid = Math.floor((lo + hi) / 2);
    if (await probe(mid)) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return { value: best, steps };
}
