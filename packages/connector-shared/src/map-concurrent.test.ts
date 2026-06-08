import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from './map-concurrent';

describe('mapWithConcurrency', () => {
  it('returns results in input order', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40]);
  });

  it('normalizes a non-finite concurrency to 1 instead of skipping all work', async () => {
    const out = await mapWithConcurrency(
      [1, 2, 3],
      Number.NaN,
      async (n) => n * 2,
    );
    expect(out).toEqual([2, 4, 6]);
  });

  it('returns an empty array for empty input without calling fn', async () => {
    let calls = 0;
    const out = await mapWithConcurrency([], 4, async () => {
      calls += 1;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('propagates the first rejection and stops starting new items', async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5], 1, async (n) => {
        started.push(n);
        if (n === 1) {
          throw new Error('boom');
        }
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(started).toEqual([0, 1]);
  });
});
