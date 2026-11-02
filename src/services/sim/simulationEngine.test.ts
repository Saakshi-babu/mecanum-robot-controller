import { describe, expect, it } from 'vitest';
import { SimulatedLink, SimulationEngine } from './simulationEngine';
import { DEFAULT_SETTINGS } from '../../store/defaults';

const make = (slip = 0) => new SimulationEngine(DEFAULT_SETTINGS.geometry, DEFAULT_SETTINGS.grid, 7, slip);

describe('SimulationEngine', () => {
  it('is deterministic for a given seed and command sequence', () => {
    const run = () => {
      const s = make(0.1);
      const out = [];
      for (let k = 0; k < 100; k++) {
        if (k % 5 === 0) s.applyCommand(k < 50 ? 'forward_left' : 'rotate_cw', 60);
        out.push(s.step());
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('moves +X when driving forward at heading 0, without slip', () => {
    const s = make(0);
    for (let k = 0; k < 20; k++) {
      s.applyCommand('forward', 50);
      s.step();
    }
    const p = s.snapshot().pose;
    expect(p.x).toBeGreaterThan(DEFAULT_SETTINGS.grid.initialPose.x + 0.1);
    expect(p.y).toBeCloseTo(DEFAULT_SETTINGS.grid.initialPose.y, 6);
    expect(p.headingDeg).toBeCloseTo(0, 6);
  });

  it('stops by watchdog when commands stop arriving', () => {
    const s = make(0);
    s.applyCommand('forward', 50);
    let snap = s.step();
    for (let k = 0; k < 15; k++) snap = s.step();
    expect(snap.watchdogTripped).toBe(true);
    expect(snap.direction).toBe('stop');
  });

  it('clamps to the grid boundary', () => {
    const s = make(0);
    let snap = s.step();
    for (let k = 0; k < 200; k++) {
      s.applyCommand('backward', 100);
      snap = s.step();
    }
    expect(snap.pose.x).toBe(0);
    expect(snap.atBoundary).toBe(true);
  });

  it('draws less current when idle than when moving, and voltage sags under load', () => {
    const s = make(0);
    const idle = s.step();
    for (let k = 0; k < 20; k++) {
      s.applyCommand('forward', 100);
      s.step();
    }
    const load = s.snapshot();
    expect(load.currentA).toBeGreaterThan(idle.currentA + 1);
    expect(load.voltageV).toBeLessThan(idle.voltageV);
  });

  it('reset restores the initial reproducible state', () => {
    const s = make(0.1);
    const first = [s.step(), s.step()];
    s.applyCommand('left', 80);
    s.step();
    s.reset();
    expect([s.step(), s.step()]).toEqual(first);
  });
});

describe('SimulatedLink', () => {
  it('is reproducible and respects drop rate bounds', () => {
    const a = new SimulatedLink(1, 20, 5, 0.1, 0);
    const b = new SimulatedLink(1, 20, 5, 0.1, 0);
    const da = Array.from({ length: 2000 }, () => a.decide());
    expect(da).toEqual(Array.from({ length: 2000 }, () => b.decide()));
    const drops = da.filter((d) => d.dropped).length / da.length;
    expect(drops).toBeGreaterThan(0.07);
    expect(drops).toBeLessThan(0.13);
    expect(Math.min(...da.map((d) => d.delayMs))).toBeGreaterThanOrEqual(1);
  });
});
