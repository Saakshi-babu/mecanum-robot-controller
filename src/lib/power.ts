import type { PowerSample, Reading } from '../types/models';

/** Max timestamp difference (ms) between V and I readings for them to be combined into P. */
export const DEFAULT_MAX_SKEW_MS = 50;

/**
 * Instantaneous power P = V × I.
 * Only computed when both readings are valid, finite, from the same source, and
 * measured within `maxSkewMs` of each other. Otherwise the result is invalid/missing.
 * Assumes V and I are measured at the same point (e.g. battery output). The caller
 * must ensure that; mixing e.g. battery voltage with a single motor's current is wrong.
 */
export function computePower(v: Reading, i: Reading, maxSkewMs = DEFAULT_MAX_SKEW_MS): PowerSample {
  const timestamp = Math.max(v.timestamp, i.timestamp);
  const base = { timestamp, source: v.source };
  const invalid = (validity: Reading['validity']): PowerSample => ({
    ...base,
    power: { value: null, unit: 'W', timestamp, validity, source: v.source },
  });
  if (v.validity !== 'valid' || i.validity !== 'valid' || v.value === null || i.value === null) {
    const anyInvalid = v.validity === 'invalid' || i.validity === 'invalid';
    const anyStale = v.validity === 'stale' || i.validity === 'stale';
    return invalid(anyInvalid ? 'invalid' : anyStale ? 'stale' : 'missing');
  }
  if (v.source !== i.source) return invalid('invalid');
  if (!Number.isFinite(v.value) || !Number.isFinite(i.value)) return invalid('invalid');
  if (Math.abs(v.timestamp - i.timestamp) > maxSkewMs) return invalid('invalid');
  return { ...base, power: { value: v.value * i.value, unit: 'W', timestamp, validity: 'valid', source: v.source } };
}

export interface EnergyResult {
  /** Integrated energy in watt-hours, or null if no interval could be integrated. */
  energyWh: number | null;
  /** Total time covered by integrated intervals (ms). */
  coveredMs: number;
  /** Number of intervals skipped because of a gap or invalid endpoint. */
  skippedIntervals: number;
}

/**
 * Energy by trapezoidal integration of consecutive valid power samples.
 * An interval is skipped (not interpolated) if either endpoint is invalid or the gap exceeds maxGapMs.
 * Samples must be sorted by timestamp.
 */
export function integrateEnergy(samples: readonly PowerSample[], maxGapMs: number): EnergyResult {
  let joules = 0;
  let coveredMs = 0;
  let skipped = 0;
  for (let k = 1; k < samples.length; k++) {
    const a = samples[k - 1];
    const b = samples[k];
    const dt = b.timestamp - a.timestamp;
    if (a.power.value === null || b.power.value === null || dt <= 0 || dt > maxGapMs) {
      skipped++;
      continue;
    }
    joules += ((a.power.value + b.power.value) / 2) * (dt / 1000);
    coveredMs += dt;
  }
  return { energyWh: coveredMs > 0 ? joules / 3600 : null, coveredMs, skippedIntervals: skipped };
}
