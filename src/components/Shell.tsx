import { useState, type ReactNode } from 'react';
import { useNow, useStore } from '../hooks/useStore';
import type { Route } from '../hooks/useHashRoute';
import { DIRECTION_LABELS } from '../lib/kinematics';
import { fmtDuration } from '../lib/format';
import type { ConnectionState } from '../types/models';
import { EmergencyStop } from './controls';

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: 'overview', label: 'Overview', icon: 'M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z' },
  { route: 'controller', label: 'Robot Controller', icon: 'M12 2l3 4h-2v4h4V8l4 4-4 4v-2h-4v4h2l-3 4-3-4h2v-4H7v2l-4-4 4-4v2h4V6H9z' },
  { route: 'dashboard', label: 'Live Dashboard', icon: 'M3 3v18h18v-2H5V3zm4 12l4-5 3 3 5-7 1.6 1.2L14 16l-3-3-2.4 3z' },
  { route: 'localization', label: 'Grid Localization', icon: 'M3 3h18v18H3zm2 2v4h4V5zm6 0v4h4V5zm6 0v4h2V5zM5 11v4h4v-4zm6 0v4h4v-4zm6 0v4h2v-4zM5 17v2h4v-2zm6 0v2h4v-2zm6 0v2h2v-2z' },
  { route: 'events', label: 'Event Logs', icon: 'M4 5h16v2H4zm0 6h16v2H4zm0 6h10v2H4z' },
  { route: 'settings', label: 'Settings', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.9 5l2-1.6-2-3.4-2.4.8a7 7 0 00-1.8-1L16.2 5h-4l-.5 2.6a7 7 0 00-1.8 1l-2.4-.8-2 3.4 2 1.6a7 7 0 000 2l-2 1.6 2 3.4 2.4-.8a7 7 0 001.8 1l.5 2.6h4l.5-2.6a7 7 0 001.8-1l2.4.8 2-3.4-2-1.6a7 7 0 000-2z' },
];

export const CONN_LABEL: Record<ConnectionState, string> = {
  demo: 'Demo (simulated link)',
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
};

export function ConnectionPill() {
  const store = useStore();
  const s = store.conn.state;
  return (
    <span className={`conn-pill conn-${s}`} title={store.conn.detail}>
      <span className="conn-dot" />
      {CONN_LABEL[s]}
    </span>
  );
}

export function Shell({ route, keysHeld, children }: { route: Route; keysHeld: ReadonlySet<string>; children: ReactNode }) {
  const store = useStore();
  const now = useNow(1000);
  const [open, setOpen] = useState(false);
  const c = store.control;
  const moving = c.direction !== 'stop';
  return (
    <div className={`app ${store.settings.display.reducedMotion ? 'reduce-motion' : ''}`}>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
            <rect x="7" y="5" width="18" height="22" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
            {[[3, 7], [25, 7], [3, 19], [25, 19]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="4" height="7" rx="1" fill="currentColor" />)}
          </svg>
          <div>
            <div className="brand-name">Mecanum Control</div>
            <div className="brand-sub">ESP32 · v0.1</div>
          </div>
        </div>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <a key={n.route} href={`#/${n.route}`} className={`nav-item ${route === n.route ? 'active' : ''}`} aria-current={route === n.route ? 'page' : undefined} onClick={() => setOpen(false)}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d={n.icon} fill="currentColor" /></svg>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          {store.isDemo ? (
            <div className="demo-note">
              <span className="demo-badge">DEMO MODE</span>
              <p>All telemetry, latency and positions are produced by the simulator. No robot is connected.</p>
            </div>
          ) : (
            <div className="demo-note hw">
              <span className="badge tone-ok">ESP32 MODE</span>
              <p>Only data received from the ESP32 is shown. Missing fields show N/A.</p>
            </div>
          )}
          <div className="fine">Session {fmtDuration(now - store.sessionStartedAt)}</div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main-col">
        <header className="topbar">
          <button type="button" className="menu-btn" aria-label="Open navigation" onClick={() => setOpen(true)}>
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z" fill="currentColor" /></svg>
          </button>
          <h1 className="page-title">{NAV.find((n) => n.route === route)?.label}</h1>
          <div className="topbar-status">
            {store.isDemo && <span className="demo-badge" title="Simulated data source active">DEMO</span>}
            <ConnectionPill />
            <span className={`cmd-chip ${moving ? 'moving' : ''}`} title="Current UI command">
              {DIRECTION_LABELS[c.direction]}
              {moving && <span className="mono"> · {c.speedPct}%</span>}
            </span>
            {keysHeld.size > 0 && <span className="keys-chip mono" title="Keys held">{[...keysHeld].join('+').toUpperCase()}</span>}
          </div>
          <EmergencyStop size="small" />
        </header>
        {c.latched && (
          <div className="banner danger" role="alert">
            UI emergency stop is latched — motion commands are blocked.
            <button type="button" className="btn btn-ghost" onClick={() => store.releaseLatch()}>Release</button>
          </div>
        )}
        {!store.isDemo && store.conn.state !== 'connected' && (
          <div className="banner warn" role="status">
            ESP32 not connected ({CONN_LABEL[store.conn.state]}{store.conn.detail ? `: ${store.conn.detail}` : ''}). Controls and telemetry are unavailable until the firmware responds.
          </div>
        )}
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
