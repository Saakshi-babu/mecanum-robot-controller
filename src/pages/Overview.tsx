import { useNow, useStore } from '../hooks/useStore';
import { Badge, Card, KV, SourceTag, Stat } from '../components/ui';
import { CONN_LABEL } from '../components/Shell';
import { DIRECTION_LABELS } from '../lib/kinematics';
import { cellLabel, pointToCell } from '../lib/grid';
import { fmtAgo, fmtNum, fmtReading } from '../lib/format';

/** What the frontend knows about the hardware. Nothing is assumed beyond what has been confirmed. */
const CAPABILITIES: [string, string, 'unknown' | 'draft' | 'na'][] = [
  ['ESP32 firmware & protocol', 'No firmware in reviewed repos. A draft WebSocket protocol is proposed in docs/ESP32_INTEGRATION.md.', 'draft'],
  ['Command acknowledgements (seq)', 'Required for latency/health metrics. Not confirmed in firmware.', 'unknown'],
  ['Wheel encoders', 'Not confirmed. Required for RPM and odometry.', 'unknown'],
  ['IMU (gyro)', 'Not confirmed. Would reduce heading drift.', 'unknown'],
  ['Voltage / current sensing', 'Not confirmed. Requires e.g. INA219/INA226 on the battery line.', 'unknown'],
  ['Absolute position reference', 'None. Grid markers / line sensors would be needed for correction.', 'unknown'],
  ['Hardware emergency stop', 'Unknown. The UI stop is software-only.', 'unknown'],
  ['AI vision', 'Out of scope for this phase.', 'na'],
];

export function Overview() {
  const store = useStore();
  const now = useNow(1000);
  const ls = store.latencyStats();
  const frame = store.latestFrame();
  const stale = store.isFrameStale(frame, now);
  const est = store.isDemo ? store.simEstimate : store.odoEstimate;
  const cell = est.pose ? pointToCell(store.settings.grid, est.pose.x, est.pose.y) : null;
  const c = store.control;
  return (
    <div className="page">
      {store.isDemo && (
        <div className="banner warn">
          <strong>DEMO MODE.</strong> The robot is not connected. Every number on this page comes from a deterministic simulator
          (seed {store.settings.demo.seed}) and is labelled <Badge tone="warn">SIMULATED</Badge>. Simulated values are not evidence of real performance.
        </div>
      )}
      <div className="grid-4">
        <Stat label="Connection" value={CONN_LABEL[store.conn.state]} tone={store.conn.state === 'connected' ? 'ok' : store.conn.state === 'demo' ? 'warn' : 'danger'} sub={`Last message ${fmtAgo(store.conn.lastMessageAt, Date.now())}`} />
        <Stat label="Command" value={DIRECTION_LABELS[c.direction]} tone={c.direction === 'stop' ? 'muted' : 'move'} sub={c.latched ? 'UI stop latched' : `Speed ${c.speedPct}%`} />
        <Stat label={store.isDemo ? 'Latency (simulated)' : 'Latency'} value={fmtNum(ls.meanMs, 1)} unit="ms" sub={`avg of ${ls.validCount} samples · ${store.settings.display.windowSec} s window`} />
        <Stat label={store.isDemo ? 'Battery (simulated)' : 'Battery'} value={stale ? 'N/A' : fmtReading(frame?.voltage, 2)} unit={stale ? undefined : 'V'} sub={stale ? 'no recent telemetry' : `current ${fmtReading(frame?.current, 2)} A`} />
      </div>

      <div className="grid-2">
        <Card title="Position" subtitle={est.engine} actions={<SourceTag source={est.pose ? est.source : null} />}>
          {est.pose ? (
            <KV rows={[
              ['X', <span className="mono">{est.pose.x.toFixed(3)} m</span>],
              ['Y', <span className="mono">{est.pose.y.toFixed(3)} m</span>],
              ['Heading', <span className="mono">{est.pose.headingDeg.toFixed(1)}°</span>],
              ['Cell', <span className="mono">{cellLabel(cell)}</span>],
              ['Kind', est.kind === 'simulated' ? 'Simulated pose (demo)' : est.kind],
              ['Status', est.status],
            ]} />
          ) : (
            <p className="muted">Position unavailable: {est.reason ?? 'no localization data'}. Movement commands alone do not establish the robot's position.</p>
          )}
          <a className="btn btn-ghost" href="#/localization">Open grid localization →</a>
        </Card>

        <Card title="Hardware capability status" subtitle="What the frontend can rely on today">
          <ul className="cap-list">
            {CAPABILITIES.map(([name, desc, s]) => (
              <li key={name}>
                <Badge tone={s === 'draft' ? 'move' : s === 'na' ? 'muted' : 'warn'}>{s === 'draft' ? 'DRAFT' : s === 'na' ? 'OUT OF SCOPE' : 'NOT CONFIRMED'}</Badge>
                <div>
                  <div className="cap-name">{name}</div>
                  <div className="fine">{desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Quick start">
        <ol className="steps">
          <li>Go to <a href="#/controller">Robot Controller</a>. Hold a direction button, or use <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> (diagonals: two keys), <kbd>Q</kbd>/<kbd>E</kbd> to rotate, <kbd>Space</kbd> to stop, <kbd>Esc</kbd> to latch the UI stop.</li>
          <li>Watch the simulated latency, link health and power on the <a href="#/dashboard">Live Dashboard</a>.</li>
          <li>On <a href="#/localization">Grid Localization</a>, run the scripted square path and compare the simulated pose with the odometry estimate as it drifts.</li>
          <li>When firmware exists, switch to ESP32 mode in <a href="#/settings">Settings</a>. All simulated data is cleared when you switch.</li>
        </ol>
      </Card>
    </div>
  );
}
