import { useElementWidth } from '../hooks/useElementWidth';
import type { HealthBucket } from '../lib/commStats';
import { fmtClock } from '../lib/format';
import { Empty } from './ui';

/** Stacked per-bucket counts of acked / timed-out / invalid messages. */
export function HealthChart({ buckets, bucketSec, height = 150 }: { buckets: HealthBucket[]; bucketSec: number; height?: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const pad = { l: 40, r: 10, t: 8, b: 24 };
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const max = Math.max(1, ...buckets.map((b) => b.acked + b.timeouts + b.invalid));
  const bw = iw / Math.max(1, buckets.length);
  const total = buckets.reduce((s, b) => s + b.acked + b.timeouts + b.invalid, 0);
  const yv = (v: number) => (v / max) * ih;
  const first = buckets[0]?.t;
  const last = buckets[buckets.length - 1]?.t;
  return (
    <div className="chart" ref={ref}>
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-box" style={{ background: 'var(--ok)' }} />Acked</span>
        <span className="legend-item"><span className="legend-box" style={{ background: 'var(--danger)' }} />Timeout</span>
        <span className="legend-item"><span className="legend-box" style={{ background: 'var(--warn)' }} />Invalid message</span>
        <span className="legend-unit">messages per {bucketSec} s</span>
      </div>
      <div className="chart-body" style={{ height }}>
        <svg width={width} height={height} role="img" aria-label="Communication health timeline">
          {[0, max].map((v) => (
            <g key={v}>
              <line className="grid-line" x1={pad.l} x2={pad.l + iw} y1={pad.t + ih - yv(v)} y2={pad.t + ih - yv(v)} />
              <text className="axis-text" x={pad.l - 6} y={pad.t + ih - yv(v) + 4} textAnchor="end">{v}</text>
            </g>
          ))}
          {buckets.map((b, k) => {
            const x0 = pad.l + k * bw + 0.5;
            const w = Math.max(1, bw - 1);
            let yy = pad.t + ih;
            const segs: [number, string][] = [[b.acked, 'var(--ok)'], [b.timeouts, 'var(--danger)'], [b.invalid, 'var(--warn)']];
            return (
              <g key={b.t}>
                {segs.map(([n, c], i) => {
                  if (!n) return null;
                  const h = yv(n);
                  yy -= h;
                  return <rect key={i} x={x0} y={yy} width={w} height={h} fill={c} opacity={0.85} />;
                })}
              </g>
            );
          })}
          <line className="axis-line" x1={pad.l} x2={pad.l + iw} y1={pad.t + ih} y2={pad.t + ih} />
          {first !== undefined && <text className="axis-text" x={pad.l} y={height - 6}>{fmtClock(first)}</text>}
          {last !== undefined && <text className="axis-text" x={pad.l + iw} y={height - 6} textAnchor="end">{fmtClock(last)}</text>}
        </svg>
        {total === 0 && <div className="chart-empty"><Empty title="No resolved messages in this window" /></div>}
      </div>
    </div>
  );
}
