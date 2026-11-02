/**
 * Core typed data models.
 *
 * Every measurement carries its source, a timestamp (ms since Unix epoch,
 * browser clock unless stated otherwise), a unit and a validity state.
 * "simulated" data must never be merged with "esp32" data in the same
 * statistic, chart series or export row.
 */

/** Where a record came from. */
export type DataSourceKind = 'simulated' | 'esp32';

/** Operating mode chosen in Settings. */
export type AppMode = 'demo' | 'esp32';

export type Validity = 'valid' | 'invalid' | 'missing' | 'stale';

export type Unit = 'V' | 'A' | 'W' | 'Wh' | 'ms' | 'rpm' | 'ticks' | 'm' | 'deg' | '%' | 'msg/s';

/** A single scalar reading. `value` is null whenever validity !== 'valid'. */
export interface Reading {
  value: number | null;
  unit: Unit;
  /** Time the value was measured (ms epoch). For ESP32 data: firmware-reported time mapped to browser clock, or receive time if unavailable. */
  timestamp: number;
  validity: Validity;
  source: DataSourceKind;
}

// ---------------------------------------------------------------------------
// Controller commands
// ---------------------------------------------------------------------------

export type TranslationDirection =
  | 'forward'
  | 'backward'
  | 'left'
  | 'right'
  | 'forward_left'
  | 'forward_right'
  | 'backward_left'
  | 'backward_right';

export type RotationDirection = 'rotate_ccw' | 'rotate_cw';

export type Direction = 'stop' | TranslationDirection | RotationDirection;

export type CommandOrigin = 'button' | 'keyboard' | 'stop_button' | 'ui_estop' | 'safety' | 'scenario';

/** A motion command issued by the UI. Speed is a percentage of the (firmware-defined) maximum. */
export interface MotionCommand {
  /** Monotonic sequence number, unique per session. Used to match acknowledgements. */
  seq: number;
  direction: Direction;
  /** 0–100 %. Firmware must define what 100 % means (PWM duty or wheel speed). */
  speedPct: number;
  /** Browser clock time (ms epoch) at which the command was handed to the transport. */
  issuedAt: number;
  origin: CommandOrigin;
  /** true for periodic re-transmissions of the current command (dead-man heartbeat). */
  heartbeat: boolean;
}

/** Normalised body-frame velocity request: x forward, y left, omega counter-clockwise. Each in [-1, 1]. */
export interface BodyVelocity {
  vx: number;
  vy: number;
  omega: number;
}

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------

export type ConnectionState = 'demo' | 'connecting' | 'connected' | 'disconnected' | 'error';

/** Acknowledgement of a MotionCommand from the robot (or the simulated link). */
export interface CommandAck {
  seq: number;
  /** Browser clock time the ack was received (ms epoch). */
  receivedAt: number;
  /** Optional firmware-reported processing time, if the firmware provides it. Not the same as RTT. */
  deviceProcessingMs?: number;
  source: DataSourceKind;
}

export type LatencyOutcome = 'acked' | 'timeout' | 'late_ack' | 'unmatched_ack' | 'duplicate_ack' | 'invalid';

