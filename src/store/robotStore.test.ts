import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RobotStore } from './robotStore';
import { DEFAULT_SETTINGS } from './defaults';
import { telemetryCsv, latencyCsv, eventsCsv } from './exports';
import type { Settings } from '../types/models';

const settings = (patch: Partial<Settings> = {}): Settings => structuredClone({ ...DEFAULT_SETTINGS, ...patch });

describe('RobotStore (demo mode)', () => {
  let store: RobotStore;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date', 'performance'] });
    store = new RobotStore(settings({ demo: { ...DEFAULT_SETTINGS.demo, dropRate: 0, corruptRate: 0 } }), false);
    store.start();
  });
  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
  });

  it('reports DEMO state, never connected', () => {
    vi.advanceTimersByTime(1000);
    expect(store.conn.state).toBe('demo');
  });

  it('produces simulated telemetry and latency samples tagged as simulated', () => {
    vi.advanceTimersByTime(3000);
    expect(store.telemetry.length).toBeGreaterThan(20);
    expect(store.telemetry.toArray().every((f) => f.source === 'simulated')).toBe(true);
    const ls = store.latencyStats();
    expect(ls.validCount).toBeGreaterThan(5);
    expect(ls.meanMs).toBeGreaterThan(5);
    expect(store.latency.toArray().every((s) => s.source === 'simulated')).toBe(true);
  });

  it('moves on command and stops immediately on stop', () => {
    store.setDirection('forward', 'button');
    expect(store.control.direction).toBe('forward');
    vi.advanceTimersByTime(1000);
    const x1 = store.lastSim!.pose.x;
    expect(x1).toBeGreaterThan(DEFAULT_SETTINGS.grid.initialPose.x);
    store.stop();
    expect(store.control.direction).toBe('stop');
    expect(store.control.lastCommand?.direction).toBe('stop');
    vi.advanceTimersByTime(1500);
    const x2 = store.lastSim!.pose.x;
    vi.advanceTimersByTime(1000);
    expect(store.lastSim!.pose.x).toBeCloseTo(x2, 6);
  });

  it('latched UI e-stop blocks motion until released', () => {
    store.setDirection('left', 'button');
    store.emergencyStop();
    expect(store.control).toMatchObject({ direction: 'stop', latched: true });
    store.setDirection('forward', 'button');
    expect(store.control.direction).toBe('stop');
    store.releaseLatch();
    store.setDirection('forward', 'button');
    expect(store.control.direction).toBe('forward');
  });

  it('records only command changes in history, not heartbeats', () => {
    store.setDirection('forward', 'keyboard');
    store.setDirection('forward', 'keyboard');
    vi.advanceTimersByTime(2000);
    store.stop();
    const hist = store.commandHistory.toArray();
    expect(hist.map((c) => c.direction)).toEqual(['forward', 'stop']);
    expect(store.commStats().sent).toBeGreaterThan(5); // heartbeats counted as sent messages
  });

  it('reset returns simulated and odometry pose to the initial pose and clears trails', () => {
    store.setDirection('forward_right', 'button');
    vi.advanceTimersByTime(1500);
    store.resetLocalization();
    vi.advanceTimersByTime(100);
    expect(store.simEstimate.pose!.x).toBeCloseTo(DEFAULT_SETTINGS.grid.initialPose.x, 6);
    expect(store.odoEstimate.pose!.y).toBeCloseTo(DEFAULT_SETTINGS.grid.initialPose.y, 6);
    expect(store.trails.simulated.length).toBeLessThanOrEqual(1);
  });

  it('switching to ESP32 mode clears simulated data and does not claim connection', () => {
    vi.advanceTimersByTime(2000);
    store.setMode('esp32');
    expect(store.telemetry.length).toBe(0);
    expect(store.latency.length).toBe(0);
    expect(store.conn.state).toBe('error'); // no URL configured
    store.setDirection('forward', 'button');
    expect(store.control.direction).toBe('stop');
    expect(store.control.conflict).toMatch(/Not connected/);
    vi.advanceTimersByTime(2000);
    expect(store.telemetry.length).toBe(0);
    expect(store.latencyStats().validCount).toBe(0);
    expect(store.odoEstimate.status).not.toBe('tracking');
  });

  it('exports CSV with source, units and timestamps', () => {
    vi.advanceTimersByTime(1000);
    const t = telemetryCsv(store, store.telemetry.toArray(), store.power.toArray());
    expect(t).toMatch(/# mode: DEMO/);
    const lines = t.split('\r\n').filter((l) => l && !l.startsWith('#'));
    expect(lines[0]).toContain('voltage_V');
    expect(lines[0]).toContain('power_W');
    expect(lines[1]).toMatch(/^\d{4}-\d\d-\d\dT.*,\d+,simulated,/);
    const l = latencyCsv(store, store.latency.toArray());
    expect(l).toMatch(/rtt_ms/);
    expect(l).toMatch(/,simulated,/);
    const e = eventsCsv(store, store.events.toArray());
    expect(e).toMatch(/simulated/);
  });

  it('energy accumulates only from valid power samples', () => {
    vi.advanceTimersByTime(5000);
    const e = store.energy();
    expect(e.energyWh).not.toBeNull();
    expect(e.coveredMs).toBeGreaterThan(4000);
  });
});

describe('RobotStore (simulated link faults)', () => {
  afterEach(() => vi.useRealTimers());
  it('counts timeouts from dropped acks and never reports them as zero latency', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date', 'performance'] });
    const store = new RobotStore(settings({ demo: { ...DEFAULT_SETTINGS.demo, dropRate: 0.3, corruptRate: 0.1 } }), false);
    store.start();
    vi.advanceTimersByTime(10000);
    const ls = store.latencyStats();
    const cs = store.commStats();
    expect(ls.timeouts).toBeGreaterThan(0);
    expect(cs.invalid).toBeGreaterThan(0);
    expect(ls.minMs).toBeGreaterThan(0);
    expect(store.latency.toArray().filter((s) => s.outcome === 'timeout').every((s) => s.rttMs === null)).toBe(true);
    expect(cs.ackRate!).toBeLessThan(1);
    store.dispose();
  });
});
