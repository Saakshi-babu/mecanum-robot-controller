import { useNow, useStore } from '../hooks/useStore';
import { Badge, Card, Definition, Empty, KV, Segmented, SourceTag, Stat } from '../components/ui';
import { TimeSeriesChart } from '../components/TimeSeriesChart';
import { HealthChart } from '../components/HealthChart';
import { CONN_LABEL } from '../components/Shell';
import { clockNow } from '../services/datasource/types';
import { healthBuckets } from '../lib/commStats';
import { fmtAgo, fmtClock, fmtDuration, fmtNum, fmtReading } from '../lib/format';
import { DIRECTION_LABELS } from '../lib/kinematics';
import { downloadText, fileStamp } from '../lib/csv';
import { latencyCsv, telemetryCsv } from '../store/exports';
import { TELEMETRY_STALE_MS, ENERGY_MAX_GAP_MS } from '../store/robotStore';
import type { DisplayConfig, Reading } from '../types/models';
import { WHEEL_IDS } from '../types/models';

const WINDOWS: { value: DisplayConfig['windowSec']; label: string }[] = [
  { value: 30, label: '30 s' },
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
  { value: 300, label: '5 min' },
];

function readingOrNA(r: Reading | undefined, stale: boolean, digits: number): string {
  if (stale) return 'N/A';
  return fmtReading(r, digits);
}

