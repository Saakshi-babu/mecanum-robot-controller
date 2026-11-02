import type {
  AppEvent,
  AppMode,
  CommandOrigin,
  ConnectionState,
  DataSourceKind,
  Direction,
  EstimateKind,
  EventCategory,
  EventSource,
  GridConfig,
  GroundTruthCheck,
  LatencySample,
  LocalizationEstimate,
  MotionCommand,
  Pose,
  PowerSample,
  Settings,
  Severity,
  TelemetryFrame,
  Validity,
} from '../types/models';
import { RingBuffer } from '../lib/ring';
import { LatencyTracker, latencyStats, type LatencyStats } from '../lib/latency';
import { commStats, type CommRecord, type CommRecordKind, type CommStats } from '../lib/commStats';
import { computePower, integrateEnergy, type EnergyResult } from '../lib/power';
import { headingDiff, isInsideGrid, poseDistance, validateGridConfig } from '../lib/grid';
import { DIRECTION_LABELS } from '../lib/kinematics';
import { DemoDataSource } from '../services/datasource/demoDataSource';
import { Esp32WebSocketSource } from '../services/datasource/esp32WebSocketSource';
import { clockNow, type DataSource, type DataSourceListener } from '../services/datasource/types';
import { SimulatedPoseEngine } from '../services/localization/simulatedPoseEngine';
import { MecanumOdometryEngine } from '../services/localization/mecanumOdometry';
import type { SimSnapshot } from '../services/sim/simulationEngine';
import { loadSettings, saveSettings } from './defaults';

/** Telemetry older than this is considered stale. */
export const TELEMETRY_STALE_MS = 1000;
/** Buffers hold at least the largest selectable chart window (300 s). */
const MAX_WINDOW_MS = 300_000;
/** Intervals between power samples longer than this are not integrated into energy. */
export const ENERGY_MAX_GAP_MS = 500;

export interface TrailPoint {
  t: number;
  x: number;
  y: number;
}

export interface ConnectionInfo {
  state: ConnectionState;
  detail: string;
  /** When the current state was entered. */
  stateSince: number;
  /** When the link was last confirmed connected (ESP32 only). */
  connectedSince: number | null;
  reconnects: number;
  lastMessageAt: number | null;
  lastError: { t: number; message: string } | null;
}

export interface ControlState {
  direction: Direction;
  speedPct: number;
  origin: CommandOrigin;
  /** UI emergency-stop latch. While set, only stop commands are sent. */
  latched: boolean;
  conflict: string | null;
  lastCommand: MotionCommand | null;
  /** Whether the last non-heartbeat command was actually written to a transport. */
  lastSendOk: boolean;
}

export interface ScenarioState {
  running: boolean;
  step: number;
  stepEndsAt: number;
}

/** Scripted demo path. Each step: direction for durationMs at speedPct. */
export const SQUARE_PATH: { direction: Direction; durationMs: number; speedPct: number }[] = [
  { direction: 'forward', durationMs: 2500, speedPct: 40 },
  { direction: 'left', durationMs: 2500, speedPct: 40 },
  { direction: 'backward', durationMs: 2500, speedPct: 40 },
  { direction: 'right', durationMs: 2500, speedPct: 40 },
  { direction: 'rotate_ccw', durationMs: 1500, speedPct: 30 },
  { direction: 'forward_right', durationMs: 1500, speedPct: 40 },
  { direction: 'backward_left', durationMs: 1500, speedPct: 40 },
  { direction: 'rotate_cw', durationMs: 1500, speedPct: 30 },
  { direction: 'stop', durationMs: 1000, speedPct: 0 },
];

type Listener = () => void;

export class RobotStore {
  settings: Settings;
  conn: ConnectionInfo;
  control: ControlState;
  scenario: ScenarioState = { running: false, step: 0, stepEndsAt: 0 };
  readonly sessionStartedAt = Date.now();

  readonly commandHistory = new RingBuffer<MotionCommand>(300);
  readonly latency = new RingBuffer<LatencySample>(20000);
  readonly comm = new RingBuffer<CommRecord>(40000);
  readonly telemetry = new RingBuffer<TelemetryFrame>(4000);
  readonly power = new RingBuffer<PowerSample>(4000);
  readonly events = new RingBuffer<AppEvent>(3000);
  /** Cumulative session energy after each power sample (Wh). */
  readonly energySeries = new RingBuffer<{ t: number; wh: number }>(4000);
  private energyAcc: EnergyResult & { joules: number; prev: PowerSample | null } = { energyWh: null, coveredMs: 0, skippedIntervals: 0, joules: 0, prev: null };

