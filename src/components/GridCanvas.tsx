import type { GridConfig, Pose } from '../types/models';
import type { TrailPoint } from '../store/robotStore';
import { cellLabel, gridHeightM, gridWidthM, pointToCell, svgToWorld, worldToSvg } from '../lib/grid';

const PX_PER_M = 200;
const MARGIN = 34;

export interface Marker {
  id: string;
  pose: Pose;
  label: string;
  variant: 'simulated' | 'odometry' | 'truth';
}

interface Props {
  grid: GridConfig;
  markers: Marker[];
  trails: { id: string; points: TrailPoint[]; variant: Marker['variant'] }[];
  startPose: Pose | null;
  highlightCell?: { col: number; row: number } | null;
  pick?: { x: number; y: number } | null;
  showLabels: boolean;
  robotSizeM: { length: number; width: number };
  onPick?: (x: number, y: number) => void;
  pickHint?: string;
}

/**
 * SVG rendering of the grid. World frame: origin bottom-left, +X right, +Y up (metres).
 * SVG y grows downward, so world→SVG flips Y; heading (CCW+) becomes rotate(-heading).
 */
export function GridCanvas({ grid, markers, trails, startPose, highlightCell, pick, showLabels, robotSizeM, onPick, pickHint }: Props) {
  const w = gridWidthM(grid) * PX_PER_M;
  const h = gridHeightM(grid) * PX_PER_M;
  const cs = grid.cellSizeM * PX_PER_M;
  const toSvg = (x: number, y: number) => worldToSvg(grid, x, y, PX_PER_M);
  const labelEvery = grid.cols > 20 || grid.rows > 20 ? 5 : grid.cols > 12 ? 2 : 1;
  const scale = Math.max(0.6, Math.min(2.5, cs / 60));

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    const world = svgToWorld(grid, p.x, p.y, PX_PER_M);
    if (pointToCell(grid, world.x, world.y)) onPick(world.x, world.y);
  };

  const robotL = robotSizeM.length * PX_PER_M;
  const robotW = robotSizeM.width * PX_PER_M;

  return (
    <div className="grid-canvas">
      <svg
        viewBox={`${-MARGIN} ${-MARGIN / 2} ${w + MARGIN * 1.5} ${h + MARGIN * 1.6}`}
        role="img"
        aria-label={`Grid ${grid.cols} by ${grid.rows} cells; ${markers.map((m) => `${m.label} at x ${m.pose.x.toFixed(2)} m, y ${m.pose.y.toFixed(2)} m, heading ${m.pose.headingDeg.toFixed(0)} degrees, cell ${cellLabel(pointToCell(grid, m.pose.x, m.pose.y))}`).join('; ')}`}
        onClick={handleClick}
        className={onPick ? 'pickable' : undefined}
      >
        <rect x={0} y={0} width={w} height={h} className="grid-bg" />
        {highlightCell && (
          <rect x={highlightCell.col * cs} y={h - (highlightCell.row + 1) * cs} width={cs} height={cs} className="grid-cell-hi" />
        )}
        {Array.from({ length: grid.cols + 1 }, (_, c) => (
          <line key={`c${c}`} x1={c * cs} x2={c * cs} y1={0} y2={h} className={c % 5 === 0 ? 'grid-major' : 'grid-minor'} />
        ))}
        {Array.from({ length: grid.rows + 1 }, (_, r) => (
          <line key={`r${r}`} y1={h - r * cs} y2={h - r * cs} x1={0} x2={w} className={r % 5 === 0 ? 'grid-major' : 'grid-minor'} />
        ))}
        {showLabels && (
          <g className="grid-label">
            {Array.from({ length: grid.cols }, (_, c) => c % labelEvery === 0 && (
              <text key={`lc${c}`} x={c * cs + cs / 2} y={h + 16} textAnchor="middle">C{c}</text>
            ))}
            {Array.from({ length: grid.rows }, (_, r) => r % labelEvery === 0 && (
              <text key={`lr${r}`} x={-8} y={h - r * cs - cs / 2 + 4} textAnchor="end">R{r}</text>
            ))}
          </g>
        )}
        {/* Origin and axes */}
        <g className="axes">
          <circle cx={0} cy={h} r={4} />
          <line x1={0} y1={h} x2={Math.min(60, w)} y2={h} />
          <line x1={0} y1={h} x2={0} y2={Math.max(h - 60, 0)} />
          <text x={Math.min(64, w)} y={h - 4}>+X</text>
          <text x={4} y={Math.max(h - 62, 10)}>+Y</text>
        </g>

        {trails.map((t) => t.points.length > 1 && (
          <polyline
            key={t.id}
            className={`trail trail-${t.variant}`}
            points={t.points.map((p) => { const s = toSvg(p.x, p.y); return `${s.px.toFixed(1)},${s.py.toFixed(1)}`; }).join(' ')}
          />
        ))}

        {startPose && (() => {
          const s = toSvg(startPose.x, startPose.y);
          return (
            <g transform={`translate(${s.px} ${s.py}) rotate(${-startPose.headingDeg})`} className="start-marker">
              <circle r={9 * scale} />
              <line x1={0} y1={0} x2={16 * scale} y2={0} />
              <text x={0} y={-12 * scale} textAnchor="middle" transform={`rotate(${startPose.headingDeg})`}>start</text>
            </g>
          );
        })()}

        {pick && (() => {
          const s = toSvg(pick.x, pick.y);
          return (
            <g className="pick-marker" transform={`translate(${s.px} ${s.py})`}>
              <line x1={-8} x2={8} y1={0} y2={0} />
              <line y1={-8} y2={8} x1={0} x2={0} />
            </g>
          );
        })()}

        {markers.map((m) => {
          const s = toSvg(m.pose.x, m.pose.y);
          return (
            <g key={m.id} className={`robot robot-${m.variant}`} transform={`translate(${s.px} ${s.py}) rotate(${-m.pose.headingDeg})`}>
              {/* body: length along heading (+x local) */}
              <rect x={-robotL / 2} y={-robotW / 2} width={robotL} height={robotW} rx={6} className="robot-body" />
              <path d={`M${robotL / 2 + 10 * scale},0 L${robotL / 2 - 4},${-9 * scale} L${robotL / 2 - 4},${9 * scale} Z`} className="robot-heading" />
              <circle r={3} className="robot-center" />
            </g>
          );
        })}
      </svg>
      {pickHint && <div className="grid-hint">{pickHint}</div>}
    </div>
  );
}
