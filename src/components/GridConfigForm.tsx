import { useEffect, useState } from 'react';
import type { GridConfig } from '../types/models';
import { GRID_LIMITS, gridHeightM, gridWidthM, validateGridConfig } from '../lib/grid';
import { useStore } from '../hooks/useStore';
import { NumberField } from './ui';

/** Draft-and-apply grid configuration. Changes take effect only when valid and applied (resets localization). */
export function GridConfigForm({ pickedPoint, onRequestPick }: { pickedPoint?: { x: number; y: number } | null; onRequestPick?: () => void }) {
  const store = useStore();
  const current = store.settings.grid;
  const [draft, setDraft] = useState<GridConfig>(current);
  useEffect(() => setDraft(current), [current]);
  useEffect(() => {
    if (pickedPoint) setDraft((d) => ({ ...d, initialPose: { ...d.initialPose, x: round(pickedPoint.x), y: round(pickedPoint.y) } }));
  }, [pickedPoint]);
  const v = validateGridConfig(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);
  const set = (patch: Partial<GridConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const setPose = (patch: Partial<GridConfig['initialPose']>) => setDraft((d) => ({ ...d, initialPose: { ...d.initialPose, ...patch } }));
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); if (v.ok) store.setGrid(draft); }}>
      <div className="form-row">
        <NumberField label="Columns" value={draft.cols} integer min={GRID_LIMITS.cols.min} max={GRID_LIMITS.cols.max} onChange={(cols) => set({ cols })} error={v.errors.cols} />
        <NumberField label="Rows" value={draft.rows} integer min={GRID_LIMITS.rows.min} max={GRID_LIMITS.rows.max} onChange={(rows) => set({ rows })} error={v.errors.rows} />
        <NumberField label="Cell size" unit="m" value={draft.cellSizeM} step={0.05} min={GRID_LIMITS.cellSizeM.min} max={GRID_LIMITS.cellSizeM.max} onChange={(cellSizeM) => set({ cellSizeM })} error={v.errors.cellSizeM} />
      </div>
      <p className="fine">
        Grid size: <span className="mono">{Number.isFinite(gridWidthM(draft)) ? gridWidthM(draft).toFixed(2) : '—'} m × {Number.isFinite(gridHeightM(draft)) ? gridHeightM(draft).toFixed(2) : '—'} m</span>
        {' '}({draft.cols * draft.rows || 0} cells)
      </p>
      <div className="form-row">
        <NumberField label="Initial X" unit="m" value={draft.initialPose.x} step={0.05} onChange={(x) => setPose({ x })} error={v.errors.x} />
        <NumberField label="Initial Y" unit="m" value={draft.initialPose.y} step={0.05} onChange={(y) => setPose({ y })} error={v.errors.y} />
        <NumberField label="Initial heading" unit="°" value={draft.initialPose.headingDeg} step={15} onChange={(headingDeg) => setPose({ headingDeg })} error={v.errors.headingDeg} hint="0° = +X, CCW positive" />
      </div>
      <div className="form-actions">
        {onRequestPick && <button type="button" className="btn btn-ghost" onClick={onRequestPick}>Pick initial position on grid</button>}
        <button type="button" className="btn btn-ghost" disabled={!dirty} onClick={() => setDraft(current)}>Discard</button>
        <button type="submit" className="btn btn-primary" disabled={!v.ok || !dirty}>Apply & reset localization</button>
      </div>
    </form>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;
