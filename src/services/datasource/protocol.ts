import type { CommandAck, Direction, MotionCommand, Reading, TelemetryFrame, Unit, WheelTelemetry } from '../../types/models';
import { WHEEL_IDS } from '../../types/models';

/**
 * DRAFT protocol v0 (JSON over WebSocket). PROPOSAL ONLY — not implemented by any firmware yet.
 * See docs/ESP32_INTEGRATION.md. The firmware must implement this (or the adapter must be
 * changed to match whatever the firmware actually speaks).
 *
 * Browser → ESP32
 *   {"type":"cmd","seq":42,"dir":"forward","speed":60,"hb":false}
 * ESP32 → Browser
 *   {"type":"hello","fw":"1.0.0","caps":["ack","voltage","current","encoders"]}
 *   {"type":"ack","seq":42,"proc_us":180}                // proc_us optional
 *   {"type":"telemetry","seq":7,"v":11.9,"i":1.2,
 *    "wheels":{"FL":{"rpm":120,"ticks":3400},...},"dir":"forward"}   // every field except type optional
 * Missing fields → reading marked 'missing'. Non-numeric/non-finite → 'invalid'.
 */

const DIRECTIONS: Direction[] = [
  'stop', 'forward', 'backward', 'left', 'right', 'forward_left', 'forward_right',
  'backward_left', 'backward_right', 'rotate_ccw', 'rotate_cw',
];

export function encodeCommand(cmd: MotionCommand): string {
  return JSON.stringify({ type: 'cmd', seq: cmd.seq, dir: cmd.direction, speed: Math.round(cmd.speedPct), hb: cmd.heartbeat });
}

export type ParsedMessage =
  | { type: 'hello'; firmware: string | null; caps: string[] }
  | { type: 'ack'; ack: CommandAck }
  | { type: 'telemetry'; frame: TelemetryFrame }
  | { type: 'invalid'; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function reading(raw: unknown, unit: Unit, timestamp: number): Reading {
  if (raw === undefined || raw === null) return { value: null, unit, timestamp, validity: 'missing', source: 'esp32' };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { value: null, unit, timestamp, validity: 'invalid', source: 'esp32' };
  return { value: raw, unit, timestamp, validity: 'valid', source: 'esp32' };
}

export function parseMessage(text: string, receivedAt: number): ParsedMessage {
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return { type: 'invalid', reason: 'Not valid JSON' };
  }
  if (!isObj(msg) || typeof msg.type !== 'string') return { type: 'invalid', reason: 'Missing "type" field' };

  if (msg.type === 'hello') {
    const caps = Array.isArray(msg.caps) ? msg.caps.filter((c): c is string => typeof c === 'string') : [];
    return { type: 'hello', firmware: typeof msg.fw === 'string' ? msg.fw : null, caps };
  }

  if (msg.type === 'ack') {
    if (typeof msg.seq !== 'number' || !Number.isInteger(msg.seq) || msg.seq < 0) return { type: 'invalid', reason: 'Ack without valid integer seq' };
    const proc = typeof msg.proc_us === 'number' && Number.isFinite(msg.proc_us) && msg.proc_us >= 0 ? msg.proc_us / 1000 : undefined;
    return { type: 'ack', ack: { seq: msg.seq, receivedAt, deviceProcessingMs: proc, source: 'esp32' } };
  }

  if (msg.type === 'telemetry') {
    let wheels: WheelTelemetry[] | null = null;
    if (msg.wheels !== undefined) {
      if (!isObj(msg.wheels)) return { type: 'invalid', reason: '"wheels" must be an object' };
      const wobj = msg.wheels;
      wheels = WHEEL_IDS.map((w) => {
        const entry = isObj(wobj[w]) ? (wobj[w] as Record<string, unknown>) : {};
        return {
          wheel: w,
          commandPct: typeof entry.cmd === 'number' && Number.isFinite(entry.cmd) ? entry.cmd : null,
          rpm: reading(entry.rpm, 'rpm', receivedAt),
          encoderTicks: reading(entry.ticks, 'ticks', receivedAt),
        };
      });
    }
    const dir = typeof msg.dir === 'string' && (DIRECTIONS as string[]).includes(msg.dir) ? (msg.dir as Direction) : null;
    return {
      type: 'telemetry',
      frame: {
        frameSeq: typeof msg.seq === 'number' && Number.isInteger(msg.seq) ? msg.seq : null,
        // Firmware clock is not synchronised with the browser, so receive time is used.
        timestamp: receivedAt,
        source: 'esp32',
        voltage: reading(msg.v, 'V', receivedAt),
        current: reading(msg.i, 'A', receivedAt),
        wheels,
        activeDirection: dir,
      },
    };
  }

  return { type: 'invalid', reason: `Unknown message type "${String(msg.type).slice(0, 32)}"` };
}
