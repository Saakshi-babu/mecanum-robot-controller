import { describe, expect, it } from 'vitest';
import { niceTicks } from './TimeSeriesChart';

describe('niceTicks', () => {
  it('always covers the data range', () => {
    for (const [lo, hi] of [[0, 0.316], [12.54, 12.58], [0, 70.4], [-3, 7], [5, 5]]) {
      const t = niceTicks(lo, hi);
      expect(t[0]).toBeLessThanOrEqual(lo);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(hi);
    }
  });
});
