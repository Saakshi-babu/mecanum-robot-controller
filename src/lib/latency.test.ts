import { describe, expect, it } from 'vitest';
import { LatencyTracker, latencyStats } from './latency';
import type { LatencySample } from '../types/models';

const acked = (rtt: number, at: number): LatencySample => ({ seq: at, sentAt: at - rtt, resolvedAt: at, outcome: 'acked', rttMs: rtt, source: 'simulated' });

describe('LatencyTracker', () => {
  it('computes RTT from matched seq', () => {
    const t = new LatencyTracker(300, 'simulated');
    t.markSent(1, 1000);
    const s = t.onAck(1, 1025);
    expect(s.outcome).toBe('acked');
    expect(s.rttMs).toBe(25);
  });

  it('rejects unmatched, duplicate and late acks', () => {
    const t = new LatencyTracker(300, 'simulated');
    expect(t.onAck(99, 10).outcome).toBe('unmatched_ack');
    t.markSent(1, 0);
    t.onAck(1, 10);
    expect(t.onAck(1, 20).outcome).toBe('duplicate_ack');
    t.markSent(2, 0);
    const expired = t.sweep(301);
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ seq: 2, outcome: 'timeout', rttMs: null, resolvedAt: 300 });
    expect(t.onAck(2, 400).outcome).toBe('late_ack');
  });

  it('treats ack after deadline but before sweep as late, never as a valid sample', () => {
    const t = new LatencyTracker(100, 'simulated');
    t.markSent(5, 0);
    const s = t.onAck(5, 150);
    expect(s.outcome).toBe('late_ack');
    expect(s.rttMs).toBeNull();
  });

  it('rejects negative RTT as invalid', () => {
    const t = new LatencyTracker(100, 'simulated');
    t.markSent(1, 500);
    expect(t.onAck(1, 400).outcome).toBe('invalid');
  });

  it('does not expire commands before the timeout', () => {
    const t = new LatencyTracker(300, 'simulated');
    t.markSent(1, 0);
    expect(t.sweep(300)).toHaveLength(0);
    expect(t.pendingCount).toBe(1);
  });
});

describe('latencyStats', () => {
  it('returns nulls (not zero) for an empty window', () => {
    const s = latencyStats([], 1000, 1000);
    expect(s).toMatchObject({ validCount: 0, latestMs: null, meanMs: null, minMs: null, maxMs: null, p95Ms: null });
  });

  it('computes mean/min/max/p95 over valid samples in window only', () => {
    const samples: LatencySample[] = [
      acked(100, 0), // outside window
      acked(10, 9100),
      acked(20, 9200),
      acked(30, 9300),
      acked(40, 9400),
      { seq: 77, sentAt: 9000, resolvedAt: 9500, outcome: 'timeout', rttMs: null, source: 'simulated' },
      { seq: 78, sentAt: NaN, resolvedAt: 9600, outcome: 'unmatched_ack', rttMs: null, source: 'simulated' },
    ];
    const s = latencyStats(samples, 10000, 1000);
    expect(s.validCount).toBe(4);
    expect(s.meanMs).toBe(25);
    expect(s.minMs).toBe(10);
    expect(s.maxMs).toBe(40);
    expect(s.latestMs).toBe(40);
    expect(s.p95Ms).toBe(40);
    expect(s.timeouts).toBe(1);
    expect(s.rejected).toBe(1);
  });
});
