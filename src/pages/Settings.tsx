import { useState } from 'react';
import { useStore } from '../hooks/useStore';
import { Badge, Card, NumberField, Segmented, Toggle } from '../components/ui';
import { GridConfigForm } from '../components/GridConfigForm';
import { CONN_LABEL } from '../components/Shell';
import type { DisplayConfig } from '../types/models';

export function Settings() {
  const store = useStore();
  const s = store.settings;
  const [url, setUrl] = useState(s.esp32.url);
  const urlValid = url === '' || /^wss?:\/\/[^\s/]+/i.test(url);

  const switchMode = (mode: 'demo' | 'esp32') => {
    if (mode === s.mode) return;
    const msg = mode === 'esp32'
      ? 'Switch to ESP32 mode?\n\nThe simulator stops and ALL simulated telemetry, latency, logs of measurements and trails are cleared. Only data actually received from the ESP32 will be shown. Without firmware that implements the protocol, nothing will connect.'
      : 'Switch to DEMO mode?\n\nThe ESP32 link closes (a STOP is sent first if connected) and all ESP32 measurements are cleared. Everything shown afterwards is simulated.';
    if (confirm(msg)) store.setMode(mode);
  };

  return (
    <div className="page">
      <Card title="Data source mode" actions={<Badge tone={s.mode === 'demo' ? 'warn' : 'ok'}>{s.mode === 'demo' ? 'DEMO' : 'ESP32'}</Badge>}>
        <Segmented label="Mode" value={s.mode} onChange={switchMode} options={[{ value: 'demo', label: 'Demo (simulated)' }, { value: 'esp32', label: 'ESP32 hardware' }]} />
        <p className="fine">
          Switching clears every buffer, so simulated and real data are never mixed. The app always starts in Demo mode.
          {s.mode === 'esp32' && <> Current link: <strong>{CONN_LABEL[store.conn.state]}</strong>{store.conn.detail && ` — ${store.conn.detail}`}.</>}
        </p>
      </Card>

      <div className="grid-2">
        <Card title="ESP32 connection" subtitle="Draft protocol v0 — see docs/ESP32_INTEGRATION.md">
          <div className="banner warn small">No firmware implements this protocol yet. No endpoint is assumed: enter the WebSocket URL your firmware will serve. No Wi-Fi credentials are needed or stored here.</div>
          <div className={`field ${urlValid ? '' : 'has-error'}`}>
            <label htmlFor="ws-url">WebSocket URL</label>
            <input id="ws-url" type="text" spellCheck={false} placeholder="ws://<esp32-ip>/<path>" value={url} onChange={(e) => setUrl(e.target.value.trim())} />
            {!urlValid && <div className="field-error">Must start with ws:// or wss://</div>}
          </div>
          <NumberField label="Ack timeout" unit="ms" integer min={20} max={5000} value={s.esp32.ackTimeoutMs} onChange={(ackTimeoutMs) => store.updateSettings({ esp32: { ...s.esp32, ackTimeoutMs } })} hint="Commands without an ack within this time count as timeouts" />
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={!urlValid || url === s.esp32.url} onClick={() => { store.updateSettings({ esp32: { ...s.esp32, url } }); if (s.mode === 'esp32') store.restartSource(); }}>
              Save URL{s.mode === 'esp32' ? ' & reconnect' : ''}
            </button>
            {s.mode === 'esp32' && <button type="button" className="btn" onClick={() => store.restartSource()}>Reconnect</button>}
          </div>
          <p className="fine">Note: a page served over https:// cannot open an unencrypted ws:// connection. Serve the app over http on the local network, or from the ESP32 itself.</p>
        </Card>

        <Card title="Demo simulator" subtitle="Deterministic — same seed and same inputs give the same run">
          <div className="form-row">
            <NumberField label="Seed" integer min={0} max={2 ** 31 - 1} value={s.demo.seed} onChange={(seed) => store.updateSettings({ demo: { ...s.demo, seed } })} hint="Applied on restart" />
            <NumberField label="Base link delay" unit="ms" min={1} max={2000} value={s.demo.baseLatencyMs} onChange={(baseLatencyMs) => store.updateSettings({ demo: { ...s.demo, baseLatencyMs } })} />
            <NumberField label="Jitter" unit="ms" min={0} max={500} value={s.demo.jitterMs} onChange={(jitterMs) => store.updateSettings({ demo: { ...s.demo, jitterMs } })} />
          </div>
          <div className="form-row">
            <NumberField label="Ack drop rate" unit="0–1" step={0.01} min={0} max={1} value={s.demo.dropRate} onChange={(dropRate) => store.updateSettings({ demo: { ...s.demo, dropRate } })} />
            <NumberField label="Corrupt rate" unit="0–1" step={0.01} min={0} max={1} value={s.demo.corruptRate} onChange={(corruptRate) => store.updateSettings({ demo: { ...s.demo, corruptRate } })} />
            <NumberField label="Wheel slip prob." unit="0–1" step={0.01} min={0} max={1} value={s.demo.wheelSlip} onChange={(wheelSlip) => store.updateSettings({ demo: { ...s.demo, wheelSlip } })} hint="Per 50 ms step" />
          </div>
          <div className="form-actions">
            <button type="button" className="btn" disabled={!store.isDemo} onClick={() => store.restartSource()}>Restart simulation (applies seed, clears data)</button>
          </div>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Controller">
          <div className="form-row">
            <NumberField label="Default speed" unit="%" integer min={0} max={100} value={s.controller.defaultSpeedPct} onChange={(defaultSpeedPct) => store.updateSettings({ controller: { ...s.controller, defaultSpeedPct } })} hint="Used on next load" />
            <NumberField label="Heartbeat interval" unit="ms" integer min={50} max={2000} value={s.controller.heartbeatMs} onChange={(heartbeatMs) => store.updateSettings({ controller: { ...s.controller, heartbeatMs } })} hint="Firmware watchdog should be ≥ 2.5× this" />
          </div>
          <Toggle label="Enable rotation controls (Q / E)" checked={s.controller.enableRotation} onChange={(enableRotation) => store.updateSettings({ controller: { ...s.controller, enableRotation } })} />
          <p className="fine">Speed scaling, heartbeat and the dead-man watchdog must also be implemented in firmware. The UI can't enforce them on the robot.</p>
        </Card>

        <Card title="Display">
          <div className="field">
            <label>Chart & statistics window</label>
            <Segmented<DisplayConfig['windowSec']> label="Window" value={s.display.windowSec} onChange={(windowSec) => store.updateSettings({ display: { ...s.display, windowSec } })} options={[{ value: 30, label: '30 s' }, { value: 60, label: '1 min' }, { value: 120, label: '2 min' }, { value: 300, label: '5 min' }]} />
          </div>
          <Toggle label="Show movement trail" checked={s.display.showTrail} onChange={(showTrail) => store.updateSettings({ display: { ...s.display, showTrail } })} />
          <Toggle label="Show grid cell labels" checked={s.display.showGridLabels} onChange={(showGridLabels) => store.updateSettings({ display: { ...s.display, showGridLabels } })} />
          <Toggle label="Reduce motion" checked={s.display.reducedMotion} onChange={(reducedMotion) => store.updateSettings({ display: { ...s.display, reducedMotion } })} />
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Robot geometry" subtitle="PLACEHOLDER values — measure on the real robot">
          <div className="form-row">
            <NumberField label="Wheel radius" unit="m" step={0.001} min={0.005} max={0.5} value={s.geometry.wheelRadiusM} onChange={(wheelRadiusM) => store.updateSettings({ geometry: { ...s.geometry, wheelRadiusM } })} />
            <NumberField label="Half wheelbase lx" unit="m" step={0.005} min={0.01} max={2} value={s.geometry.halfWheelbaseM} onChange={(halfWheelbaseM) => store.updateSettings({ geometry: { ...s.geometry, halfWheelbaseM } })} hint="centre → axle" />
            <NumberField label="Half track ly" unit="m" step={0.005} min={0.01} max={2} value={s.geometry.halfTrackM} onChange={(halfTrackM) => store.updateSettings({ geometry: { ...s.geometry, halfTrackM } })} hint="centre → wheel" />
          </div>
          <div className="form-row">
            <NumberField label="Encoder counts / rev" integer min={1} max={100000} value={s.geometry.ticksPerRev} onChange={(ticksPerRev) => store.updateSettings({ geometry: { ...s.geometry, ticksPerRev } })} hint="at the wheel, after gearbox, ×4 if quadrature" />
            <NumberField label="Max wheel speed" unit="rpm" min={1} max={2000} value={s.geometry.maxWheelRpm} onChange={(maxWheelRpm) => store.updateSettings({ geometry: { ...s.geometry, maxWheelRpm } })} hint="simulator + glitch rejection" />
          </div>
        </Card>
        <Card title="Grid" subtitle="Same as on the Grid Localization page">
          <GridConfigForm />
        </Card>
      </div>
    </div>
  );
}