  readonly trails: Record<'simulated' | 'odometry', TrailPoint[]> = { simulated: [], odometry: [] };
  checks: GroundTruthCheck[] = [];
  startPose: Pose;
  simEstimate: LocalizationEstimate;
  odoEstimate: LocalizationEstimate;
  lastSim: SimSnapshot | null = null;

  version = 0;
  private listeners = new Set<Listener>();
  private notifyScheduled = false;
  private source: DataSource | null = null;
  private tracker: LatencyTracker;
  private simEngine = new SimulatedPoseEngine();
  private odoEngine: MecanumOdometryEngine;
  private timers: ReturnType<typeof setInterval>[] = [];
  private seq = 0;
  private eventId = 0;
  private checkId = 0;
  private lastValidity: Record<string, Validity> = {};
  private telemetryStaleFlag = false;
  private wasOutOfBounds = false;
  private running = false;

  constructor(settings: Settings = loadSettings(), private readonly persist = true) {
    this.settings = settings;
    const now = Date.now();
    this.conn = {
      state: settings.mode === 'demo' ? 'demo' : 'disconnected',
      detail: '',
      stateSince: now,
      connectedSince: null,
      reconnects: 0,
      lastMessageAt: null,
      lastError: null,
    };
    this.control = {
      direction: 'stop',
      speedPct: settings.controller.defaultSpeedPct,
      origin: 'stop_button',
      latched: false,
      conflict: null,
      lastCommand: null,
      lastSendOk: true,
    };
    this.tracker = new LatencyTracker(this.ackTimeoutMs, this.sourceKind);
    this.odoEngine = new MecanumOdometryEngine(settings.geometry, this.sourceKind);
    this.startPose = { ...settings.grid.initialPose };
    this.simEstimate = this.simEngine.current();
    this.odoEstimate = this.odoEngine.current(now);
  }

