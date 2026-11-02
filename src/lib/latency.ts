import type { DataSourceKind, LatencySample } from '../types/models';

/**
 * Command round-trip latency tracker.
 *
 * Definition: RTT = (browser clock when the matching ack is received)
 *                 − (browser clock immediately before the command is written to the transport).
 * Both timestamps come from the same clock (performance.now()-based by default), so clock offset
 * between browser and ESP32 does not matter. RTT includes: browser send path, network, ESP32
 * receive + command handling up to ack transmission, network back, browser receive path.
 * It does NOT include physical motor/wheel response.
 *
 * Rules:
 *  - An ack is matched by sequence number to an outstanding command.
 *  - No ack within `timeoutMs` → sample with outcome 'timeout' (rttMs = null, never 0).
 *  - Ack for a seq that already timed out → 'late_ack' (excluded from statistics).
 *  - Ack for a seq that was already acked → 'duplicate_ack' (excluded).
 *  - Ack for an unknown seq → 'unmatched_ack' (excluded).
 *  - Non-finite or negative computed RTT → 'invalid' (excluded).
 */
export class LatencyTracker {
  private pending = new Map<number, number>();
  private resolved = new Map<number, 'acked' | 'timeout'>();
  private readonly resolvedLimit = 5000;

  constructor(
    public timeoutMs: number,
    private readonly source: DataSourceKind,
  ) {}

  markSent(seq: number, sentAt: number): void {
    this.pending.set(seq, sentAt);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  onAck(seq: number, receivedAt: number): LatencySample {
    const sentAt = this.pending.get(seq);
    if (sentAt === undefined) {
      const prior = this.resolved.get(seq);
      const outcome = prior === 'timeout' ? 'late_ack' : prior === 'acked' ? 'duplicate_ack' : 'unmatched_ack';
      return { seq, sentAt: NaN, resolvedAt: receivedAt, outcome, rttMs: null, source: this.source };
    }
    this.pending.delete(seq);
    const rtt = receivedAt - sentAt;
    if (!Number.isFinite(rtt) || rtt < 0) {
      this.remember(seq, 'acked');
      return { seq, sentAt, resolvedAt: receivedAt, outcome: 'invalid', rttMs: null, source: this.source };
    }
    if (rtt > this.timeoutMs) {
      // Arrived after the deadline but before the sweep ran: still a timeout by policy.
      this.remember(seq, 'timeout');
      return { seq, sentAt, resolvedAt: receivedAt, outcome: 'late_ack', rttMs: null, source: this.source };
    }
    this.remember(seq, 'acked');
    return { seq, sentAt, resolvedAt: receivedAt, outcome: 'acked', rttMs: rtt, source: this.source };
  }

  /** Expire outstanding commands older than timeoutMs. Call periodically. */
  sweep(now: number): LatencySample[] {
    const out: LatencySample[] = [];
    for (const [seq, sentAt] of this.pending) {
      if (now - sentAt > this.timeoutMs) {
        this.pending.delete(seq);
        this.remember(seq, 'timeout');
        out.push({ seq, sentAt, resolvedAt: sentAt + this.timeoutMs, outcome: 'timeout', rttMs: null, source: this.source });
      }
    }
    return out;
  }

  reset(): void {
    this.pending.clear();
    this.resolved.clear();
  }

  private remember(seq: number, outcome: 'acked' | 'timeout'): void {
    this.resolved.set(seq, outcome);
    if (this.resolved.size > this.resolvedLimit) {
      const first = this.resolved.keys().next().value;
      if (first !== undefined) this.resolved.delete(first);
    }
  }
}

export interface LatencyStats {
  /** Number of valid RTT samples (outcome 'acked') in the window. */
  validCount: number;
  latestMs: number | null;
  meanMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  /** 95th percentile (nearest-rank). */
  p95Ms: number | null;
  timeouts: number;
  /** late, unmatched, duplicate and invalid acks. */
  rejected: number;
}

/**
 * Statistics over samples whose resolvedAt falls in [now - windowMs, now].
 * Only 'acked' samples contribute to latest/mean/min/max/p95. Empty window → nulls (never 0).
 */
export function latencyStats(samples: readonly LatencySample[], now: number, windowMs: number): LatencyStats {
  const start = now - windowMs;
  const values: number[] = [];
  let latest: number | null = null;
  let latestT = -Infinity;
  let timeouts = 0;
  let rejected = 0;
  for (const s of samples) {
    if (s.resolvedAt < start || s.resolvedAt > now) continue;
    if (s.outcome === 'acked' && s.rttMs !== null) {
      values.push(s.rttMs);
      if (s.resolvedAt >= latestT) {
        latestT = s.resolvedAt;
        latest = s.rttMs;
      }
    } else if (s.outcome === 'timeout') timeouts++;
    else rejected++;
  }
  if (values.length === 0) {
    return { validCount: 0, latestMs: null, meanMs: null, minMs: null, maxMs: null, p95Ms: null, timeouts, rejected };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const rank = Math.ceil(0.95 * sorted.length) - 1;
  return {
    validCount: values.length,
    latestMs: latest,
    meanMs: sum / values.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p95Ms: sorted[Math.max(0, rank)],
    timeouts,
    rejected,
  };
}
