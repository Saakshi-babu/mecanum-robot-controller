import type { CommandAck, ConnectionState, DataSourceKind, MotionCommand, TelemetryFrame } from '../../types/models';
import type { SimSnapshot } from '../sim/simulationEngine';

/**
 * A DataSource is the only thing that talks to "the robot" — simulated or real.
 * The app never reads the simulator directly except through DemoDataSource,
 * which keeps simulated and real data paths physically separate.
 */
export interface DataSourceListener {
  onState(state: ConnectionState, detail?: string): void;
  onAck(ack: CommandAck): void;
  onTelemetry(frame: TelemetryFrame): void;
  /** A received message that failed validation. */
  onInvalid(reason: string, raw?: string): void;
  onError(message: string): void;
  /** A successful reconnection after an unexpected disconnect. */
  onReconnect?(): void;
  /** Demo only: simulator ground state for the simulated localization engine. */
  onSimSnapshot?(snap: SimSnapshot): void;
  /** Free-form informational events (e.g. firmware hello, simulator watchdog). */
  onInfo?(message: string, severity?: 'info' | 'warning'): void;
}

export interface DataSource {
  readonly kind: DataSourceKind;
  start(listener: DataSourceListener): void;
  stop(): void;
  /**
   * Write a command to the transport. Returns the browser-clock time immediately
   * before writing (latency timer start), or null if the transport is not writable.
   */
  send(cmd: MotionCommand): number | null;
  readonly writable: boolean;
}

/** Browser monotonic clock mapped to epoch ms. Used for all latency timestamps. */
export function clockNow(): number {
  return typeof performance !== 'undefined' && performance.timeOrigin
    ? performance.timeOrigin + performance.now()
    : Date.now();
}
