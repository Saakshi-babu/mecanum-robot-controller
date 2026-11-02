import { useState } from 'react';
import { useNow, useStore } from '../hooks/useStore';
import { Badge, Card, Definition, Empty, KV, NumberField, Segmented, SourceTag } from '../components/ui';
import { GridCanvas, type Marker } from '../components/GridCanvas';
import { GridConfigForm } from '../components/GridConfigForm';
import { DirectionPad } from '../components/controls';
import { cellLabel, gridHeightM, gridWidthM, headingDiff, normalizeHeading, pointToCell, poseDistance } from '../lib/grid';
import { fmtAgo, fmtClock } from '../lib/format';
import { SQUARE_PATH } from '../store/robotStore';
import { DIRECTION_LABELS } from '../lib/kinematics';
import type { EstimateKind, LocalizationEstimate, Pose } from '../types/models';

type PickMode = 'none' | 'initial' | 'truth' | 'recal';

const KIND_LABEL: Record<EstimateKind, string> = {
  simulated: 'Simulated pose',
  odometry: 'Odometry estimate',
  sensor_corrected: 'Sensor-corrected estimate',
  ground_truth: 'Ground truth (measured)',
};

const STATUS_TONE = { tracking: 'ok', uninitialized: 'muted', unavailable: 'muted', stale: 'warn', out_of_bounds: 'danger' } as const;

function EstimateCard({ est, title, note, now }: { est: LocalizationEstimate; title: string; note: string; now: number }) {
  const store = useStore();
  const cell = est.pose ? pointToCell(store.settings.grid, est.pose.x, est.pose.y) : null;
  return (
    <Card title={title} subtitle={note} actions={<><SourceTag source={est.source} /><Badge tone={STATUS_TONE[est.status]}>{est.status.replace('_', ' ')}</Badge></>}>
      {est.pose ? (
        <KV rows={[
          ['X', <span className="mono">{est.pose.x.toFixed(3)} m</span>],
          ['Y', <span className="mono">{est.pose.y.toFixed(3)} m</span>],
          ['Heading', <span className="mono">{est.pose.headingDeg.toFixed(1)}°</span>],
          ['Cell', <span className="mono">{cellLabel(cell)}{!cell && ' (outside grid)'}</span>],
          ['Updated', <span className="mono">{fmtClock(est.timestamp, true)} · {fmtAgo(est.timestamp, now)}</span>],
          ['Source', est.engine],
        ]} />
      ) : (
        <p className="muted">No estimate.</p>
      )}
      {est.reason && <p className="fine">{est.reason}</p>}
    </Card>
  );
}

function PoseForm({ initial, submitLabel, onSubmit, picked }: { initial: Pose; submitLabel: string; onSubmit: (p: Pose) => void; picked?: { x: number; y: number } | null }) {
  const store = useStore();
  const [p, setP] = useState<Pose>(initial);
  const [lastPicked, setLastPicked] = useState(picked);
  if (picked && picked !== lastPicked) {
    setLastPicked(picked);
    setP((cur) => ({ ...cur, x: Math.round(picked.x * 100) / 100, y: Math.round(picked.y * 100) / 100 }));
  }
  const W = gridWidthM(store.settings.grid);
  const H = gridHeightM(store.settings.grid);
  const err = {
    x: p.x < 0 || p.x > W + 1e-9 ? `0–${W.toFixed(2)} m` : undefined,
    y: p.y < 0 || p.y > H + 1e-9 ? `0–${H.toFixed(2)} m` : undefined,
  };
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); if (!err.x && !err.y) onSubmit({ ...p, headingDeg: normalizeHeading(p.headingDeg) }); }}>
      <div className="form-row">
        <NumberField label="X" unit="m" value={p.x} step={0.01} onChange={(x) => setP({ ...p, x })} error={err.x} />
        <NumberField label="Y" unit="m" value={p.y} step={0.01} onChange={(y) => setP({ ...p, y })} error={err.y} />
        <NumberField label="Heading" unit="°" value={p.headingDeg} step={5} onChange={(headingDeg) => setP({ ...p, headingDeg })} />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={!!err.x || !!err.y}>{submitLabel}</button>
      </div>
    </form>
  );
}

