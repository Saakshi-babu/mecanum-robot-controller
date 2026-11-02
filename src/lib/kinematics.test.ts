import { describe, expect, it } from 'vitest';
import { DIRECTION_VECTORS, forwardKinematics, inverseKinematics, wheelCommandPct } from './kinematics';
import type { Direction } from '../types/models';

describe('mecanum kinematics', () => {
  it('forward(inverse(v)) = v', () => {
    const r = 0.04, k = 0.22;
    for (const [vx, vy, w] of [[0.3, 0, 0], [0, -0.2, 0], [0.1, 0.1, 0.5], [-0.2, 0.05, -1]]) {
      const ws = inverseKinematics(vx, vy, w, r, k);
      const b = forwardKinematics(ws, r, k);
      expect(b.vx).toBeCloseTo(vx);
      expect(b.vy).toBeCloseTo(vy);
      expect(b.omega).toBeCloseTo(w);
    }
  });

  it('produces the expected wheel sign patterns', () => {
    expect(wheelCommandPct('forward', 50)).toEqual({ FL: 50, FR: 50, RL: 50, RR: 50 });
    expect(wheelCommandPct('left', 50)).toEqual({ FL: -50, FR: 50, RL: 50, RR: -50 });
    expect(wheelCommandPct('rotate_ccw', 50)).toEqual({ FL: -50, FR: 50, RL: -50, RR: 50 });
    const fl = wheelCommandPct('forward_left', 60);
    expect(fl.FL).toBeCloseTo(0);
    expect(fl.RR).toBeCloseTo(0);
    expect(fl.FR).toBeCloseTo(60);
    expect(fl.RL).toBeCloseTo(60);
    expect(wheelCommandPct('stop', 80)).toEqual({ FL: 0, FR: 0, RL: 0, RR: 0 });
  });

  it('never exceeds the requested speed on any wheel', () => {
    for (const d of Object.keys(DIRECTION_VECTORS) as Direction[]) {
      const w = wheelCommandPct(d, 70);
      for (const v of Object.values(w)) expect(Math.abs(v)).toBeLessThanOrEqual(70 + 1e-9);
    }
  });
});
