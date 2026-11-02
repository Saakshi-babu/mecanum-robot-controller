import type { DemoConfig, GridConfig, MotionCommand, Pose, RobotGeometry, TelemetryFrame, WheelTelemetry } from '../../types/models';
import { WHEEL_IDS } from '../../types/models';
import { SimulatedLink, SimulationEngine, type SimSnapshot } from '../sim/simulationEngine';
import { clockNow, type DataSource, type DataSourceListener } from './types';

/**
 * Demo data source. Everything it emits has source = 'simulated'.
 *
 * Command path: send() → SimulatedLink decides delay/drop/corruption deterministically →
 *   command applied to the simulator after delay/2 (forward path) →
 *   ack delivered after the full delay (return path), unless dropped/corrupted.
 * The latency the dashboard shows is measured by the app's LatencyTracker with the browser
 * clock, so it equals the simulated delay plus real browser timer scheduling jitter.
 *
 * Telemetry: the simulator steps at a fixed 50 ms; a frame is emitted every 2nd step (10 Hz).
 */
export class DemoDataSource implements DataSource {
  readonly kind = 'simulated' as const;
  private listener: DataSourceListener | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private timeouts = new Set<ReturnType<typeof setTimeout>>();
  private stepCount = 0;
  private frameSeq = 0;
  private wasAtBoundary = false;
  private wasWatchdog = false;
  readonly sim: SimulationEngine;
  readonly link: SimulatedLink;

  constructor(cfg: DemoConfig, geometry: RobotGeometry, grid: GridConfig) {
    this.sim = new SimulationEngine(geometry, grid, cfg.seed, cfg.wheelSlip);
    this.link = new SimulatedLink(cfg.seed, cfg.baseLatencyMs, cfg.jitterMs, cfg.dropRate, cfg.corruptRate);
  }

  get writable(): boolean {
    return this.timer !== null;
  }

  start(listener: DataSourceListener): void {
    this.listener = listener;
    listener.onState('demo', 'Simulated link active');
    const stepMs = this.sim.params.dtSec * 1000;
    this.timer = setInterval(() => this.tick(), stepMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.timeouts) clearTimeout(t);
    this.timeouts.clear();
    this.listener = null;
  }

  updateConfig(cfg: DemoConfig): void {
    this.link.baseLatencyMs = cfg.baseLatencyMs;
    this.link.jitterMs = cfg.jitterMs;
    this.link.dropRate = cfg.dropRate;
    this.link.corruptRate = cfg.corruptRate;
    this.sim.setSlipProbability(cfg.wheelSlip);
  }

  resetSimulation(pose: Pose): void {
    this.sim.reset(pose);
    this.link.reset();
    this.listener?.onSimSnapshot?.(this.sim.snapshot());
  }

  send(cmd: MotionCommand): number | null {
    if (!this.writable) return null;
    const sentAt = clockNow();
    const { delayMs, dropped, corrupted } = this.link.decide();
    this.later(delayMs / 2, () => {
      // Forward path: a dropped message never reaches the robot.
      if (!dropped) this.sim.applyCommand(cmd.direction, cmd.speedPct);
    });
    if (!dropped) {
      this.later(delayMs, () => {
        if (corrupted) this.listener?.onInvalid('Simulated corrupted ack (checksum failure)', `{"type":"ack","seq":${cmd.seq}`);
        else this.listener?.onAck({ seq: cmd.seq, receivedAt: clockNow(), source: 'simulated' });
      });
    }
    return sentAt;
  }

  private later(ms: number, fn: () => void): void {
    const h = setTimeout(() => {
      this.timeouts.delete(h);
      fn();
    }, ms);
    this.timeouts.add(h);
  }

  private tick(): void {
    const snap = this.sim.step();
    this.stepCount++;
    const l = this.listener;
    if (!l) return;
    l.onSimSnapshot?.(snap);
    if (snap.atBoundary && !this.wasAtBoundary) l.onInfo?.('Simulated robot reached the grid boundary (wheels still turning)', 'warning');
    if (snap.watchdogTripped && !this.wasWatchdog) l.onInfo?.('Simulated firmware watchdog stopped motors: no command for 500 ms', 'warning');
    this.wasAtBoundary = snap.atBoundary;
    this.wasWatchdog = snap.watchdogTripped;
    if (this.stepCount % 2 === 0) l.onTelemetry(frameFromSnapshot(snap, ++this.frameSeq, Date.now()));
  }
}

export function frameFromSnapshot(snap: SimSnapshot, frameSeq: number, timestamp: number): TelemetryFrame {
  const r = (value: number, unit: 'V' | 'A' | 'rpm' | 'ticks') => ({ value, unit, timestamp, validity: 'valid' as const, source: 'simulated' as const });
  const wheels: WheelTelemetry[] = WHEEL_IDS.map((w) => ({
    wheel: w,
    commandPct: snap.wheelCommandPct[w],
    rpm: r(snap.wheelRpm[w], 'rpm'),
    encoderTicks: r(snap.encoderTicks[w], 'ticks'),
  }));
  return {
    frameSeq,
    timestamp,
    source: 'simulated',
    voltage: r(snap.voltageV, 'V'),
    current: r(snap.currentA, 'A'),
    wheels,
    activeDirection: snap.direction,
  };
}