export function Localization() {
  const store = useStore();
  const now = useNow(500);
  const [pickMode, setPickMode] = useState<PickMode>('none');
  const [picked, setPicked] = useState<Record<PickMode, { x: number; y: number } | null>>({ none: null, initial: null, truth: null, recal: null });
  const [checkAgainst, setCheckAgainst] = useState<EstimateKind>(store.isDemo ? 'odometry' : 'odometry');
  const g = store.settings.grid;
  const geo = store.settings.geometry;
  const sim = store.isDemo;
  const { simEstimate: simE, odoEstimate: odoE } = store;
  const primary = sim ? simE : odoE;
  const primaryCell = primary.pose ? pointToCell(g, primary.pose.x, primary.pose.y) : null;

  const markers: Marker[] = [];
  if (sim && simE.pose) markers.push({ id: 'sim', pose: simE.pose, label: 'Simulated pose', variant: 'simulated' });
  if (odoE.pose && odoE.status !== 'uninitialized' && odoE.status !== 'unavailable') markers.push({ id: 'odo', pose: odoE.pose, label: 'Odometry estimate', variant: 'odometry' });
  const trails = store.settings.display.showTrail
    ? [
        ...(sim ? [{ id: 'sim', points: store.trails.simulated, variant: 'simulated' as const }] : []),
        { id: 'odo', points: store.trails.odometry, variant: 'odometry' as const },
      ]
    : [];
  const drift = sim && simE.pose && odoE.pose ? { d: poseDistance(simE.pose, odoE.pose), h: headingDiff(odoE.pose.headingDeg, simE.pose.headingDeg) } : null;

  const pickHint = pickMode === 'none' ? undefined : `Click the grid to pick ${pickMode === 'initial' ? 'the initial position' : pickMode === 'truth' ? 'the measured ground-truth position' : 'the recalibration position'}. `;

  return (
    <div className="page">
      {sim ? (
        <div className="banner warn">
          <strong>DEMO localization.</strong> The simulated pose is the simulator's internal state, not a measurement. The odometry estimate is computed from
          <em> simulated</em> encoder counts using the same algorithm that will run on real data. Neither is evidence of real-world accuracy.
        </div>
      ) : (
        <div className="banner warn">
          <strong>Real localization needs encoder telemetry.</strong> Without valid wheel encoder data from the ESP32, the position is unknown. Movement
          commands alone don't establish where the robot is. Set a known starting pose with "Recalibrate" after placing the robot.
        </div>
      )}

      <div className="loc-grid">
        <div className="stack">
          <Card
            title="Grid"
            subtitle={`${g.cols} × ${g.rows} cells · ${g.cellSizeM} m cells · ${gridWidthM(g).toFixed(2)} × ${gridHeightM(g).toFixed(2)} m`}
            actions={
              <>
                {sim && <span className="demo-badge">DEMO</span>}
                <Badge tone="move">Cell {cellLabel(primaryCell)}</Badge>
              </>
            }
          >
            {markers.length === 0 && !sim ? (
              <>
                <GridCanvas grid={g} markers={[]} trails={[]} startPose={null} showLabels={store.settings.display.showGridLabels} robotSizeM={{ length: 0, width: 0 }} pick={pickMode !== 'none' ? picked[pickMode] : null} onPick={pickMode !== 'none' ? (x, y) => setPicked({ ...picked, [pickMode]: { x, y } }) : undefined} pickHint={pickHint} />
                <Empty title="Position unavailable">{odoE.reason ?? 'No localization data from the robot.'}</Empty>
              </>
            ) : (
              <GridCanvas
                grid={g}
                markers={markers}
                trails={trails}
                startPose={store.startPose}
                highlightCell={primaryCell}
                showLabels={store.settings.display.showGridLabels}
                robotSizeM={{ length: 2 * geo.halfWheelbaseM + 2 * geo.wheelRadiusM, width: 2 * geo.halfTrackM + 0.04 }}
                pick={pickMode !== 'none' ? picked[pickMode] : null}
                onPick={pickMode !== 'none' ? (x, y) => setPicked({ ...picked, [pickMode]: { x, y } }) : undefined}
                pickHint={pickHint}
              />
            )}
            <div className="legend-row">
              {sim && <span className="legend-item"><span className="legend-swatch" style={{ borderColor: 'var(--move)' }} />Simulated pose + trail</span>}
              <span className="legend-item"><span className="legend-swatch dashed" style={{ borderColor: 'var(--warn)' }} />Odometry estimate + trail</span>
              <span className="legend-item"><span className="legend-ring" />Start pose</span>
              {pickMode !== 'none' && <button type="button" className="btn btn-ghost" onClick={() => setPickMode('none')}>Cancel picking</button>}
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => store.resetLocalization()}>Reset to initial pose</button>
              {sim && (store.scenario.running ? (
                <button type="button" className="btn btn-primary" onClick={() => store.stopScenario()}>
                  Stop square path (step {store.scenario.step + 1}/{SQUARE_PATH.length}: {DIRECTION_LABELS[SQUARE_PATH[store.scenario.step]?.direction ?? 'stop']})
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => store.startScenario()} disabled={store.control.latched}>Run scripted square path</button>
              ))}
            </div>
          </Card>

          <Card title="Drive" subtitle="Same controls as the Robot Controller (keyboard works here too)">
            <DirectionPad compact />
          </Card>
        </div>

        <div className="stack">
          {sim && <EstimateCard est={simE} title={KIND_LABEL.simulated} note="Simulator's internal true pose (DEMO)" now={now} />}
          <EstimateCard est={odoE} title={KIND_LABEL.odometry} note={sim ? 'Dead reckoning from SIMULATED encoder counts' : 'Dead reckoning from ESP32 encoder counts'} now={now} />
          {drift && (
            <Card title="Odometry drift vs simulated pose" subtitle="DEMO: difference caused by simulated slip and strafing losses">
              <KV rows={[
                ['Position difference', <span className="mono">{(drift.d * 100).toFixed(1)} cm</span>],
                ['Heading difference', <span className="mono">{drift.h.toFixed(1)}°</span>],
              ]} />
            </Card>
          )}
          <Card title={KIND_LABEL.sensor_corrected} actions={<Badge tone="muted">not available</Badge>}>
            <p className="muted">No absolute position sensor (grid-line sensors, markers or similar) is confirmed on the robot, so there is no corrected estimate. The engine interface already supports adding one.</p>
          </Card>
          <Card title="Localization quality" actions={<Badge tone="muted">no confidence score</Badge>}>
            <p className="fine">
              No confidence percentage is shown because no defined, validated uncertainty model exists yet. Accuracy should be judged from ground-truth checks (below).
              A covariance from a calibrated odometry noise model, or an EKF, could provide one later.
            </p>
          </Card>
        </div>
      </div>

      <div className="grid-3">
        <Card title="Grid configuration" subtitle="Applying resets localization">
          <GridConfigForm pickedPoint={picked.initial} onRequestPick={() => setPickMode('initial')} />
        </Card>

        <Card title="Recalibrate odometry" subtitle="Re-anchor the estimate at a known, measured pose">
          <PoseForm initial={g.initialPose} submitLabel="Set odometry to this pose" onSubmit={(p) => store.recalibrate(p)} picked={picked.recal} />
          <button type="button" className="btn btn-ghost" onClick={() => setPickMode('recal')}>Pick on grid</button>
          <p className="fine">Place the robot at a known spot (for example, the centre of a marked cell, facing +X), then set that pose here. Odometry drift accumulates without limit, so re-anchor regularly. In the demo this doesn't move the simulated robot.</p>
        </Card>

        <Card title="Ground-truth check" subtitle="Compare an estimate to a position you measured">
          <div className="field">
            <label>Compare against</label>
            <Segmented label="Estimate to compare" value={checkAgainst} onChange={setCheckAgainst} options={[...(sim ? [{ value: 'simulated' as const, label: 'Simulated' }] : []), { value: 'odometry' as const, label: 'Odometry' }]} />
          </div>
          <PoseForm initial={g.initialPose} submitLabel="Record check" onSubmit={(p) => store.addGroundTruthCheck(p, checkAgainst)} picked={picked.truth} />
          <button type="button" className="btn btn-ghost" onClick={() => setPickMode('truth')}>Pick on grid</button>
        </Card>
      </div>

      <Card title="Ground-truth checks" subtitle="Errors are estimate − measured truth">
        {store.checks.length === 0 ? (
          <p className="muted">No checks recorded yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Time</th><th>Against</th><th>Truth (x, y, θ)</th><th>Estimate (x, y, θ)</th><th>Position error</th><th>Heading error</th></tr></thead>
              <tbody>
                {store.checks.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{fmtClock(c.timestamp)}</td>
                    <td>{KIND_LABEL[c.estimateKind]}{sim && ' (demo)'}</td>
                    <td className="mono">{c.truth.x.toFixed(3)}, {c.truth.y.toFixed(3)}, {c.truth.headingDeg.toFixed(1)}°</td>
                    <td className="mono">{c.estimate ? `${c.estimate.x.toFixed(3)}, ${c.estimate.y.toFixed(3)}, ${c.estimate.headingDeg.toFixed(1)}°` : 'N/A'}</td>
                    <td className="mono">{c.positionErrorM === null ? 'N/A' : `${(c.positionErrorM * 100).toFixed(1)} cm`}</td>
                    <td className="mono">{c.headingErrorDeg === null ? 'N/A' : `${c.headingErrorDeg.toFixed(1)}°`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid-2">
        <Card title="Coordinate conventions">
          <ul className="plain">
            <li><strong>Units:</strong> physical metres in the grid frame. Cell indices are derived from position, not stored.</li>
            <li><strong>Origin:</strong> (0, 0) is the bottom-left corner of the grid. <strong>+X</strong> points right (columns increase), <strong>+Y</strong> points up (rows increase).</li>
            <li><strong>Cells:</strong> zero-based. <code>col = ⌊x / {g.cellSizeM}⌋</code>, <code>row = ⌊y / {g.cellSizeM}⌋</code>. Row 0 is the bottom row. Labelled <code>C{'{col}'}·R{'{row}'}</code>. A point on the far edge belongs to the last cell.</li>
            <li><strong>Heading:</strong> degrees. 0° faces +X, counter-clockwise is positive, range (−180°, 180°].</li>
            <li><strong>Body frame:</strong> x forward, y left. "Strafe left" moves along the robot's +y, whatever its heading.</li>
          </ul>
        </Card>
        <Card title="Odometry algorithm">
          <ul className="plain">
            <li>Wheel rotation: Δθ = 2π · Δcount ÷ {geo.ticksPerRev} counts/rev.</li>
            <li>Forward kinematics (X rollers), r = {geo.wheelRadiusM} m, k = lx + ly = {(geo.halfWheelbaseM + geo.halfTrackM).toFixed(3)} m:<br />
              <code>Δx = r/4 (FL+FR+RL+RR)</code>, <code>Δy = r/4 (−FL+FR+RL−RR)</code>, <code>Δψ = r/(4k) (−FL+FR−RL+RR)</code></li>
            <li>Rotated into the grid frame at the midpoint heading, then integrated.</li>
            <li>Frames with any missing or invalid encoder reading are skipped. Impossible jumps (more than 1.5 × max rpm) are rejected and a new baseline is taken.</li>
            <li>Geometry values are <strong>placeholders</strong> until measured on the robot. The roller arrangement (X or O) and the motor direction signs must be checked.</li>
          </ul>
        </Card>
      </div>

      <Card title="Localization method assessment" subtitle="Choose based on hardware that is actually present — none of these sensors is confirmed yet">
        <div className="table-scroll">
          <table className="table method-table">
            <thead>
              <tr><th>Method</th><th>Extra hardware</th><th>Cost</th><th>Complexity</th><th>Drift</th><th>Calibration</th><th>Expected accuracy*</th></tr>
            </thead>
            <tbody>
              <tr><td><strong>Wheel-encoder odometry</strong></td><td>Quadrature encoders on all 4 motors (often built into gear motors), 4 interrupt pin pairs or PCNT units</td><td>Low</td><td>Low–medium</td><td>Unbounded. Worst when strafing (roller slip)</td><td>Wheel radius, lx+ly, per-wheel sign; drive-and-measure tests</td><td>A few % of distance travelled; heading drifts quickly</td></tr>
              <tr><td><strong>IMU-assisted odometry</strong></td><td>Gyro/IMU (e.g. MPU-6050, BNO055) over I²C</td><td>Low</td><td>Medium</td><td>Heading drift much reduced; position still drifts</td><td>Gyro bias at rest, mounting orientation</td><td>Better heading; position error grows more slowly</td></tr>
              <tr><td><strong>Grid-line / marker correction</strong></td><td>IR line sensors that detect grid lines, or RFID/NFC tags at cell centres</td><td>Low–medium</td><td>Medium–high</td><td>Bounded: resets when a line or tag is detected</td><td>Sensor offset from robot centre; marker map</td><td>About half a line width or tag-reader range at detection</td></tr>
              <tr><td><strong>Range sensors to walls</strong></td><td>ToF sensors (VL53L1X) on several sides, in a known enclosure</td><td>Medium</td><td>Medium–high</td><td>Bounded near walls</td><td>Sensor poses, wall map</td><td>Centimetre-level near walls; poor in open space</td></tr>
              <tr><td><strong>Camera-based</strong></td><td>—</td><td colSpan={5}>Out of scope for this phase (no computer vision).</td></tr>
            </tbody>
          </table>
        </div>
        <p className="fine">*Indicative only, from typical published behaviour of these methods, not measured on this robot. Recommended path: (1) encoders + this odometry engine, (2) add a gyro for heading, (3) add grid-line or tag detection for drift correction as a "sensor-corrected" engine. Each step plugs into the existing <code>LocalizationEngine</code> interface.</p>
      </Card>

      <Definition summary="Estimate types — why they are kept separate">
        <ul>
          <li><strong>Simulated pose</strong>: the demo simulator's internal state. It exists only in demo mode.</li>
          <li><strong>Odometry estimate</strong>: integrated from wheel encoder counts. It drifts over time.</li>
          <li><strong>Sensor-corrected estimate</strong>: odometry corrected by an absolute reference. Not available until such a sensor exists.</li>
          <li><strong>Ground truth</strong>: a position you measured by hand for testing (tape measure, marked cell). It is used only to evaluate the estimates.</li>
        </ul>
      </Definition>
    </div>
  );
}