export function Dashboard() {
  const store = useStore();
  // Re-render at ~4 Hz so charts scroll smoothly even without new data.
  useNow(250);
  const now = Date.now();
  const perfNow = clockNow();
  const win = store.windowMs;
  const sim = store.isDemo;
  const conn = store.conn;

  const ls = store.latencyStats(perfNow);
  const cs = store.commStats(perfNow);
  const latencySamples = store.latencyInWindow(perfNow);
  const frames = store.framesInWindow(now);
  const power = store.powerInWindow(now);
  const frame = store.latestFrame();
  const stale = store.isFrameStale(frame, now);
  const lastPower = store.power.last();
  const energy = store.energy();
  const bucketMs = win <= 60_000 ? 1000 : win <= 120_000 ? 2000 : 5000;
  const buckets = healthBuckets(store.comm.toArray(), store.latency.toArray(), perfNow, win, bucketMs);
  const source = store.sourceKind;
  const tag = sim ? ' (simulated)' : '';

  const exportTelemetry = () =>
    downloadText(`telemetry_${source}_${fileStamp()}.csv`, telemetryCsv(store, store.telemetry.toArray(), store.power.toArray()));
  const exportLatency = () => downloadText(`latency_${source}_${fileStamp()}.csv`, latencyCsv(store, store.latency.toArray()));

  return (
    <div className="page">
      <div className="toolbar">
        <div className="toolbar-group">
          <span className="muted">Window</span>
          <Segmented label="Measurement window" value={store.settings.display.windowSec} options={WINDOWS} onChange={(v) => store.updateSettings({ display: { ...store.settings.display, windowSec: v } })} />
        </div>
        <div className="toolbar-group">
          <SourceTag source={source} />
          <button type="button" className="btn" onClick={exportTelemetry} disabled={store.telemetry.length === 0}>Export telemetry CSV</button>
          <button type="button" className="btn" onClick={exportLatency} disabled={store.latency.length === 0}>Export latency CSV</button>
        </div>
      </div>
      {sim && <div className="banner warn"><strong>Simulated data.</strong> Every value below comes from the demo simulator and simulated link, not from the robot. The real-hardware path is separate and currently shows nothing.</div>}

      {/* A. Connection */}
      <Card title="A · Connection status" actions={<SourceTag source={source} />}>
        <div className="grid-4">
          <Stat label="State" value={CONN_LABEL[conn.state]} tone={conn.state === 'connected' ? 'ok' : conn.state === 'demo' ? 'warn' : conn.state === 'connecting' ? 'neutral' : 'danger'} sub={`since ${fmtClock(conn.stateSince)}`} />
          <Stat label="ESP32 link" value={sim ? 'Not used' : conn.state === 'connected' ? 'Responding' : 'Not responding'} tone={sim ? 'muted' : conn.state === 'connected' ? 'ok' : 'danger'} sub={sim ? 'demo mode — no hardware link' : (store.settings.esp32.url || 'no URL configured')} />
          <Stat label="Connected for" value={sim ? 'N/A' : conn.connectedSince ? fmtDuration(now - conn.connectedSince) : '—'} sub={`${sim ? 'N/A' : conn.reconnects} reconnections`} />
          <Stat label="Last message" value={conn.lastMessageAt ? fmtClock(conn.lastMessageAt) : '—'} sub={fmtAgo(conn.lastMessageAt, now)} tone={conn.lastMessageAt && now - conn.lastMessageAt < TELEMETRY_STALE_MS ? 'ok' : 'warn'} />
        </div>
        <KV rows={[
          ['Detail', conn.detail || '—'],
          ['Last communication error', conn.lastError ? `${fmtClock(conn.lastError.t)} — ${conn.lastError.message}` : 'none'],
        ]} />
      </Card>

      {/* B. Latency */}
      <Card title={`B · Command round-trip latency${tag}`} subtitle={`Rolling ${store.settings.display.windowSec} s window · milliseconds`}>
        <div className="grid-6">
          <Stat label="Latest" value={fmtNum(ls.latestMs, 1)} unit="ms" />
          <Stat label="Average" value={fmtNum(ls.meanMs, 1)} unit="ms" />
          <Stat label="Minimum" value={fmtNum(ls.minMs, 1)} unit="ms" />
          <Stat label="Maximum" value={fmtNum(ls.maxMs, 1)} unit="ms" />
          <Stat label="95th pct" value={fmtNum(ls.p95Ms, 1)} unit="ms" />
          <Stat label="Valid samples" value={ls.validCount} sub={`${ls.timeouts} timeouts · ${ls.rejected} rejected`} tone={ls.timeouts ? 'warn' : 'neutral'} />
        </div>
        <TimeSeriesChart
          series={[{ id: 'rtt', label: `RTT${tag}`, color: 'var(--move)', points: latencySamples.filter((s) => s.outcome === 'acked').map((s) => ({ t: s.resolvedAt, v: s.rttMs })) }]}
          t0={perfNow - win}
          t1={perfNow}
          unit="ms"
          yLabel="Round-trip latency"
          yMin={0}
          maxGapMs={Math.max(1000, store.settings.controller.heartbeatMs * 3)}
          emptyTitle="No acknowledged commands in this window"
          emptyBody={sim ? undefined : 'Latency needs the firmware to acknowledge each command by seq.'}
        />
        <Definition summary="What these latency numbers measure">
          <ul>
            <li><strong>Round-trip latency (RTT)</strong>: the browser clock reading just before a command (with a unique <code>seq</code>) is written to the transport, subtracted from the browser clock reading when an ack with the same <code>seq</code> arrives. Both readings use the same monotonic clock, so a clock offset between the browser and the ESP32 doesn't matter.</li>
            <li>RTT includes the browser send path, the network both ways, and ESP32 handling up to the ack. It does <strong>not</strong> include the motors physically responding. That needs a defined observable event, such as the first encoder tick change after the command, and is not measured here.</li>
            <li><strong>ESP32 processing time</strong> can only be shown if the firmware reports it (<code>proc_us</code>). It is not derived from RTT.</li>
            <li><strong>Browser-to-server request time</strong> doesn't apply: there is no server in between.</li>
            <li>Commands include periodic heartbeat re-sends ({store.settings.controller.heartbeatMs} ms), so latency is sampled continuously.</li>
            <li>A command with no ack within {store.ackTimeoutMs} ms counts as a <strong>timeout</strong> and is excluded from the statistics (never recorded as 0). Late, duplicate, unmatched and corrupted acks are rejected too.</li>
            <li>Average is the arithmetic mean of valid samples in the window. Min/max are the extremes. The 95th percentile uses nearest rank. The window is <code>now − {store.settings.display.windowSec} s … now</code>, keyed by the time each sample was resolved.</li>
            {sim && <li>Demo: the delay is generated by a seeded simulated link (base {store.settings.demo.baseLatencyMs} ms, jitter {store.settings.demo.jitterMs} ms, 2% spikes). The value shown is still timed with the browser clock, so it also includes real timer jitter.</li>}
          </ul>
        </Definition>
      </Card>

      {/* C. Communication health */}
      <Card title={`C · Communication health${tag}`} subtitle={`Counts over the last ${store.settings.display.windowSec} s`}>
        <div className="grid-6">
          <Stat label="Sent" value={cs.sent} sub={`${cs.txRate.toFixed(1)} msg/s`} />
          <Stat label="Received" value={cs.received} sub={`${cs.rxRate.toFixed(1)} msg/s`} />
          <Stat label="Ack rate" value={cs.ackRate === null ? '—' : (cs.ackRate * 100).toFixed(1)} unit={cs.ackRate === null ? undefined : '%'} tone={cs.ackRate !== null && cs.ackRate < 0.95 ? 'warn' : 'neutral'} sub={`${cs.acked} acked / ${cs.acked + cs.timeouts} resolved`} />
          <Stat label="Timeouts" value={cs.timeouts} tone={cs.timeouts ? 'warn' : 'neutral'} sub={`> ${store.ackTimeoutMs} ms without ack`} />
          <Stat label="Invalid msgs" value={cs.invalid} tone={cs.invalid ? 'warn' : 'neutral'} sub={`${cs.rejectedAcks} rejected acks`} />
          <Stat label="Errors · Reconn." value={`${cs.errors} · ${sim ? 'N/A' : cs.reconnects}`} tone={cs.errors ? 'danger' : 'neutral'} sub="transport errors · reconnects" />
        </div>
        <HealthChart buckets={buckets} bucketSec={bucketMs / 1000} />
        <Definition summary="Counting rules">
          <ul>
            <li><strong>Sent</strong>: command messages written to the transport, heartbeats included. <strong>Received</strong>: well-formed acks, well-formed telemetry frames, and messages that failed validation.</li>
            <li><strong>Ack rate</strong> = acked ÷ (acked + timeouts), over commands <em>resolved</em> in the window. Commands still waiting for an ack are not counted, so a message that just hasn't arrived yet is never counted as lost.</li>
            <li>Loss is only inferred from sequence-numbered acks plus the {store.ackTimeoutMs} ms timeout policy. Telemetry frames without acks are not used to infer loss.</li>
            <li><strong>Invalid</strong>: messages that are not valid JSON, have an unknown type, have missing or ill-typed required fields, or (in the demo) a simulated checksum failure.</li>
            <li>Rates are counts in the window divided by the window length ({store.settings.display.windowSec} s).</li>
          </ul>
        </Definition>
      </Card>

      {/* D. Power */}
      <Card title={`D · Power & electrical${tag}`} actions={<SourceTag source={frame ? frame.source : null} />}>
        <div className="grid-4">
          <Stat label="Voltage" value={readingOrNA(frame?.voltage, stale, 2)} unit={stale || frame?.voltage.validity !== 'valid' ? undefined : 'V'} sub={stale ? 'no recent telemetry' : frame?.voltage.validity} />
          <Stat label="Current" value={readingOrNA(frame?.current, stale, 3)} unit={stale || frame?.current.validity !== 'valid' ? undefined : 'A'} sub={stale ? 'no recent telemetry' : frame?.current.validity} />
          <Stat label="Power (V × I)" value={stale ? 'N/A' : fmtReading(lastPower?.power, 2)} unit={stale || lastPower?.power.validity !== 'valid' ? undefined : 'W'} sub={stale ? 'no recent telemetry' : lastPower?.power.validity} />
          <Stat label="Energy (session)" value={energy.energyWh === null ? 'N/A' : (energy.energyWh * 1000).toFixed(2)} unit={energy.energyWh === null ? undefined : 'mWh'} sub={`${fmtDuration(energy.coveredMs)} integrated · ${energy.skippedIntervals} gaps skipped`} />
        </div>
        {frames.length === 0 ? (
          <Empty title="No power telemetry in this window">
            {sim ? 'Waiting for simulator…' : 'Voltage and current need sensors (e.g. an INA219/INA226 on the battery output) plus firmware support. Nothing is shown until the ESP32 sends them.'}
          </Empty>
        ) : (
          <div className="grid-2">
            <TimeSeriesChart series={[{ id: 'v', label: `Voltage${tag}`, color: 'var(--warn)', points: frames.map((f) => ({ t: f.timestamp, v: f.voltage.validity === 'valid' ? f.voltage.value : null })) }]} t0={now - win} t1={now} unit="V" yLabel="Voltage" digits={2} height={170} />
            <TimeSeriesChart series={[{ id: 'i', label: `Current${tag}`, color: 'var(--move)', points: frames.map((f) => ({ t: f.timestamp, v: f.current.validity === 'valid' ? f.current.value : null })) }]} t0={now - win} t1={now} unit="A" yLabel="Current" yMin={0} digits={3} height={170} />
            <TimeSeriesChart series={[{ id: 'p', label: `Power${tag}`, color: 'var(--accent2)', points: power.map((p) => ({ t: p.timestamp, v: p.power.value })) }]} t0={now - win} t1={now} unit="W" yLabel="Power" yMin={0} digits={2} height={170} />
            <TimeSeriesChart series={[{ id: 'e', label: `Cumulative energy${tag}`, color: 'var(--ok)', points: store.energySeries.between(now - win, now, (e) => e.t).map((e) => ({ t: e.t, v: e.wh * 1000 })) }]} t0={now - win} t1={now} unit="mWh" yLabel="Energy since start" digits={3} height={170} />
          </div>
        )}
        <Definition summary="Power and energy definitions">
          <ul>
            <li><strong>P = V × I</strong>. It is computed only when the voltage and current are both valid, come from the same source, and have timestamps within 50 ms of each other. Otherwise P shows N/A. V and I must be measured at the same point (for example, the battery output).</li>
            <li><strong>Energy</strong> is the trapezoidal integral of consecutive valid power samples since the data source started. Intervals longer than {ENERGY_MAX_GAP_MS} ms or with an invalid endpoint are skipped, not interpolated, so energy may be underestimated across gaps.</li>
            <li>Readings older than {TELEMETRY_STALE_MS} ms are shown as N/A (stale).</li>
            {sim && <li>Demo model: a 3S pack (12.6 V full, 10.5 V empty), 0.12 Ω internal resistance, 0.32 A idle current plus a load proportional to wheel speed, and seeded noise. These are assumptions, not measurements.</li>}
          </ul>
        </Definition>
      </Card>

      {/* E. Motor */}
      <Card title={`E · Motor telemetry${tag}`} subtitle={frame?.activeDirection ? `Robot-reported command: ${DIRECTION_LABELS[frame.activeDirection]}` : 'Robot-reported command: not available'}>
        {!frame || !frame.wheels ? (
          <Empty title="Wheel telemetry not available">
            RPM and encoder counts need wheel encoders and firmware that reports them. Nothing is assumed when they are absent.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Wheel</th><th>Commanded</th><th>Speed</th><th>Encoder count</th><th>Validity</th></tr>
              </thead>
              <tbody>
                {WHEEL_IDS.map((w) => {
                  const wt = frame.wheels!.find((x) => x.wheel === w);
                  return (
                    <tr key={w}>
                      <td><strong>{w}</strong></td>
                      <td className="mono">{wt?.commandPct === null || wt?.commandPct === undefined ? 'N/A' : `${wt.commandPct.toFixed(0)} %`}</td>
                      <td className="mono">{stale ? 'N/A' : `${fmtReading(wt?.rpm, 1)}${wt?.rpm.validity === 'valid' ? ' rpm' : ''}`}</td>
                      <td className="mono">{stale ? 'N/A' : `${fmtReading(wt?.encoderTicks, 0)}${wt?.encoderTicks.validity === 'valid' ? ' ticks' : ''}`}</td>
                      <td>{stale ? <Badge tone="warn">stale</Badge> : <Badge tone={wt?.rpm.validity === 'valid' ? 'ok' : 'warn'}>{wt?.rpm.validity ?? 'missing'}</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {frames.some((f) => f.wheels) && (
          <TimeSeriesChart
            series={WHEEL_IDS.map((w, k) => ({
              id: w,
              label: `${w} rpm${tag}`,
              color: ['var(--move)', 'var(--ok)', 'var(--warn)', 'var(--accent2)'][k],
              dashed: k % 2 === 1,
              points: frames.map((f) => {
                const r = f.wheels?.find((x) => x.wheel === w)?.rpm;
                return { t: f.timestamp, v: r && r.validity === 'valid' ? r.value : null };
              }),
            }))}
            t0={now - win}
            t1={now}
            unit="rpm"
            yLabel="Wheel speed"
            height={180}
          />
        )}
        {sim && <p className="fine">Demo: simulated encoders count actual simulated wheel rotation (1st-order motor lag, τ = 0.15 s). The simulated body slips, so the encoders don't match body motion exactly, as on a real robot.</p>}
      </Card>

      {/* F. Recent events */}
      <Card title="F · Recent events" actions={<a className="btn btn-ghost" href="#/events">All events & export →</a>}>
        <ul className="event-mini">
          {[...store.events.toArray()].reverse().slice(0, 8).map((e) => (
            <li key={e.id} className={`sev-${e.severity}`}>
              <span className="mono">{fmtClock(e.timestamp)}</span>
              <Badge tone={e.severity === 'error' ? 'danger' : e.severity === 'warning' ? 'warn' : 'muted'}>{e.category}</Badge>
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
