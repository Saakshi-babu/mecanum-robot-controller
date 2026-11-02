import type { DataSourceKind, EstimateKind, LocalizationEstimate, Pose, TelemetryFrame } from '../../types/models';

export interface LocalizationInput {
  timestamp: number;
  /** Telemetry frame (for engines that use measured data). */
  frame?: TelemetryFrame;
  /** Simulator true pose (only for the simulated engine; never present with ESP32 data). */
  simulatedPose?: Pose;
}

/**
 * A localization engine turns inputs into a pose estimate. The grid UI only consumes
 * LocalizationEstimate, so engines can be swapped without changing the interface.
 */
export interface LocalizationEngine {
  readonly name: string;
  readonly kind: EstimateKind;
  readonly source: DataSourceKind;
  reset(pose: Pose, timestamp: number): void;
  update(input: LocalizationInput): LocalizationEstimate;
  current(now: number): LocalizationEstimate;
}
