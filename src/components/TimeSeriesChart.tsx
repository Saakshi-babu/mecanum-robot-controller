import { useMemo, useState } from 'react';
import { useElementWidth } from '../hooks/useElementWidth';
import { fmtClock } from '../lib/format';
import { Empty } from './ui';

export interface Series {
  id: string;
  label: string;
  color: string;
  points: { t: number; v: number | null }[];
  dashed?: boolean;
}

interface Props {
  series: Series[];
  /** Window start/end (ms epoch). */
  t0: number;
  t1: number;
  unit: string;
  yLabel: string;
  height?: number;
  /** Force the y-axis to include these bounds. */
  yMin?: number;
  yMax?: number;
  /** Points further apart than this are not connected (shows gaps instead of interpolating). */
  maxGapMs?: number;
  emptyTitle?: string;
  emptyBody?: string;
  digits?: number;
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  // First tick at or below lo, last tick at or above hi, so no data falls outside the axis.
  const first = Math.floor(lo / step);
  const last = Math.max(first + 1, Math.ceil(hi / step));
  const out: number[] = [];
  for (let k = first; k <= last; k++) out.push(Number((k * step).toPrecision(12)));
  return out;
}

const PAD = { l: 52, r: 12, t: 10, b: 26 };

export function TimeSeriesChart({ series, t0, t1, unit, yLabel, height = 200, yMin, yMax, maxGapMs = 1500, emptyTitle = 'No data in this window', emptyBody, digits = 1 }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hoverT, setHoverT] = useState<number | null>(null);

  const visible = useMemo(
    () => series.map((s) => ({ ...s, points: s.points.filter((p) => p.t >= t0 && p.t <= t1) })),
    [series, t0, t1],
  );
  const values = visible.flatMap((s) => s.points.map((p) => p.v).filter((v): v is number => v !== null && Number.isFinite(v)));
  const hasData = values.length > 0;

  let lo = hasData ? Math.min(...values) : 0;
  let hi = hasData ? Math.max(...values) : 1;
  if (yMin !== undefined) lo = Math.min(lo, yMin);
  if (yMax !== undefined) hi = Math.max(hi, yMax);
  const yTicks = niceTicks(lo, hi);
  lo = yTicks[0];
  hi = yTicks[yTicks.length - 1];

  const iw = Math.max(10, width - PAD.l - PAD.r);
  const ih = height - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih;

  const xTickCount = width < 420 ? 3 : 5;
  const xTicks = Array.from({ length: xTickCount }, (_, k) => t0 + ((t1 - t0) * k) / (xTickCount - 1));

  const paths = visible.map((s) => {
    let d = '';
    let prev: { t: number; v: number | null } | null = null;
    for (const p of s.points) {
      if (p.v === null || !Number.isFinite(p.v)) {
        prev = null;
        continue;
      }
      const connect = prev && prev.v !== null && p.t - prev.t <= maxGapMs;
      d += `${connect ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
      prev = p;
    }
    return { s, d };
  });

  const hover = hoverT === null ? null : visible.map((s) => {
    let best: { t: number; v: number | null } | null = null;
    for (const p of s.points) if (!best || Math.abs(p.t - hoverT) < Math.abs(best.t - hoverT)) best = p;
    return { s, p: best && Math.abs(best.t - hoverT) < maxGapMs ? best : null };
  });

  return (
    <div className="chart" ref={ref}>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.id} className="legend-item">
            <span className={`legend-swatch ${s.dashed ? 'dashed' : ''}`} style={{ borderColor: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="legend-unit">{yLabel} ({unit})</span>
      </div>
      <div className="chart-body" style={{ height }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${yLabel} in ${unit} over time`}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - r.left;
            if (px < PAD.l || px > PAD.l + iw) return setHoverT(null);
            setHoverT(t0 + ((px - PAD.l) / iw) * (t1 - t0));
          }}
          onPointerLeave={() => setHoverT(null)}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line className="grid-line" x1={PAD.l} x2={PAD.l + iw} y1={y(v)} y2={y(v)} />
              <text className="axis-text" x={PAD.l - 6} y={y(v) + 4} textAnchor="end">{Number(v.toFixed(3))}</text>
            </g>
          ))}
          {xTicks.map((t, k) => (
            <text key={k} className="axis-text" x={x(t)} y={height - 6} textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'}>
              {fmtClock(t)}
            </text>
          ))}
          <line className="axis-line" x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + ih} />
          <line className="axis-line" x1={PAD.l} x2={PAD.l + iw} y1={PAD.t + ih} y2={PAD.t + ih} />
          {paths.map(({ s, d }) => (
            <path key={s.id} d={d} fill="none" stroke={s.color} strokeWidth={1.75} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
          ))}
          {hoverT !== null && hover && (
            <g pointerEvents="none">
              <line className="hover-line" x1={x(hoverT)} x2={x(hoverT)} y1={PAD.t} y2={PAD.t + ih} />
              {hover.map(({ s, p }) => p && p.v !== null && <circle key={s.id} cx={x(p.t)} cy={y(p.v)} r={3.5} fill={s.color} />)}
            </g>
          )}
        </svg>
        {!hasData && (
          <div className="chart-empty">
            <Empty title={emptyTitle}>{emptyBody}</Empty>
          </div>
        )}
        {hoverT !== null && hover && hasData && (
          <div className="chart-tip" style={{ left: Math.min(x(hoverT) + 8, width - 170) }}>
            <div className="mono">{fmtClock(hoverT, true)}</div>
            {hover.map(({ s, p }) => (
              <div key={s.id}>
                <span style={{ color: s.color }}>●</span> {s.label}: <span className="mono">{p && p.v !== null ? `${p.v.toFixed(digits)} ${unit}` : 'no data'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
