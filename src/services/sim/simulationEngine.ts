import type { Direction, GridConfig, Pose, RobotGeometry, WheelId } from '../../types/models';
import { WHEEL_IDS } from '../../types/models';
import { forwardKinematics, wheelCommandPct, type WheelSpeeds } from '../../lib/kinematics';
import { Prng } from '../../lib/prng';
import { bodyToGrid, clampToGrid, normalizeHeading } from '../../lib/grid';

/**
 * Deterministic mecanum robot simulator. DEMO ONLY.
 *
 * Fixed-step: every call to step() advances simulated time by `dtSec`, independent of the
 * wall clock, so the same seed + the same command sequence yields identical output.
 *
 * Model (documented assumptions, not measurements of the real robot):
 *  - Wheel speed follows the commanded speed with a first-order lag (tau = motorTauSec).
 *  - 100 % command = geometry.maxWheelRpm.
 *  - Simulated encoders integrate actual wheel rotation exactly, quantised to whole ticks.
 *  - The simulated body moves by forward kinematics of the actual wheel speeds, reduced by
 *    a lateral efficiency factor (mecanum strafing loses traction) and random slip events.
 *    This makes encoder odometry drift away from the simulated true pose, as it would in reality.
 *  - The robot cannot leave the grid; at the boundary the body stops while wheels keep turning.
 *  - Battery: 3S pack, open-circuit 12.6 V full → 10.5 V empty (linear in charge),
 *    internal resistance R_int, capacity capacityAh. Current = idle + k × Σ|wheel ω|.
 *  - Dead-man watchdog: if no command arrives for watchdogSec, the simulator stops itself.
 *    Real firmware should implement the same behaviour.
 */

export interface SimParams {
  dtSec: number;
  motorTauSec: number;
  lateralEfficiency: number;
  slipMagnitude: number;
  idleCurrentA: number;
  ampsPerRadPerSec: number;
  internalResistanceOhm: number;
  capacityAh: number;
  voltageNoiseV: number;
  currentNoiseA: number;
  watchdogSec: number;
}

export const DEFAULT_SIM_PARAMS: SimParams = {
  dtSec: 0.05,
  motorTauSec: 0.15,
  lateralEfficiency: 0.9,
  slipMagnitude: 0.35,
  idleCurrentA: 0.32,
  ampsPerRadPerSec: 0.028,
  internalResistanceOhm: 0.12,
  capacityAh: 2.0,
  voltageNoiseV: 0.008,
  currentNoiseA: 0.012,
  watchdogSec: 0.5,
};

export interface SimSnapshot {
  timeSec: number;
  /** Simulator's internal true pose. Labelled "simulated pose" in the UI — not a real measurement. */
  pose: Pose;
  direction: Direction;
  speedPct: number;
  wheelCommandPct: WheelSpeeds;
  wheelRpm: WheelSpeeds;
  encoderTicks: Record<WheelId, number>;
  voltageV: number;
  currentA: number;
  atBoundary: boolean;
  watchdogTripped: boolean;
}

const RPM_TO_RADS = (2 * Math.PI) / 60;

export class SimulationEngine {
  private prng: Prng;
  private t = 0;
  private pose: Pose;
  private direction: Direction = 'stop';
  private speedPct = 0;
  private lastCommandAt = 0;
  private watchdogTripped = false;
  private wheelRads: WheelSpeeds = { FL: 0, FR: 0, RL: 0, RR: 0 };
  private wheelAngle: WheelSpeeds = { FL: 0, FR: 0, RL: 0, RR: 0 };
  private usedAh = 0;
  private atBoundary = false;
  private lastV = 12.6;
  private lastI = 0;

  constructor(
    private geometry: RobotGeometry,
    private grid: GridConfig,
    private seed: number,
    private slipProbability: number,
    readonly params: SimParams = DEFAULT_SIM_PARAMS,
  ) {
    this.prng = new Prng(seed);
    this.pose = { ...grid.initialPose };
  }

  /** Apply a command as if it had arrived at the robot. */
  applyCommand(direction: Direction, speedPct: number): void {
    this.direction = direction;
    this.speedPct = Math.max(0, Math.min(100, speedPct));
    this.lastCommandAt = this.t;
    this.watchdogTripped = false;
  }

  setPose(pose: Pose): void {
    this.pose = { ...pose, headingDeg: normalizeHeading(pose.headingDeg) };
    this.atBoundary = false;
  }

  setGrid(grid: GridConfig): void {
    this.grid = grid;
  }

  setGeometry(g: RobotGeometry): void {
    this.geometry = g;
  }

  setSlipProbability(p: number): void {
    this.slipProbability = p;
  }

  /** Full reset to t = 0 with the original seed (reproducible run). */
  reset(pose: Pose = this.grid.initialPose): void {
    this.prng = new Prng(this.seed);
    this.t = 0;
    this.direction = 'stop';
    this.speedPct = 0;
    this.lastCommandAt = 0;
    this.watchdogTripped = false;
    this.wheelRads = { FL: 0, FR: 0, RL: 0, RR: 0 };
    this.wheelAngle = { FL: 0, FR: 0, RL: 0, RR: 0 };
    this.usedAh = 0;
    this.setPose(pose);
  }

