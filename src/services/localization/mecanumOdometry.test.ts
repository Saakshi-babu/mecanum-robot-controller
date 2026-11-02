import { describe, expect, it } from 'vitest';
import { MecanumOdometryEngine } from './mecanumOdometry';
import type { RobotGeometry, TelemetryFrame, Validity, WheelId } from '../../types/models';
import { WHEEL_IDS } from '../../types/models';

const geo: RobotGeometry = { wheelRadiusM: 0.05, halfWheelbaseM: 0.1, halfTrackM: 0.1, ticksPerRev: 1000, maxWheelRpm: 300 };

function frame(t: number, ticks: Partial<Record<WheelId, number>>, validity: Validity = 'valid'): TelemetryFrame {
  const r = (value: number | null, unit: 'V' | 'A' | 'rpm' | 'ticks', v: Validity = 'valid') => ({ value, unit, timestamp: t, validity: v, source: 'esp32' as const });
  return {
    frameSeq: null, timestamp: t, source: 'esp32', voltage: r(12, 'V'), current: r(1, 'A'), activeDirection: null,
    wheels: WHEEL_IDS.map((w) => ({ wheel: w, commandPct: null, rpm: r(0, 'rpm'), encoderTicks: ticks[w] === undefined ? r(null, 'ticks', 'missing') : r(ticks[w]!, 'ticks', validity) })),
  };
}

/** Ticks for the wheels to roll distance d (m). */
const ticksFor = (d: number) => Math.round((d / (2 * Math.PI * geo.wheelRadiusM)) * geo.ticksPerRev);

describe('MecanumOdometryEngine', () => {
  it('integrates straight forward motion', () => {
    const o = new MecanumOdometryEngine(geo, 'esp32');
    o.reset({ x: 1, y: 1, headingDeg: 90 }, 0);
    o.update({ timestamp: 0, frame: frame(0, { FL: 0, FR: 0, RL: 0, RR: 0 }) });
    const n = ticksFor(0.5);
    let est = o.current(0);
    for (let k = 1; k <= 10; k++) {
      const v = Math.round((n * k) / 10);
      est = o.update({ timestamp: k * 100, frame: frame(k * 100, { FL: v, FR: v, RL: v, RR: v }) });
    }
    expect(est.status).toBe('tracking');
    expect(est.pose!.x).toBeCloseTo(1, 3);
    expect(est.pose!.y).toBeCloseTo(1.5, 2);
    expect(est.pose!.headingDeg).toBeCloseTo(90, 6);
  });

  it('integrates strafing (left) using the X-roller pattern', () => {
    const o = new MecanumOdometryEngine(geo, 'esp32');
    o.reset({ x: 1, y: 1, headingDeg: 0 }, 0);
    o.update({ timestamp: 0, frame: frame(0, { FL: 0, FR: 0, RL: 0, RR: 0 }) });
    const n = ticksFor(0.2);
    const est = o.update({ timestamp: 300, frame: frame(300, { FL: -n, FR: n, RL: n, RR: -n }) });
    expect(est.pose!.x).toBeCloseTo(1, 6);
    expect(est.pose!.y).toBeCloseTo(1.2, 2);
  });

  it('integrates in-place rotation', () => {
    const o = new MecanumOdometryEngine(geo, 'esp32');
    o.reset({ x: 1, y: 1, headingDeg: 0 }, 0);
    o.update({ timestamp: 0, frame: frame(0, { FL: 0, FR: 0, RL: 0, RR: 0 }) });
    // 90° = π/2 rad; wheel arc = k·ψ where k = 0.2 m
    const n = ticksFor(0.2 * (Math.PI / 2));
    const est = o.update({ timestamp: 1000, frame: frame(1000, { FL: -n, FR: n, RL: -n, RR: n }) });
    expect(est.pose!.headingDeg).toBeCloseTo(90, 0);
    expect(est.pose!.x).toBeCloseTo(1, 6);
  });

  it('skips frames with missing encoders and becomes stale', () => {
    const o = new MecanumOdometryEngine(geo, 'esp32', 500);
    o.reset({ x: 0, y: 0, headingDeg: 0 }, 0);
    o.update({ timestamp: 0, frame: frame(0, { FL: 0, FR: 0, RL: 0, RR: 0 }) });
    const est = o.update({ timestamp: 1000, frame: frame(1000, { FL: 10, FR: 10, RL: 10 }) });
    expect(est.status).toBe('stale');
    expect(est.pose).toEqual({ x: 0, y: 0, headingDeg: 0 });
    expect(est.reason).toMatch(/RR/);
  });

  it('rejects implausible encoder jumps', () => {
    const o = new MecanumOdometryEngine(geo, 'esp32');
    o.reset({ x: 0, y: 0, headingDeg: 0 }, 0);
    o.update({ timestamp: 0, frame: frame(0, { FL: 0, FR: 0, RL: 0, RR: 0 }) });
    const est = o.update({ timestamp: 100, frame: frame(100, { FL: 100000, FR: 0, RL: 0, RR: 0 }) });
    expect(o.rejectedFrames).toBe(1);
    expect(est.pose).toEqual({ x: 0, y: 0, headingDeg: 0 });
  });

  it('is unavailable without wheel telemetry and uninitialized without a pose', () => {
    const o = new MecanumOdometryEngine(geo, 'esp32');
    expect(o.current(0).status).toBe('uninitialized');
    const f = frame(0, {});
    f.wheels = null;
    o.reset({ x: 0, y: 0, headingDeg: 0 }, 0);
    expect(o.update({ timestamp: 0, frame: f }).status).toBe('unavailable');
  });
});
