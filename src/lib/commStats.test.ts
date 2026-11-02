import { describe, expect, it } from 'vitest';
import { commStats, healthBuckets, type CommRecord } from './commStats';
import type { LatencySample } from '../types/models';

describe('commStats', () => {
  const recs: CommRecord[] = [
    ...Array.from({ length: 10 }, (_, k): CommRecord => ({ t: 500 + k * 100, kind: 'tx', source: 'simulated' })),
    ...Array.from({ length: 8 }, (_, k): CommRecord => ({ t: 520 + k * 100, kind: 'rx_ack', source: 'simulated' })),
    { t: 900, kind: 'rx_invalid', source: 'simulated' },
    { t: 950, kind: 'error', source: 'simulated' },
  ];
  const samples: LatencySample[] = [
    ...Array.from({ length: 8 }, (_, k): LatencySample => ({ seq: k, sentAt: 500 + k * 100, resolvedAt: 520 + k * 100, outcome: 'acked', rttMs: 20, source: 'simulated' })),
    { seq: 8, sentAt: 1300, resolvedAt: 1600, outcome: 'timeout', rttMs: null, source: 'simulated' },
    { seq: 9, sentAt: NaN, resolvedAt: 1700, outcome: 'late_ack', rttMs: null, source: 'simulated' },
  ];

  it('counts within the window and computes rates', () => {
    const s = commStats(recs, samples, 2000, 2000);
    expect(s.sent).toBe(10);
    expect(s.received).toBe(9);
    expect(s.invalid).toBe(1);
    expect(s.errors).toBe(1);
    expect(s.txRate).toBe(5);
    expect(s.acked).toBe(8);
    expect(s.timeouts).toBe(1);
    expect(s.ackRate).toBeCloseTo(8 / 9);
    expect(s.rejectedAcks).toBe(1);
  });

  it('reports null ack rate when nothing resolved', () => {
    expect(commStats([], [], 1000, 1000).ackRate).toBeNull();
  });

  it('buckets health events', () => {
    const b = healthBuckets(recs, samples, 1999, 2000, 1000);
    expect(b).toHaveLength(2);
    expect(b[0].acked + b[1].acked).toBe(8);
    expect(b[1].timeouts).toBe(1);
  });
});
