import type { DataSourceKind, LatencySample } from '../types/models';

/**
 * Communication records counted by the dashboard.
 *  - tx:            a command message written to the transport (includes heartbeats).
 *  - rx_ack:        a well-formed acknowledgement received (matched or not).
 *  - rx_telemetry:  a well-formed telemetry frame received.
 *  - rx_invalid:    a received message that failed parsing/validation.
 *  - error:         a transport error (socket error, send failure).
 *  - reconnect:     a successful reconnection after a disconnect.
 */
export type CommRecordKind = 'tx' | 'rx_ack' | 'rx_telemetry' | 'rx_invalid' | 'error' | 'reconnect';

export interface CommRecord {
  t: number;
  kind: CommRecordKind;
  source: DataSourceKind;
}

export interface CommStats {
  windowSec: number;
  sent: number;
  received: number;
  /** Messages sent per second over the window. */
  txRate: number;
  /** Messages received per second over the window. */
  rxRate: number;
  acked: number;
  timeouts: number;
  /** acked / (acked + timeouts) over commands resolved in the window; null if none resolved. Pending commands are excluded. */
  ackRate: number | null;
  invalid: number;
  /** late + duplicate + unmatched acks. */
  rejectedAcks: number;
  errors: number;
  reconnects: number;
}

export function commStats(
  records: readonly CommRecord[],
  samples: readonly LatencySample[],
  now: number,
  windowMs: number,
): CommStats {
  const start = now - windowMs;
  let sent = 0, received = 0, invalid = 0, errors = 0, reconnects = 0;
  for (const r of records) {
    if (r.t < start || r.t > now) continue;
    switch (r.kind) {
      case 'tx': sent++; break;
      case 'rx_ack':
      case 'rx_telemetry': received++; break;
      case 'rx_invalid': received++; invalid++; break;
      case 'error': errors++; break;
      case 'reconnect': reconnects++; break;
    }
  }
  let acked = 0, timeouts = 0, rejectedAcks = 0;
  for (const s of samples) {
    if (s.resolvedAt < start || s.resolvedAt > now) continue;
    if (s.outcome === 'acked') acked++;
    else if (s.outcome === 'timeout') timeouts++;
    else if (s.outcome !== 'invalid') rejectedAcks++;
  }
  const windowSec = windowMs / 1000;
  return {
    windowSec,
    sent,
    received,
    txRate: sent / windowSec,
    rxRate: received / windowSec,
    acked,
    timeouts,
    ackRate: acked + timeouts > 0 ? acked / (acked + timeouts) : null,
    invalid,
    rejectedAcks,
    errors,
    reconnects,
  };
}

export interface HealthBucket {
  t: number;
  acked: number;
  timeouts: number;
  invalid: number;
}

/** Per-bucket counts for the health timeline. Buckets are [t, t + bucketMs). */
export function healthBuckets(
  records: readonly CommRecord[],
  samples: readonly LatencySample[],
  now: number,
  windowMs: number,
  bucketMs: number,
): HealthBucket[] {
  const n = Math.max(1, Math.ceil(windowMs / bucketMs));
  const end = Math.floor(now / bucketMs) * bucketMs + bucketMs;
  const first = end - n * bucketMs;
  const buckets: HealthBucket[] = Array.from({ length: n }, (_, k) => ({ t: first + k * bucketMs, acked: 0, timeouts: 0, invalid: 0 }));
  const idx = (t: number) => Math.floor((t - first) / bucketMs);
  for (const s of samples) {
    const k = idx(s.resolvedAt);
    if (k < 0 || k >= n) continue;
    if (s.outcome === 'acked') buckets[k].acked++;
    else if (s.outcome === 'timeout') buckets[k].timeouts++;
  }
  for (const r of records) {
    if (r.kind !== 'rx_invalid') continue;
    const k = idx(r.t);
    if (k >= 0 && k < n) buckets[k].invalid++;
  }
  return buckets;
}
