import type { BodyVelocity, Direction, WheelId } from '../types/models';

/**
 * Mecanum kinematics for the standard "X" roller arrangement
 * (rollers on FL and RR at +45°, FR and RL at -45° when viewed from above).
 *
 * Body frame: x forward, y left, omega counter-clockwise (rad/s).
 * Wheel angular speeds in rad/s, positive = rolls robot forward.
 * k = halfWheelbase + halfTrack.
 *
 * IMPORTANT: the real roller orientation and motor wiring must be confirmed
 * on the robot. If the rollers form an "O" pattern, signs of vy/omega terms flip.
 */

export const DIRECTION_VECTORS: Record<Direction, BodyVelocity> = {
  stop: { vx: 0, vy: 0, omega: 0 },
  forward: { vx: 1, vy: 0, omega: 0 },
  backward: { vx: -1, vy: 0, omega: 0 },
  left: { vx: 0, vy: 1, omega: 0 },
  right: { vx: 0, vy: -1, omega: 0 },
  forward_left: { vx: Math.SQRT1_2, vy: Math.SQRT1_2, omega: 0 },
  forward_right: { vx: Math.SQRT1_2, vy: -Math.SQRT1_2, omega: 0 },
  backward_left: { vx: -Math.SQRT1_2, vy: Math.SQRT1_2, omega: 0 },
  backward_right: { vx: -Math.SQRT1_2, vy: -Math.SQRT1_2, omega: 0 },
  rotate_ccw: { vx: 0, vy: 0, omega: 1 },
  rotate_cw: { vx: 0, vy: 0, omega: -1 },
};

export type WheelSpeeds = Record<WheelId, number>;

/** Inverse kinematics: body velocity (m/s, m/s, rad/s) -> wheel angular speeds (rad/s). */
export function inverseKinematics(
  vx: number,
  vy: number,
  omega: number,
  wheelRadius: number,
  k: number,
): WheelSpeeds {
  return {
    FL: (vx - vy - k * omega) / wheelRadius,
    FR: (vx + vy + k * omega) / wheelRadius,
    RL: (vx + vy - k * omega) / wheelRadius,
    RR: (vx - vy + k * omega) / wheelRadius,
  };
}

/** Forward kinematics: wheel angular speeds (rad/s) -> body velocity (m/s, m/s, rad/s). */
export function forwardKinematics(w: WheelSpeeds, wheelRadius: number, k: number): BodyVelocity {
  return {
    vx: (wheelRadius / 4) * (w.FL + w.FR + w.RL + w.RR),
    vy: (wheelRadius / 4) * (-w.FL + w.FR + w.RL - w.RR),
    omega: (wheelRadius / (4 * k)) * (-w.FL + w.FR - w.RL + w.RR),
  };
}

/**
 * Normalised wheel command (% of max, signed) for a direction at a given speed %.
 * Values are scaled so the largest wheel magnitude equals speedPct.
 */
export function wheelCommandPct(direction: Direction, speedPct: number): WheelSpeeds {
  const v = DIRECTION_VECTORS[direction];
  const raw = inverseKinematics(v.vx, v.vy, v.omega, 1, 1);
  const maxMag = Math.max(Math.abs(raw.FL), Math.abs(raw.FR), Math.abs(raw.RL), Math.abs(raw.RR));
  if (maxMag === 0) return { FL: 0, FR: 0, RL: 0, RR: 0 };
  const s = speedPct / maxMag;
  return { FL: raw.FL * s, FR: raw.FR * s, RL: raw.RL * s, RR: raw.RR * s };
}

export function isRotation(d: Direction): boolean {
  return d === 'rotate_ccw' || d === 'rotate_cw';
}

export const DIRECTION_LABELS: Record<Direction, string> = {
  stop: 'Stop',
  forward: 'Forward',
  backward: 'Backward',
  left: 'Strafe left',
  right: 'Strafe right',
  forward_left: 'Forward-left',
  forward_right: 'Forward-right',
  backward_left: 'Backward-left',
  backward_right: 'Backward-right',
  rotate_ccw: 'Rotate CCW',
  rotate_cw: 'Rotate CW',
};
