import { useState } from 'react';
import { useNow, useStore } from '../hooks/useStore';
import { Badge, Card, Segmented } from '../components/ui';
import { fmtClock } from '../lib/format';
import { downloadText, fileStamp } from '../lib/csv';
import { eventsCsv } from '../store/exports';
import type { EventCategory, EventSource, Severity } from '../types/models';

const CATEGORIES: EventCategory[] = ['command', 'stop', 'connection', 'comm_error', 'telemetry', 'localization', 'config', 'system'];
const SOURCES: EventSource[] = ['ui', 'simulator', 'esp32', 'localization', 'app'];
const TIME_WINDOWS = [
  { value: 60_000, label: '1 min' },
  { value: 300_000, label: '5 min' },
  { value: 900_000, label: '15 min' },
  { value: 3_600_000, label: '1 h' },
  { value: 0, label: 'All' },
];

export function Events() {
  const store = useStore();
  const now = useNow(1000);
  const [cats, setCats] = useState<Set<EventCategory>>(new Set(CATEGORIES));
  const [minSev, setMinSev] = useState<Severity>('info');
  const [source, setSource] = useState<EventSource | 'all'>('all');
  const [windowMs, setWindowMs] = useState(0);
  const [query, setQuery] = useState('');

  const all = store.events.toArray();
  const rank: Record<Severity, number> = { info: 0, warning: 1, error: 2 };
  const q = query.trim().toLowerCase();
  const filtered = all.filter((e) =>
      cats.has(e.category) &&
      rank[e.severity] >= rank[minSev] &&
      (source === 'all' || e.source === source) &&
      (windowMs === 0 || e.timestamp >= now - windowMs) &&
      (!q || e.message.toLowerCase().includes(q)),
  ).reverse();

  const toggle = (c: EventCategory) => {
    const next = new Set(cats);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setCats(next);
  };

  return (
    <div className="page">
      <Card
        title="Filters"
        actions={
          <>
            <button type="button" className="btn" disabled={filtered.length === 0} onClick={() => downloadText(`events_${store.sourceKind}_${fileStamp()}.csv`, eventsCsv(store, [...filtered].reverse()))}>
              Export {filtered.length} events (CSV)
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { if (confirm('Clear all events from this session? This cannot be undone.')) store.clearEvents(); }}>Clear</button>
          </>
        }
      >
        <div className="filters">
          <div className="field">
            <label>Category</label>
            <div className="chips">
              {CATEGORIES.map((c) => (
                <button key={c} type="button" className={`chip ${cats.has(c) ? 'on' : ''}`} aria-pressed={cats.has(c)} onClick={() => toggle(c)}>{c.replace('_', ' ')}</button>
              ))}
              <button type="button" className="chip ghost" onClick={() => setCats(new Set(cats.size === CATEGORIES.length ? [] : CATEGORIES))}>{cats.size === CATEGORIES.length ? 'none' : 'all'}</button>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Minimum severity</label>
              <Segmented label="Minimum severity" value={minSev} onChange={setMinSev} options={[{ value: 'info', label: 'Info' }, { value: 'warning', label: 'Warning' }, { value: 'error', label: 'Error' }]} />
            </div>
            <div className="field">
              <label>Time window</label>
              <Segmented label="Time window" value={windowMs} onChange={setWindowMs} options={TIME_WINDOWS} />
            </div>
            <div className="field">
              <label htmlFor="ev-src">Source</label>
              <select id="ev-src" value={source} onChange={(e) => setSource(e.target.value as EventSource | 'all')}>
                <option value="all">All sources</option>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field grow">
              <label htmlFor="ev-q">Search</label>
              <input id="ev-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by text…" />
            </div>
          </div>
        </div>
      </Card>

      <Card title={`Events (${filtered.length} of ${all.length})`} subtitle="Newest first. Stored in memory for this session only (max 3000).">
        {filtered.length === 0 ? (
          <p className="muted">No events match these filters.</p>
        ) : (
          <div className="table-scroll tall">
            <table className="table events-table">
              <thead><tr><th>Time</th><th>Severity</th><th>Category</th><th>Source</th><th>Data</th><th>Description</th></tr></thead>
              <tbody>
                {filtered.slice(0, 500).map((e) => (
                  <tr key={e.id} className={`sev-${e.severity}`}>
                    <td className="mono nowrap">{fmtClock(e.timestamp, true)}</td>
                    <td><Badge tone={e.severity === 'error' ? 'danger' : e.severity === 'warning' ? 'warn' : 'muted'}>{e.severity}</Badge></td>
                    <td>{e.category.replace('_', ' ')}</td>
                    <td>{e.source}</td>
                    <td>{e.simulated ? <Badge tone="warn">SIM</Badge> : <Badge tone="muted">real</Badge>}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 500 && <p className="fine">Showing the newest 500. The export includes all {filtered.length}.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
