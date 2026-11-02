import { describe, expect, it } from 'vitest';
import { computePower, integrateEnergy } from './power';
import type { PowerSample, Reading } from '../types/models';

const rd = (value: number | null, unit: 'V' | 'A', timestamp = 0, validity: Reading['validity'] = 'valid', source: Reading['source'] = 'simulated'): Reading =>
  ({ value, unit, timestamp, validity, source });
const ps = (t: number, w: number | null): PowerSample => ({ timestamp: t, source: 'simulated', power: { value: w, unit: 'W', timestamp: t, validity: w === null ? 'missing' : 'valid', source: 'simulated' } });

describe('computePower', () => {
  it('P = V × I for valid aligned readings', () => {
    const p = computePower(rd(12, 'V'), rd(1.5, 'A'));
    expect(p.power.value).toBeCloseTo(18);
    expect(p.power.validity).toBe('valid');
  });

  it('is missing when either reading is missing', () => {
    expect(computePower(rd(null, 'V', 0, 'missing'), rd(1, 'A')).power).toMatchObject({ value: null, validity: 'missing' });
  });

  it('is invalid when readings are invalid, misaligned, or from different sources', () => {
    expect(computePower(rd(12, 'V'), rd(null, 'A', 0, 'invalid')).power.validity).toBe('invalid');
    expect(computePower(rd(12, 'V', 0), rd(1, 'A', 200)).power.validity).toBe('invalid');
    expect(computePower(rd(12, 'V', 0, 'valid', 'esp32'), rd(1, 'A')).power.validity).toBe('invalid');
  });

  it('propagates stale', () => {
    expect(computePower(rd(null, 'V', 0, 'stale'), rd(1, 'A')).power.validity).toBe('stale');
  });
});

describe('integrateEnergy', () => {
  it('integrates constant 36 W for 100 s to 1 Wh', () => {
    const samples = Array.from({ length: 1001 }, (_, k) => ps(k * 100, 36));
    const e = integrateEnergy(samples, 500);
    expect(e.energyWh).toBeCloseTo(1, 9);
    expect(e.coveredMs).toBe(100_000);
    expect(e.skippedIntervals).toBe(0);
  });

  it('uses trapezoids for a ramp', () => {
    // 0 → 72 W linearly over 100 s: average 36 W → 1 Wh
    const samples = Array.from({ length: 101 }, (_, k) => ps(k * 1000, 0.72 * k));
    expect(integrateEnergy(samples, 1500).energyWh).toBeCloseTo(1, 9);
  });

  it('skips gaps and invalid samples instead of interpolating', () => {
    const e = integrateEnergy([ps(0, 10), ps(100, 10), ps(5000, 10), ps(5100, null), ps(5200, 10)], 500);
    expect(e.coveredMs).toBe(100);
    expect(e.skippedIntervals).toBe(3);
  });

  it('returns null energy when nothing could be integrated', () => {
    expect(integrateEnergy([ps(0, 5)], 500).energyWh).toBeNull();
  });
});
