import { useNow, useStore } from '../hooks/useStore';
import { Badge, Card, KV, Stat } from '../components/ui';
import { DirectionPad, EmergencyStop, WheelDiagram } from '../components/controls';
import { ConnectionPill } from '../components/Shell';
import { DIRECTION_LABELS, isRotation } from '../lib/kinematics';
import { fmtClock } from '../lib/format';

export function Controller() {
  const store = useStore();
  useNow(1000);
  const c = store.control;
  const history = [...store.commandHistory.toArray()].reverse().slice(0, 25);
  const ls = store.latencyStats();
  return (
    <div className="page controller-page">
      <div className="controller-grid">
        <Card title="Direction" subtitle="Hold to move · release to stop" className="pad-card">
          <DirectionPad />
          {c.conflict && <div className="inline-warn" role="status">{c.conflict}</div>}
        </Card>

        <div className="stack">
          <Card title="Emergency stop">
            <EmergencyStop />
          </Card>

          <Card title="Speed" subtitle="Applies to buttons and keyboard">
            <div className="speed">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={c.speedPct}
                aria-label="Speed percent"
                onChange={(e) => store.setSpeed(Number(e.target.value))}
              />
              <span className="speed-val mono">{c.speedPct}%</span>
            </div>
            <p className="fine">
              Percentage of maximum wheel speed. {store.isDemo ? 'In the demo, 100% = ' + store.settings.geometry.maxWheelRpm + ' rpm (simulator assumption).' : ''}
              The firmware must define and enforce what 100% means (PWM duty or closed-loop speed). Not supported by any firmware yet.
            </p>
          </Card>
        </div>

        <div className="stack">
          <Card title="Current command" actions={<ConnectionPill />}>
            <div className="grid-2 tight">
              <Stat label="Direction" value={DIRECTION_LABELS[c.direction]} tone={c.direction === 'stop' ? 'muted' : 'move'} sub={c.direction === 'stop' ? 'Stopped' : isRotation(c.direction) ? 'Rotation' : 'Translation'} />
              <Stat label="Speed" value={c.direction === 'stop' ? 0 : c.speedPct} unit="%" sub={`selected ${c.speedPct}%`} />
            </div>
            <KV rows={[
              ['Origin', c.origin.replace('_', ' ')],
              ['Last seq', <span className="mono">{c.lastCommand?.seq ?? '—'}</span>],
              ['Written to transport', c.lastSendOk ? <Badge tone="ok">yes</Badge> : <Badge tone="danger">no</Badge>],
              ['Heartbeat', `${store.settings.controller.heartbeatMs} ms (re-sends current command)`],
              [store.isDemo ? 'Link RTT (simulated)' : 'Link RTT', <span className="mono">{ls.latestMs === null ? '—' : `${ls.latestMs.toFixed(1)} ms`}</span>],
              ['UI stop latch', c.latched ? <Badge tone="danger">LATCHED</Badge> : <Badge tone="muted">released</Badge>],
            ]} />
          </Card>

          <Card title="Commanded wheel speeds" subtitle="From mecanum inverse kinematics — commanded, not measured">
            <WheelDiagram direction={c.direction} speedPct={c.speedPct} />
          </Card>
        </div>
      </div>

      <div className="grid-2">
        <Card title="Keyboard" subtitle="Active anywhere except while typing in a field">
          <table className="table compact">
            <tbody>
              <tr><td><kbd>W</kbd> <kbd>S</kbd></td><td>Forward / backward</td></tr>
              <tr><td><kbd>A</kbd> <kbd>D</kbd></td><td>Strafe left / right</td></tr>
              <tr><td><kbd>W</kbd>+<kbd>A</kbd> …</td><td>Diagonals (one front/back key and one side key)</td></tr>
              <tr><td><kbd>Q</kbd> <kbd>E</kbd></td><td>Rotate CCW / CW in place</td></tr>
              <tr><td><kbd>Space</kbd></td><td>Stop</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>UI emergency stop (latching)</td></tr>
            </tbody>
          </table>
          <p className="fine">
            Conflicts resolve to the safe option. Opposite keys (W+S, A+D, Q+E) cancel that axis. Translation keys held together with rotation keys give STOP.
            Releasing all keys, switching tabs or leaving the window stops the robot.
          </p>
        </Card>

        <Card title="Command history" subtitle="Changes only. Heartbeat re-sends are not listed." actions={store.isDemo ? <Badge tone="warn">SIMULATED LINK</Badge> : undefined}>
          {history.length === 0 ? (
            <p className="muted">No commands sent yet.</p>
          ) : (
            <div className="table-scroll short">
              <table className="table compact">
                <thead><tr><th>Time</th><th>Seq</th><th>Command</th><th>Speed</th><th>Origin</th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.seq}>
                      <td className="mono">{fmtClock(h.issuedAt, true)}</td>
                      <td className="mono">{h.seq}</td>
                      <td>{DIRECTION_LABELS[h.direction]}</td>
                      <td className="mono">{h.speedPct}%</td>
                      <td>{h.origin.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
