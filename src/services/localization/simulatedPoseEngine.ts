import type { LocalizationEstimate, Pose } from '../../types/models';
import type { LocalizationEngine, LocalizationInput } from './types';

/**
 * DEMO ONLY: reports the simulator's internal true pose.
 * This is not a localization algorithm — it is what the simulator "knows" — and must never be
 * presented as evidence of real-world accuracy.
 */
export class SimulatedPoseEngine implements LocalizationEngine {
  readonly name = 'Simulator internal pose';
  readonly kind = 'simulated' as const;
  readonly source = 'simulated' as const;
  private pose: Pose | null = null;
  private t = 0;

  reset(pose: Pose, timestamp: number): void {
    this.pose = { ...pose };
    this.t = timestamp;
  }

  update(input: LocalizationInput): LocalizationEstimate {
    if (input.simulatedPose) {
      this.pose = { ...input.simulatedPose };
      this.t = input.timestamp;
    }
    return this.current(input.timestamp);
  }

  current(_now?: number): LocalizationEstimate {
    return {
      pose: this.pose,
      kind: this.kind,
      status: this.pose ? 'tracking' : 'uninitialized',
      timestamp: this.t,
      source: this.source,
      engine: this.name,
    };
  }
}