  step(): SimSnapshot {
    const p = this.params;
    const dt = p.dtSec;
    this.t += dt;

    if (this.direction !== 'stop' && this.t - this.lastCommandAt > p.watchdogSec) {
      this.direction = 'stop';
      this.watchdogTripped = true;
    }

    const cmdPct = wheelCommandPct(this.direction, this.speedPct);
    const maxRads = this.geometry.maxWheelRpm * RPM_TO_RADS;
    const alpha = 1 - Math.exp(-dt / p.motorTauSec);
    for (const w of WHEEL_IDS) {
      const target = (cmdPct[w] / 100) * maxRads;
      this.wheelRads[w] += (target - this.wheelRads[w]) * alpha;
      // Static friction: below ~0.1 rpm with zero command the wheel is considered stopped.
      if (Math.abs(this.wheelRads[w]) < 0.01 && target === 0) this.wheelRads[w] = 0;
      this.wheelAngle[w] += this.wheelRads[w] * dt;
    }

    const k = this.geometry.halfWheelbaseM + this.geometry.halfTrackM;
    const body = forwardKinematics(this.wheelRads, this.geometry.wheelRadiusM, k);
    const moving = Math.abs(body.vx) + Math.abs(body.vy) + Math.abs(body.omega) > 1e-6;
    let slip = 1;
    if (moving && this.prng.chance(this.slipProbability)) slip = 1 - p.slipMagnitude * this.prng.next();
    const vx = body.vx * slip;
    const vy = body.vy * p.lateralEfficiency * slip;
    const omega = body.omega * slip;

    const midHeading = this.pose.headingDeg + ((omega * dt) / 2) * (180 / Math.PI);
    const d = bodyToGrid(vx * dt, vy * dt, midHeading);
    const c = clampToGrid(this.grid, this.pose.x + d.dx, this.pose.y + d.dy);
    this.atBoundary = c.clamped;
    this.pose = {
      x: c.x,
      y: c.y,
      headingDeg: normalizeHeading(this.pose.headingDeg + omega * dt * (180 / Math.PI)),
    };

    const sumAbs = WHEEL_IDS.reduce((s, w) => s + Math.abs(this.wheelRads[w]), 0);
    const iTrue = p.idleCurrentA + p.ampsPerRadPerSec * sumAbs;
    this.usedAh += (iTrue * dt) / 3600;
    const soc = Math.max(0, 1 - this.usedAh / p.capacityAh);
    const vOc = 10.5 + 2.1 * soc;
    this.lastI = Math.max(0, iTrue + p.currentNoiseA * this.prng.gaussian());
    this.lastV = vOc - iTrue * p.internalResistanceOhm + p.voltageNoiseV * this.prng.gaussian();

    return this.snapshot();
  }

  snapshot(): SimSnapshot {
    const ticks = {} as Record<WheelId, number>;
    const rpm = {} as WheelSpeeds;
    for (const w of WHEEL_IDS) {
      ticks[w] = Math.trunc((this.wheelAngle[w] / (2 * Math.PI)) * this.geometry.ticksPerRev);
      rpm[w] = this.wheelRads[w] / RPM_TO_RADS;
    }
    return {
      timeSec: this.t,
      pose: { ...this.pose },
      direction: this.direction,
      speedPct: this.speedPct,
      wheelCommandPct: wheelCommandPct(this.direction, this.speedPct),
      wheelRpm: rpm,
      encoderTicks: ticks,
      voltageV: Math.round(this.lastV * 100) / 100,
      currentA: Math.round(this.lastI * 1000) / 1000,
      atBoundary: this.atBoundary,
      watchdogTripped: this.watchdogTripped,
    };
  }
}

/** Simulated link: decides delay / drop / corruption for each command deterministically. */
export interface LinkDecision {
  delayMs: number;
  dropped: boolean;
  corrupted: boolean;
}

export class SimulatedLink {
  private prng: Prng;

  constructor(
    private seed: number,
    public baseLatencyMs: number,
    public jitterMs: number,
    public dropRate: number,
    public corruptRate: number,
  ) {
    // Offset the seed so link randomness is independent of the motion simulator stream.
    this.prng = new Prng(seed ^ 0x9e3779b9);
  }

  reset(): void {
    this.prng = new Prng(this.seed ^ 0x9e3779b9);
  }

  decide(): LinkDecision {
    const g = this.prng.gaussian();
    const spike = this.prng.chance(0.02) ? this.baseLatencyMs * (1 + 2 * this.prng.next()) : 0;
    const delayMs = Math.max(1, this.baseLatencyMs + this.jitterMs * g + spike);
    const dropped = this.prng.chance(this.dropRate);
    const corrupted = !dropped && this.prng.chance(this.corruptRate);
    return { delayMs, dropped, corrupted };
  }
}
