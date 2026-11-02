import type { AppEvent, LatencySample, TelemetryFrame, PowerSample } from '../types/models';
import { WHEEL_IDS } from '../types/models';
import { toCsv, isoStamp, type CsvValue } from '../lib/csv';
import type { RobotStore } from './robotStore';

/**
 * CSV builders. Every row carries an ISO timestamp, epoch ms, and a `source` column
 * ("simulated" or "esp32"). Column names include units. A '#' preamble documents
 * definitions so the file is self-describing.
 */

function commonMeta(store: RobotStore): Record<string, string> {
  return {
    app: 'Mecanum Robot Controller',
    exported_at: new Date().toISOString(),
    mode: store.isDemo ? 'DEMO — all values are SIMULATED, not hardware measurements' : 'ESP32 — values as received from the device',
    timestamps: 'timestamp_iso (UTC) and timestamp_ms (ms since Unix epoch, browser clock)',
  };
}

/** Valid values only, rounded to 6 significant digits to drop floating-point noise (e.g. 3.9061600000000003). */
const val = (r: { value: number | null; validity: string }): CsvValue =>
  r.validity === 'valid' && r.value !== null ? Number(r.value.toPrecision(6)) : null;

export function telemetryCsv(store: RobotStore, frames: readonly TelemetryFrame[], power: readonly PowerSample[]): string {
  const header = [
    'timestamp_iso', 'timestamp_ms', 'source', 'frame_seq',
    'voltage_V', 'voltage_validity', 'current_A', 'current_validity', 'power_W', 'power_validity',
    'active_direction',
    ...WHEEL_IDS.flatMap((w) => [`${w}_command_pct`, `${w}_speed_rpm`, `${w}_rpm_validity`, `${w}_encoder_ticks`, `${w}_ticks_validity`]),
  ];
  const powerByT = new Map(power.map((p) => [p.timestamp, p]));
  const rows = frames.map((f) => {
    const p = powerByT.get(Math.max(f.voltage.timestamp, f.current.timestamp));
    const wheelCols = WHEEL_IDS.flatMap((w) => {
      const wt = f.wheels?.find((x) => x.wheel === w);
      if (!wt) return [null, null, 'missing', null, 'missing'];
      return [wt.commandPct === null ? null : Number(wt.commandPct.toFixed(2)), val(wt.rpm), wt.rpm.validity, val(wt.encoderTicks), wt.encoderTicks.validity];
    });
    return [
      isoStamp(f.timestamp), f.timestamp, f.source, f.frameSeq,
      val(f.voltage), f.voltage.validity, val(f.current), f.current.validity,
      p ? val(p.power) : null, p ? p.power.validity : 'missing',
      f.activeDirection,
      ...wheelCols,
    ];
  });
  return toCsv(header, rows, {
    ...commonMeta(store),
    power_definition: 'power_W = voltage_V × current_A, only when both valid and measured within 50 ms; otherwise empty',
    validity: 'valid | invalid | missing | stale — empty value cells mean no valid measurement (never zero-filled)',
    wheel_command_pct: 'commanded wheel speed as signed % of max, from mecanum inverse kinematics',
  });
}

export function latencyCsv(store: RobotStore, samples: readonly LatencySample[]): string {
  const header = ['timestamp_iso', 'timestamp_ms', 'source', 'seq', 'sent_at_ms', 'outcome', 'rtt_ms'];
  const rows = samples.map((s) => [
    isoStamp(s.resolvedAt), Math.round(s.resolvedAt), s.source, s.seq,
    Number.isFinite(s.sentAt) ? Math.round(s.sentAt * 1000) / 1000 : null, s.outcome,
    s.rttMs === null ? null : Math.round(s.rttMs * 1000) / 1000,
  ]);
  return toCsv(header, rows, {
    ...commonMeta(store),
    rtt_definition: 'Command round-trip: browser clock just before writing the command → browser clock when the matching ack (same seq) is received',
    not_included: 'Physical motor/wheel response time; ESP32 internal processing is included in RTT but not separable without firmware proc_us',
    outcomes: `acked (valid sample) | timeout (no ack within ${store.ackTimeoutMs} ms, rtt empty) | late_ack | duplicate_ack | unmatched_ack | invalid — only "acked" rows enter statistics`,
    timestamp_ms: 'time the sample was resolved (ack received or timeout deadline)',
  });
}

export function eventsCsv(store: RobotStore, events: readonly AppEvent[]): string {
  const header = ['timestamp_iso', 'timestamp_ms', 'category', 'severity', 'source', 'simulated', 'message'];
  const rows = events.map((e) => [isoStamp(e.timestamp), e.timestamp, e.category, e.severity, e.source, e.simulated ? 'simulated' : 'real', e.message]);
  return toCsv(header, rows, {
    ...commonMeta(store),
    simulated_column: '"simulated" = event describes simulated/demo activity; "real" = UI or ESP32 activity not involving the simulator',
  });
}
