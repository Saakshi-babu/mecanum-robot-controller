import type { Direction } from '../types/models';

/**
 * Keyboard → direction resolution.
 *
 * Translation: W forward, S backward, A strafe left, D strafe right; diagonals
 * by combining one longitudinal and one lateral key.
 * Rotation: Q counter-clockwise, E clockwise.
 *
 * Conflict rules (resolved to the safest interpretation):
 *  - Opposing keys on the same axis (W+S, A+D, Q+E) cancel that axis.
 *  - Translation and rotation held together → stop (they are never blended).
 */
export const MOVEMENT_KEYS = ['w', 'a', 's', 'd', 'q', 'e'] as const;
export type MovementKey = (typeof MOVEMENT_KEYS)[number];

export interface KeyResolution {
  direction: Direction;
  conflict: boolean;
  reason?: string;
}

export function isMovementKey(key: string): key is MovementKey {
  return (MOVEMENT_KEYS as readonly string[]).includes(key);
}

export function resolveKeys(held: ReadonlySet<string>, rotationEnabled = true): KeyResolution {
  const w = held.has('w');
  const s = held.has('s');
  const a = held.has('a');
  const d = held.has('d');
  const q = rotationEnabled && held.has('q');
  const e = rotationEnabled && held.has('e');

  let conflict = false;
  const reasons: string[] = [];

  let lon = 0;
  if (w && s) {
    conflict = true;
    reasons.push('W+S cancel');
  } else lon = w ? 1 : s ? -1 : 0;

  let lat = 0;
  if (a && d) {
    conflict = true;
    reasons.push('A+D cancel');
  } else lat = a ? 1 : d ? -1 : 0;

  let rot = 0;
  if (q && e) {
    conflict = true;
    reasons.push('Q+E cancel');
  } else rot = q ? 1 : e ? -1 : 0;

  const translating = lon !== 0 || lat !== 0;
  if (translating && rot !== 0) {
    return { direction: 'stop', conflict: true, reason: 'Translation and rotation held together — stopped' };
  }
  const reason = reasons.length ? reasons.join(', ') : undefined;
  if (rot !== 0) return { direction: rot > 0 ? 'rotate_ccw' : 'rotate_cw', conflict, reason };

  const table: Record<string, Direction> = {
    '1,0': 'forward',
    '-1,0': 'backward',
    '0,1': 'left',
    '0,-1': 'right',
    '1,1': 'forward_left',
    '1,-1': 'forward_right',
    '-1,1': 'backward_left',
    '-1,-1': 'backward_right',
    '0,0': 'stop',
  };
  return { direction: table[`${lon},${lat}`], conflict, reason };
}

/** True when keyboard events should be ignored because the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    // Range sliders and checkboxes don't take text; everything else does.
    return !['range', 'checkbox', 'radio', 'button', 'submit'].includes(type);
  }
  return el.isContentEditable === true;
}
