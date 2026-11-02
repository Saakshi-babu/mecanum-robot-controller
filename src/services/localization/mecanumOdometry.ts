import type { DataSourceKind, LocalizationEstimate, Pose, RobotGeometry, WheelId } from '../../types/models';
import { WHEEL_IDS } from '../../types/models';
import { forwardKinematics } from '../../lib/kinematics';
import { bodyToGrid, normalizeHeading } from '../../lib/grid';
import type { LocalizationEngine, LocalizationInput } from './types';

/**
 * Wheel-encoder dead-reckoning for a mecanum (X-roller) robot.
 *
 * Inputs: cumulative encoder ticks for FL, FR, RL, RR (all four required, all 'valid').
 * Per update:
 *   Δθ_w = 2π · Δticks_w / ticksPerRev                      (wheel rotation, rad)
 *   [Δx_b, Δy_b, Δψ] = forwardKinematics(Δθ, r, lx + ly)     (body-frame displacement)
 *   pose += R(ψ + Δψ/2) · [Δx_b, Δy_b];  ψ += Δψ             (midpoint integration)
 *
 * Rejection rules:
 *   - Any wheel missing/invalid → frame skipped; estimate goes 'stale' after staleMs.
 *   - |Δticks| implying more than maxRpm·1.5 → frame rejected and baseline re-taken (encoder glitch / reset).
 *   - Non-increasing timestamps → frame skipped.
 *
 * Known limitations: wheel slip (worse when strafing), roller compliance, uneven floor and
 * calibration error in r, lx, ly all accumulate as unbounded drift. Needs periodic re-anchoring
 * (recalibration at a known position) or an absolute reference to correct.
 */
export class MecanumOdometryEngine implements LocalizationEngine {
  readonly name = 'Mecanum wheel odometry';
  readonly kind = 'odometry' as const;
  private pose: Pose | null = null;
  private lastTicks: Record<WheelId, number> | null = null;
  private lastT = 0;
  private lastGoodT = 0;
  private reason: string | undefined = 'No encoder data received yet';
  rejectedFrames = 0;

  constructor(
    private geometry: RobotGeometry,
    readonly source: DataSourceKind,
    private readonly staleMs = 1000,
  ) {}

  setGeometry(g: RobotGeometry): void {
    this.geometry = g;
  }

  reset(pose: Pose, timestamp: number): void {
    this.pose = { ...pose, headingDeg: normalizeHeading(pose.headingDeg) };
    this.lastTicks = null; // next valid frame becomes the new baseline
    this.lastT = timestamp;
    this.lastGoodT = timestamp;
    this.reason = undefined;
  }

  update(input: LocalizationInput): LocalizationEstimate {
    const f = input.frame;
    if (!f || !f.wheels) {
      this.reason = 'Telemetry has no wheel encoder data';
      return this.current(input.timestamp);
    }
    const ticks = {} as Record<WheelId, number>;
    for (const w of WHEEL_IDS) {
      const r = f.wheels.find((x) => x.wheel === w)?.encoderTicks;
      if (!r || r.validity !== 'valid' || r.value === null || !Number.isFinite(r.value)) {
        this.reason = `Encoder ${w} reading ${r ? r.validity : 'missing'}`;
        return this.current(input.timestamp);
      }
      ticks[w] = r.value;
    }
    if (!this.pose) {
      this.reason = 'Initial pose not set — reset or recalibrate first';
      return this.current(input.timestamp);
    }
    if (!this.lastTicks) {
      this.lastTicks = ticks;
      this.lastT = f.timestamp;
      this.lastGoodT = f.timestamp;
      this.reason = undefined;
      return this.current(input.timestamp);
    }
    const dtMs = f.timestamp - this.lastT;
    if (dtMs <= 0) return this.current(input.timestamp);

    const tpr = this.geometry.ticksPerRev;
    const maxTicks = ((this.geometry.maxWheelRpm * 1.5) / 60) * tpr * (dtMs / 1000) + 2;
    const dTheta = {} as Record<WheelId, number>;
    for (const w of WHEEL_IDS) {
      const d = ticks[w] - this.lastTicks[w];
      if (Math.abs(d) > maxTicks) {
        this.rejectedFrames++;
        this.reason = `Rejected implausible encoder jump on ${w} (${d} ticks in ${dtMs.toFixed(0)} ms); baseline re-taken`;
        this.lastTicks = ticks;
        this.lastT = f.timestamp;
        return this.current(input.timestamp);
      }
      dTheta[w] = (2 * Math.PI * d) / tpr;
    }

    const k = this.geometry.halfWheelbaseM + this.geometry.halfTrackM;
    const disp = forwardKinematics(dTheta, this.geometry.wheelRadiusM, k);
    const dPsiDeg = (disp.omega * 180) / Math.PI;
    const g = bodyToGrid(disp.vx, disp.vy, this.pose.headingDeg + dPsiDeg / 2);
    this.pose = {
      x: this.pose.x + g.dx,
      y: this.pose.y + g.dy,
      headingDeg: normalizeHeading(this.pose.headingDeg + dPsiDeg),
    };
    this.lastTicks = ticks;
    this.lastT = f.timestamp;
    this.lastGoodT = f.timestamp;
    this.reason = undefined;
    return this.current(input.timestamp);
  }

  current(now: number): LocalizationEstimate {
    const base = { kind: this.kind, source: this.source, engine: this.name, timestamp: this.lastGoodT };
    if (!this.pose) return { ...base, pose: null, status: 'uninitialized', reason: this.reason };
    if (!this.lastTicks) return { ...base, pose: this.pose, status: 'unavailable', reason: this.reason ?? 'Waiting for first encoder frame' };
    if (now - this.lastGoodT > this.staleMs) return { ...base, pose: this.pose, status: 'stale', reason: this.reason ?? 'No valid encoder data recently' };
    return { ...base, pose: this.pose, status: 'tracking', reason: this.reason };
  }
}
