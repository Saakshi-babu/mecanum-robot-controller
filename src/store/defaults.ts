import type { Settings } from '../types/models';

/**
 * Default settings. Robot geometry values are PLACEHOLDERS (typical 80 mm mecanum wheels,
 * 1320 ticks/rev gear-motor) and must be replaced with measured values from the real robot.
 */
export const DEFAULT_SETTINGS: Settings = {
  mode: 'demo',
  demo: {
    seed: 42,
    baseLatencyMs: 18,
    jitterMs: 4,
    dropRate: 0.01,
    corruptRate: 0.005,
    wheelSlip: 0.05,
    scenario: 'manual',
  },
  geometry: {
    wheelRadiusM: 0.04,
    halfWheelbaseM: 0.1,
    halfTrackM: 0.12,
    ticksPerRev: 1320,
    maxWheelRpm: 200,
  },
  esp32: {
    url: '',
    ackTimeoutMs: 300,
  },
  controller: {
    defaultSpeedPct: 40,
    heartbeatMs: 200,
    enableRotation: true,
  },
  display: {
    windowSec: 60,
    showTrail: true,
    showGridLabels: true,
    reducedMotion: false,
  },
  grid: {
    rows: 6,
    cols: 8,
    cellSizeM: 0.3,
    initialPose: { x: 0.45, y: 0.45, headingDeg: 0 },
  },
};

const STORAGE_KEY = 'mecanum.settings.v1';

function mergeSection<T extends object>(def: T, raw: unknown): T {
  if (typeof raw !== 'object' || raw === null) return { ...def };
  const out = { ...def } as Record<string, unknown>;
  for (const [k, v] of Object.entries(def)) {
    const r = (raw as Record<string, unknown>)[k];
    if (r === undefined) continue;
    if (typeof v === 'object' && v !== null) out[k] = mergeSection(v as object, r);
    else if (typeof r === typeof v && (typeof r !== 'number' || Number.isFinite(r))) out[k] = r;
  }
  return out as T;
}

/**
 * Load persisted settings. The mode is ALWAYS reset to 'demo' on load so the app never
 * silently starts trying to drive hardware.
 */
export function loadSettings(): Settings {
  let raw: unknown = null;
  try {
    const s = globalThis.localStorage?.getItem(STORAGE_KEY);
    raw = s ? JSON.parse(s) : null;
  } catch {
    raw = null;
  }
  const merged = mergeSection(DEFAULT_SETTINGS, raw);
  return { ...merged, mode: 'demo' };
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) — settings just won't persist */
  }
}