/** One latency measurement attempt. `rttMs` is only set for outcome 'acked'. */
export interface LatencySample {
  seq: number;
  sentAt: number;
  resolvedAt: number;
  outcome: LatencyOutcome;
  rttMs: number | null;
  source: DataSourceKind;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export type WheelId = 'FL' | 'FR' | 'RL' | 'RR';
export const WHEEL_IDS: WheelId[] = ['FL', 'FR', 'RL', 'RR'];

export interface WheelTelemetry {
  wheel: WheelId;
  /** Commanded wheel speed as a signed % of max (what the UI/firmware asked for). */
  commandPct: number | null;
  /** Measured wheel speed — requires encoders. */
  rpm: Reading;
  /** Cumulative encoder count — requires encoders. */
  encoderTicks: Reading;
}

export interface TelemetryFrame {
  /** Firmware/simulator frame counter, if provided. */
  frameSeq: number | null;
  timestamp: number;
  source: DataSourceKind;
  voltage: Reading;
  current: Reading;
  wheels: WheelTelemetry[] | null;
  /** Direction the robot reports it is executing, if the firmware reports it. */
  activeDirection: Direction | null;
}

/** Derived power sample computed from a voltage and current reading. */
export interface PowerSample {
  timestamp: number;
  source: DataSourceKind;
  power: Reading;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventCategory =
  | 'command'
  | 'stop'
  | 'connection'
  | 'comm_error'
  | 'telemetry'
  | 'localization'
  | 'config'
  | 'system';

export type Severity = 'info' | 'warning' | 'error';

/** Which part of the system produced the event. */
export type EventSource = 'ui' | 'simulator' | 'esp32' | 'localization' | 'app';

export interface AppEvent {
  id: number;
  timestamp: number;
  category: EventCategory;
  severity: Severity;
  source: EventSource;
  /** Whether the event describes simulated activity. */
  simulated: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Localization
// ---------------------------------------------------------------------------

/**
 * Pose in the grid frame.
 * Origin: bottom-left corner of the grid. +X to the right (east), +Y up (north).
 * Units: metres. Heading: degrees, 0 = facing +X, positive counter-clockwise, normalised to (-180, 180].
 */
export interface Pose {
  x: number;
  y: number;
  headingDeg: number;
}

/** These kinds are NOT interchangeable and are always labelled separately in the UI. */
export type EstimateKind = 'simulated' | 'odometry' | 'sensor_corrected' | 'ground_truth';

export type LocalizationStatus = 'tracking' | 'uninitialized' | 'unavailable' | 'stale' | 'out_of_bounds';

export interface LocalizationEstimate {
  pose: Pose | null;
  kind: EstimateKind;
  status: LocalizationStatus;
  timestamp: number;
  source: DataSourceKind;
  /** Human-readable name of the algorithm/engine that produced this estimate. */
  engine: string;
  /** Why the estimate is unavailable, if it is. */
  reason?: string;
}

export interface GridConfig {
  rows: number;
  cols: number;
  /** Cell edge length in metres (cells are square). */
  cellSizeM: number;
  initialPose: Pose;
}

export interface GroundTruthCheck {
  id: number;
  timestamp: number;
  truth: Pose;
  estimate: Pose | null;
  estimateKind: EstimateKind;
  positionErrorM: number | null;
  headingErrorDeg: number | null;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DemoConfig {
  /** PRNG seed — same seed + same inputs gives the same simulated link behaviour. */
  seed: number;
  /** Mean simulated one-way-plus-processing link delay (ms). */
  baseLatencyMs: number;
  /** Jitter amplitude (ms). Delay = base + jitter * N(0,1)-approximation, clamped >= 1 ms. */
  jitterMs: number;
  /** Probability that an ack is dropped (produces a timeout). 0–1. */
  dropRate: number;
  /** Probability that an ack arrives corrupted (counted as invalid). 0–1. */
  corruptRate: number;
  /** Probability per tick of a wheel-slip disturbance (affects simulated odometry vs simulated true pose). 0–1. */
  wheelSlip: number;
  scenario: 'manual' | 'square_path';
}

export interface RobotGeometry {
  /** Wheel radius (m). */
  wheelRadiusM: number;
  /** Half of the wheelbase: distance from centre to front axle (m). */
  halfWheelbaseM: number;
  /** Half of the track width: distance from centre to wheel contact line (m). */
  halfTrackM: number;
  /** Encoder ticks per wheel revolution (after gearbox). */
  ticksPerRev: number;
  /** Assumed wheel speed at 100 % command (rpm). Used only by the simulator. */
  maxWheelRpm: number;
}

export interface Esp32Config {
  /** WebSocket URL, e.g. ws://192.168.4.1/ws. No default — the firmware endpoint is not defined yet. */
  url: string;
  /** Ack timeout (ms). A command without ack after this is counted as a timeout. */
  ackTimeoutMs: number;
}

export interface ControllerConfig {
  /** Default speed % on load. */
  defaultSpeedPct: number;
  /** Heartbeat interval (ms): the active command is re-sent at this period so firmware can enforce a dead-man timeout. */
  heartbeatMs: number;
  /** Enable rotation (Q/E) controls. */
  enableRotation: boolean;
}

export interface DisplayConfig {
  /** Chart and statistics window (seconds). */
  windowSec: 30 | 60 | 120 | 300;
  showTrail: boolean;
  showGridLabels: boolean;
  reducedMotion: boolean;
}

export interface Settings {
  mode: AppMode;
  demo: DemoConfig;
  geometry: RobotGeometry;
  esp32: Esp32Config;
  controller: ControllerConfig;
  display: DisplayConfig;
  grid: GridConfig;
}