  // ------------------------------------------------------------------ subscription

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    const run = () => {
      this.notifyScheduled = false;
      for (const l of this.listeners) l();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  // ------------------------------------------------------------------ derived props

  get sourceKind(): DataSourceKind {
    return this.settings.mode === 'demo' ? 'simulated' : 'esp32';
  }

  get isDemo(): boolean {
    return this.settings.mode === 'demo';
  }

  get ackTimeoutMs(): number {
    return this.settings.esp32.ackTimeoutMs;
  }

  get windowMs(): number {
    return this.settings.display.windowSec * 1000;
  }

  get writable(): boolean {
    return this.source?.writable ?? false;
  }

  get demoSource(): DemoDataSource | null {
    return this.source instanceof DemoDataSource ? this.source : null;
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log('system', 'info', 'app', `Application started in ${this.isDemo ? 'DEMO (simulated)' : 'ESP32'} mode`, false);
    this.openSource();
    this.timers.push(setInterval(() => this.heartbeat(), this.settings.controller.heartbeatMs));
    this.timers.push(setInterval(() => this.housekeeping(), 50));
  }

  dispose(): void {
    this.closeSource();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.running = false;
  }

  private openSource(): void {
    const s = this.settings;
    this.tracker = new LatencyTracker(this.ackTimeoutMs, this.sourceKind);
    this.odoEngine = new MecanumOdometryEngine(s.geometry, this.sourceKind);
    const now = Date.now();
    this.startPose = { ...s.grid.initialPose };
    this.simEngine = new SimulatedPoseEngine();
    if (this.isDemo) {
      this.simEngine.reset(this.startPose, now);
      this.odoEngine.reset(this.startPose, now);
      this.source = new DemoDataSource(s.demo, s.geometry, s.grid);
    } else {
      // Real hardware: no pose is assumed. Odometry starts only after the user sets a known pose.
      this.source = new Esp32WebSocketSource(s.esp32.url);
    }
    this.simEstimate = this.simEngine.current();
    this.odoEstimate = this.odoEngine.current(now);
    this.source.start(this.makeListener());
    this.emit();
  }

  private closeSource(): void {
    if (this.source?.writable) {
      // Best effort: tell the robot to stop before we drop the link.
      this.transmit('stop', 'safety', false);
    }
    this.source?.stop();
    this.source = null;
  }

  private clearData(): void {
    this.commandHistory.clear();
    this.latency.clear();
    this.comm.clear();
    this.telemetry.clear();
    this.power.clear();
    this.energySeries.clear();
    this.energyAcc = { energyWh: null, coveredMs: 0, skippedIntervals: 0, joules: 0, prev: null };
    this.trails.simulated = [];
    this.trails.odometry = [];
    this.checks = [];
    this.lastSim = null;
    this.lastValidity = {};
    this.telemetryStaleFlag = false;
  }

  /**
   * Switch between demo and ESP32 mode. All measurement buffers are cleared so simulated
   * and real data can never be mixed in statistics, charts or exports.
   */
  setMode(mode: AppMode): void {
    if (mode === this.settings.mode) return;
    this.stopScenario();
    this.control = { ...this.control, direction: 'stop', origin: 'safety', conflict: null };
    this.closeSource();
    this.settings = { ...this.settings, mode };
    this.clearData();
    this.conn = { ...this.conn, state: mode === 'demo' ? 'demo' : 'disconnected', detail: '', stateSince: Date.now(), connectedSince: null, reconnects: 0, lastMessageAt: null, lastError: null };
    this.log('config', 'warning', 'app', mode === 'demo'
      ? 'Switched to DEMO mode. All previous ESP32 measurements cleared; values shown are simulated.'
      : 'Switched to ESP32 mode. All simulated data cleared; only data received from the ESP32 will be shown.', false);
    this.persistSettings();
    if (this.running) this.openSource();
    this.emit();
  }

  /** Restart the current data source (e.g. after changing the ESP32 URL or demo seed). */
  restartSource(): void {
    this.stopScenario();
    this.control = { ...this.control, direction: 'stop', origin: 'safety' };
    this.closeSource();
    this.clearData();
    this.log('config', 'info', 'app', `Data source restarted (${this.isDemo ? 'demo simulator, seed ' + this.settings.demo.seed : 'ESP32 ' + (this.settings.esp32.url || '— no URL')})`, false);
    if (this.running) this.openSource();
  }

  updateSettings(patch: Partial<Omit<Settings, 'mode' | 'grid'>>): void {
    const prev = this.settings;
    this.settings = { ...prev, ...patch };
    if (patch.demo) this.demoSource?.updateConfig(this.settings.demo);
    if (patch.geometry) {
      this.odoEngine.setGeometry(this.settings.geometry);
      this.demoSource?.sim.setGeometry(this.settings.geometry);
    }
    if (patch.esp32) this.tracker.timeoutMs = this.settings.esp32.ackTimeoutMs;
    if (patch.controller && patch.controller.heartbeatMs !== prev.controller.heartbeatMs && this.running) {
      clearInterval(this.timers[0]);
      this.timers[0] = setInterval(() => this.heartbeat(), this.settings.controller.heartbeatMs);
    }
    if (patch.controller && !this.settings.controller.enableRotation && (this.control.direction === 'rotate_ccw' || this.control.direction === 'rotate_cw')) {
      this.stop('safety');
    }
    this.persistSettings();
    this.emit();
  }

  /** Apply a validated grid configuration. Resets localization. Returns validation errors, if any. */
  setGrid(grid: GridConfig): ReturnType<typeof validateGridConfig> {
    const v = validateGridConfig(grid);
    if (!v.ok) return v;
    this.settings = { ...this.settings, grid };
    this.demoSource?.sim.setGrid(grid);
    this.log('config', 'info', 'localization', `Grid set to ${grid.cols}×${grid.rows} cells of ${grid.cellSizeM} m (${(grid.cols * grid.cellSizeM).toFixed(2)} × ${(grid.rows * grid.cellSizeM).toFixed(2)} m)`, this.isDemo);
    this.persistSettings();
    this.resetLocalization();
    return v;
  }

  private persistSettings(): void {
    if (this.persist) saveSettings(this.settings);
  }

  // ------------------------------------------------------------------ data source listener

  private makeListener(): DataSourceListener {
    const kind = this.sourceKind;
    const src: EventSource = this.isDemo ? 'simulator' : 'esp32';
    const sim = this.isDemo;
    return {
      onState: (state, detail) => {
        const prev = this.conn.state;
        const now = Date.now();
        this.conn = {
          ...this.conn,
          state,
          detail: detail ?? '',
          stateSince: prev !== state ? now : this.conn.stateSince,
          connectedSince: state === 'connected' ? (prev === 'connected' ? this.conn.connectedSince : now) : null,
        };
        if (prev !== state || detail) {
          const sev: Severity = state === 'error' ? 'error' : state === 'disconnected' ? 'warning' : 'info';
          this.log('connection', sev, src, `Connection ${state}${detail ? ': ' + detail : ''}`, sim);
        }
        if ((state === 'disconnected' || state === 'error') && this.control.direction !== 'stop') {
          this.control = { ...this.control, direction: 'stop', origin: 'safety' };
          this.log('stop', 'warning', 'app', 'Link lost — UI command reset to STOP. The robot itself must stop via its firmware watchdog.', sim);
        }
        this.emit();
      },
      onAck: (ack) => {
        this.recordComm('rx_ack', kind);
        this.conn.lastMessageAt = ack.receivedAt;
        const s = this.tracker.onAck(ack.seq, ack.receivedAt);
        this.latency.push(s);
        if (s.outcome !== 'acked') {
          this.log('comm_error', 'warning', src, `Ack for seq ${ack.seq} rejected: ${s.outcome.replace('_', ' ')} (excluded from latency statistics)`, sim);
        }
        this.emit();
      },
      onTelemetry: (frame) => this.handleTelemetry(frame, src, sim),
      onInvalid: (reason) => {
        this.recordComm('rx_invalid', kind);
        this.conn.lastMessageAt = Date.now();
        this.log('comm_error', 'warning', src, `Invalid message: ${reason}`, sim);
        this.emit();
      },
      onError: (message) => {
        this.recordComm('error', kind);
        this.conn.lastError = { t: Date.now(), message };
        this.log('comm_error', 'error', src, message, sim);
        this.emit();
      },
      onReconnect: () => {
        this.conn.reconnects++;
        this.recordComm('reconnect', kind);
        this.log('connection', 'info', src, `Reconnected (total reconnections: ${this.conn.reconnects})`, sim);
      },
      onSimSnapshot: (snap) => {
        this.lastSim = snap;
        const now = Date.now();
        this.simEstimate = this.simEngine.update({ timestamp: now, simulatedPose: snap.pose });
        this.pushTrail('simulated', now, snap.pose);
        this.emit();
      },
      onInfo: (message, severity = 'info') => {
        this.log(message.toLowerCase().includes('watchdog') ? 'stop' : 'telemetry', severity, src, message, sim);
      },
    };
  }

  private handleTelemetry(frame: TelemetryFrame, src: EventSource, sim: boolean): void {
    if (frame.source !== this.sourceKind) {
      // Defensive: never accept a frame from the wrong source into this session's buffers.
      this.log('telemetry', 'error', 'app', `Discarded ${frame.source} frame while in ${this.sourceKind} mode`, false);
      return;
    }
    this.recordComm('rx_telemetry', frame.source);
    this.conn.lastMessageAt = frame.timestamp;
    this.telemetry.push(frame);
    const ps = computePower(frame.voltage, frame.current);
    this.power.push(ps);
    this.accumulateEnergy(ps);
    this.trackValidity('voltage', 'Voltage', frame.voltage.validity, src, sim);
    this.trackValidity('current', 'Current', frame.current.validity, src, sim);
    const encValidity: Validity = !frame.wheels
      ? 'missing'
      : frame.wheels.every((w) => w.encoderTicks.validity === 'valid')
        ? 'valid'
        : frame.wheels.some((w) => w.encoderTicks.validity === 'invalid') ? 'invalid' : 'missing';
    this.trackValidity('encoders', 'Wheel encoder', encValidity, src, sim);
    if (this.telemetryStaleFlag) {
      this.telemetryStaleFlag = false;
      this.log('telemetry', 'info', src, 'Telemetry resumed', sim);
    }

    const now = Date.now();
    this.odoEstimate = this.odoEngine.update({ timestamp: now, frame });
    if (this.odoEstimate.pose && this.odoEstimate.status === 'tracking') {
      this.pushTrail('odometry', now, this.odoEstimate.pose);
      const out = !isInsideGrid(this.settings.grid, this.odoEstimate.pose.x, this.odoEstimate.pose.y);
      if (out && !this.wasOutOfBounds) this.log('localization', 'warning', 'localization', 'Odometry estimate is outside the configured grid', sim);
      this.wasOutOfBounds = out;
      if (out) this.odoEstimate = { ...this.odoEstimate, status: 'out_of_bounds' };
    }
    this.emit();
  }

  /** Running trapezoidal integration; same rules as integrateEnergy() (gaps > ENERGY_MAX_GAP_MS skipped). */
  private accumulateEnergy(ps: PowerSample): void {
    const acc = this.energyAcc;
    const prev = acc.prev;
    if (prev) {
      const r = integrateEnergy([prev, ps], ENERGY_MAX_GAP_MS);
      if (r.energyWh !== null) {
        acc.joules += r.energyWh * 3600;
        acc.coveredMs += r.coveredMs;
        acc.energyWh = acc.joules / 3600;
        this.energySeries.push({ t: ps.timestamp, wh: acc.energyWh });
      } else acc.skippedIntervals += r.skippedIntervals;
    }
    acc.prev = ps;
  }

  private trackValidity(key: string, label: string, v: Validity, src: EventSource, sim: boolean): void {
    const prev = this.lastValidity[key];
    this.lastValidity[key] = v;
    if (prev === v) return;
    if (v !== 'valid') this.log('telemetry', 'warning', src, `${label} telemetry ${v}`, sim);
    else if (prev !== undefined) this.log('telemetry', 'info', src, `${label} telemetry valid again`, sim);
  }

  private recordComm(kind: CommRecordKind, source: DataSourceKind): void {
    this.comm.push({ t: clockNow(), kind, source });
  }

  private pushTrail(which: 'simulated' | 'odometry', t: number, p: Pose): void {
    const trail = this.trails[which];
    const last = trail[trail.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.01) return;
    trail.push({ t, x: p.x, y: p.y });
    if (trail.length > 3000) trail.splice(0, trail.length - 3000);
  }

  // ------------------------------------------------------------------ periodic work

  private heartbeat(): void {
    if (!this.source?.writable) return;
    // Re-send the current command (including STOP) so firmware can run a dead-man timeout.
    this.transmit(this.control.direction, this.control.origin, true);
  }

  private housekeeping(): void {
    const now = clockNow();
    const expired = this.tracker.sweep(now);
    for (const s of expired) {
      this.latency.push(s);
      this.log('comm_error', 'warning', this.isDemo ? 'simulator' : 'esp32', `No ack for seq ${s.seq} within ${this.ackTimeoutMs} ms — counted as timeout`, this.isDemo);
    }
    const last = this.telemetry.last();
    const live = this.conn.state === 'demo' || this.conn.state === 'connected';
    if (live && last && Date.now() - last.timestamp > TELEMETRY_STALE_MS && !this.telemetryStaleFlag) {
      this.telemetryStaleFlag = true;
      this.log('telemetry', 'warning', this.isDemo ? 'simulator' : 'esp32', `No telemetry for more than ${TELEMETRY_STALE_MS} ms — readings marked stale`, this.isDemo);
    }
    if (this.scenario.running && Date.now() >= this.scenario.stepEndsAt) this.advanceScenario();
    if (expired.length) this.emit();
  }

  // ------------------------------------------------------------------ commands

  /** Write a command to the transport. Returns whether it was written. */
  private transmit(direction: Direction, origin: CommandOrigin, heartbeat: boolean): boolean {
    const cmd: MotionCommand = {
      seq: ++this.seq,
      direction,
      speedPct: direction === 'stop' ? 0 : this.control.speedPct,
      issuedAt: Date.now(),
      origin,
      heartbeat,
    };
    const sentAt = this.source?.send(cmd) ?? null;
    if (sentAt === null) return false;
    this.tracker.markSent(cmd.seq, sentAt);
    this.recordComm('tx', this.sourceKind);
    if (!heartbeat) {
      this.commandHistory.push(cmd);
      this.control = { ...this.control, lastCommand: cmd };
    }
    return true;
  }

  /** Request a movement direction from the UI. */
  setDirection(direction: Direction, origin: CommandOrigin, conflict: string | null = null): void {
    if (direction !== 'stop' && this.control.latched) {
      this.control = { ...this.control, conflict: 'UI emergency stop is latched — release it to move' };
      this.emit();
      return;
    }
    if ((direction === 'rotate_ccw' || direction === 'rotate_cw') && !this.settings.controller.enableRotation) return;
    if (origin !== 'scenario' && this.scenario.running) this.stopScenario();
    const same = direction === this.control.direction;
    this.control = { ...this.control, conflict };
    if (same && direction !== 'stop') {
      this.emit();
      return;
    }
    if (direction !== 'stop' && !this.writable) {
      this.control = { ...this.control, direction: 'stop', origin, lastSendOk: false, conflict: this.isDemo ? conflict : 'Not connected to the ESP32 — command not sent' };
      this.log('command', 'warning', 'ui', `${DIRECTION_LABELS[direction]} not sent: transport not connected`, this.isDemo);
      this.emit();
      return;
    }
    this.control = { ...this.control, direction, origin };
    const ok = this.transmit(direction, origin, false);
    this.control = { ...this.control, lastSendOk: ok };
    const sim = this.isDemo;
    if (direction === 'stop') {
      if (!same || origin === 'stop_button' || origin === 'ui_estop')
        this.log('stop', 'info', 'ui', `Stop (${origin.replace('_', ' ')})${ok ? '' : ' — not sent: transport not connected'}`, sim);
    } else {
      this.log('command', 'info', origin === 'scenario' ? 'simulator' : 'ui', `${sim ? 'Simulated command' : 'Command'}: ${DIRECTION_LABELS[direction]} at ${this.control.speedPct}% (${origin})`, sim);
    }
    this.emit();
  }

  stop(origin: CommandOrigin = 'stop_button'): void {
    this.setDirection('stop', origin);
  }

  /** UI emergency stop: software-only latch. Not a verified physical e-stop. */
  emergencyStop(): void {
    this.stopScenario();
    const wasLatched = this.control.latched;
    this.control = { ...this.control, latched: true };
    this.setDirection('stop', 'ui_estop');
    if (!wasLatched) this.log('stop', 'error', 'ui', 'UI emergency stop LATCHED (software only — not a verified hardware e-stop)', this.isDemo);
    this.emit();
  }

  releaseLatch(): void {
    if (!this.control.latched) return;
    this.control = { ...this.control, latched: false, conflict: null };
    this.log('stop', 'info', 'ui', 'UI emergency stop latch released', this.isDemo);
    this.emit();
  }

  setSpeed(pct: number): void {
    const speedPct = Math.round(Math.min(100, Math.max(0, pct)));
    if (speedPct === this.control.speedPct) return;
    this.control = { ...this.control, speedPct };
    if (this.control.direction !== 'stop') this.transmit(this.control.direction, this.control.origin, false);
    this.emit();
  }

  // ------------------------------------------------------------------ demo scenario

  startScenario(): void {
    if (!this.isDemo || this.control.latched) return;
    this.scenario = { running: true, step: -1, stepEndsAt: 0 };
    this.log('command', 'info', 'simulator', 'Scripted square-path scenario started (demo)', true);
    this.advanceScenario();
  }

  stopScenario(): void {
    if (!this.scenario.running) return;
    this.scenario = { running: false, step: 0, stepEndsAt: 0 };
    this.log('command', 'info', 'simulator', 'Scripted scenario stopped', true);
    if (this.control.direction !== 'stop') this.setDirection('stop', 'scenario');
    this.emit();
  }

  private advanceScenario(): void {
    const step = (this.scenario.step + 1) % SQUARE_PATH.length;
    const s = SQUARE_PATH[step];
    this.scenario = { running: true, step, stepEndsAt: Date.now() + s.durationMs };
    this.control = { ...this.control, speedPct: s.speedPct || this.control.speedPct };
    this.setDirection(s.direction, 'scenario');
  }

  // ------------------------------------------------------------------ localization

  /** Reset to the configured initial pose; clears trails. In demo mode also moves the simulated robot. */
  resetLocalization(): void {
    this.stopScenario();
    if (this.control.direction !== 'stop') this.stop('safety');
    const now = Date.now();
    const pose = { ...this.settings.grid.initialPose };
    this.startPose = pose;
    this.trails.simulated = [];
    this.trails.odometry = [];
    this.wasOutOfBounds = false;
    if (this.isDemo) {
      this.demoSource?.resetSimulation(pose);
      this.simEngine.reset(pose, now);
      this.simEstimate = this.simEngine.current();
    }
    this.odoEngine.reset(pose, now);
    this.odoEstimate = this.odoEngine.current(now);
    this.log('localization', 'info', 'localization', `Localization reset to initial pose (${pose.x.toFixed(2)} m, ${pose.y.toFixed(2)} m, ${pose.headingDeg.toFixed(0)}°)`, this.isDemo);
    this.emit();
  }

  /** Re-anchor the odometry estimate to a known pose (does not move the simulated robot). */
  recalibrate(pose: Pose): void {
    const now = Date.now();
    this.odoEngine.reset(pose, now);
    this.odoEstimate = this.odoEngine.current(now);
    this.trails.odometry = [];
    this.wasOutOfBounds = false;
    this.log('localization', 'info', 'localization', `Odometry recalibrated to known pose (${pose.x.toFixed(2)} m, ${pose.y.toFixed(2)} m, ${pose.headingDeg.toFixed(0)}°)`, this.isDemo);
    this.emit();
  }

  /** Record a manually measured ground-truth pose and compare it to an estimate. */
  addGroundTruthCheck(truth: Pose, against: EstimateKind): GroundTruthCheck {
    const est = against === 'simulated' ? this.simEstimate : this.odoEstimate;
    const p = est.pose;
    const check: GroundTruthCheck = {
      id: ++this.checkId,
      timestamp: Date.now(),
      truth,
      estimate: p ? { ...p } : null,
      estimateKind: against,
      positionErrorM: p ? poseDistance(truth, p) : null,
      headingErrorDeg: p ? headingDiff(p.headingDeg, truth.headingDeg) : null,
    };
    this.checks = [check, ...this.checks].slice(0, 100);
    this.log('localization', 'info', 'localization', `Ground-truth check vs ${against}: ${check.positionErrorM === null ? 'no estimate' : `error ${(check.positionErrorM * 100).toFixed(1)} cm, ${check.headingErrorDeg!.toFixed(1)}°`}`, this.isDemo);
    this.emit();
    return check;
  }

  // ------------------------------------------------------------------ events

  log(category: EventCategory, severity: Severity, source: EventSource, message: string, simulated = this.isDemo): void {
    this.events.push({ id: ++this.eventId, timestamp: Date.now(), category, severity, source, simulated, message });
    this.emit();
  }

  clearEvents(): void {
    this.events.clear();
    this.emit();
  }

  // ------------------------------------------------------------------ selectors (single source of truth for cards, charts, exports)

  latencyStats(now = clockNow()): LatencyStats {
    return latencyStats(this.latency.toArray(), now, this.windowMs);
  }

  commStats(now = clockNow()): CommStats {
    return commStats(this.comm.toArray(), this.latency.toArray(), now, this.windowMs);
  }

  latestFrame(): TelemetryFrame | null {
    return this.telemetry.last() ?? null;
  }

  isFrameStale(frame: TelemetryFrame | null, now = Date.now()): boolean {
    return !frame || now - frame.timestamp > TELEMETRY_STALE_MS;
  }

  framesInWindow(now = Date.now()): TelemetryFrame[] {
    return this.telemetry.between(now - this.windowMs, now, (f) => f.timestamp);
  }

  powerInWindow(now = Date.now()): PowerSample[] {
    return this.power.between(now - this.windowMs, now, (p) => p.timestamp);
  }

  /** Energy integrated since the data source started (or mode switch). */
  energy(): EnergyResult {
    const { energyWh, coveredMs, skippedIntervals } = this.energyAcc;
    return { energyWh, coveredMs, skippedIntervals };
  }

  latencyInWindow(now = clockNow()): LatencySample[] {
    return this.latency.between(now - this.windowMs, now, (s) => s.resolvedAt);
  }

  get maxWindowMs(): number {
    return MAX_WINDOW_MS;
  }
}
