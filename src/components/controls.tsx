import type { Direction, WheelId } from '../types/models';
import { DIRECTION_LABELS, wheelCommandPct } from '../lib/kinematics';
import type { RobotStore } from '../store/robotStore';
import { useStore } from '../hooks/useStore';

const PAD_LAYOUT: (Direction | null)[] = [
  'forward_left', 'forward', 'forward_right',
  'left', 'stop', 'right',
  'backward_left', 'backward', 'backward_right',
];

/** Arrow rotation (deg, clockwise from up) for each translation direction. */
const ARROW_DEG: Partial<Record<Direction, number>> = {
  forward: 0, forward_right: 45, right: 90, backward_right: 135, backward: 180, backward_left: 225, left: 270, forward_left: 315,
};

const KEY_HINT: Partial<Record<Direction, string>> = {
  forward: 'W', backward: 'S', left: 'A', right: 'D', forward_left: 'W+A', forward_right: 'W+D', backward_left: 'S+A', backward_right: 'S+D',
  stop: 'Space', rotate_ccw: 'Q', rotate_cw: 'E',
};

function Arrow({ deg }: { deg: number }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden style={{ transform: `rotate(${deg}deg)` }}>
      <path d="M12 3 L19 12 H14.5 V21 H9.5 V12 H5 Z" fill="currentColor" />
    </svg>
  );
}

function RotIcon({ ccw }: { ccw: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden style={{ transform: ccw ? 'scaleX(-1)' : undefined }}>
      <path d="M12 4a8 8 0 1 1-7.6 5.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M3 4 L4.6 10 L10 7.5 Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Hold-to-move button. Pointer capture guarantees we get the release even if the pointer
 * leaves the button; lost capture / cancel also stop.
 */
function HoldButton({ store, direction, children, className }: { store: RobotStore; direction: Direction; children: React.ReactNode; className?: string }) {
  const active = store.control.direction === direction;
  const release = () => {
    if (store.control.direction === direction && store.control.origin === 'button') store.setDirection('stop', 'button');
  };
  return (
    <button
      type="button"
      className={`pad-btn ${className ?? ''} ${active ? 'active' : ''}`}
      aria-pressed={active}
      aria-label={`${DIRECTION_LABELS[direction]} (hold) — key ${KEY_HINT[direction]}`}
      disabled={store.control.latched}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        store.setDirection(direction, 'button');
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          store.setDirection(direction, 'button');
        }
      }}
      onKeyUp={(e) => {
        if (e.key === 'Enter' || e.key === ' ') release();
      }}
      onBlur={release}
    >
      {children}
      <span className="pad-key">{KEY_HINT[direction]}</span>
    </button>
  );
}

export function DirectionPad({ compact = false }: { compact?: boolean }) {
  const store = useStore();
  const rotation = store.settings.controller.enableRotation;
  return (
    <div className={`pad-wrap ${compact ? 'compact' : ''}`}>
      <div className="pad-section-label">Translation (holonomic — heading unchanged)</div>
      <div className="pad" role="group" aria-label="Translation controls">
        {PAD_LAYOUT.map((d) =>
          d === 'stop' ? (
            <button
              key="stop"
              type="button"
              className={`pad-btn pad-stop ${store.control.direction === 'stop' ? 'active' : ''}`}
              onClick={() => store.stop('stop_button')}
              aria-label="Stop (Space)"
            >
              <span className="pad-stop-square" aria-hidden />
              <span className="pad-key">Space</span>
            </button>
          ) : (
            d && (
              <HoldButton key={d} store={store} direction={d}>
                <Arrow deg={ARROW_DEG[d] ?? 0} />
              </HoldButton>
            )
          ),
        )}
      </div>
      {rotation && (
        <>
          <div className="pad-section-label">Rotation (in place — position unchanged)</div>
          <div className="pad-rot" role="group" aria-label="Rotation controls">
            <HoldButton store={store} direction="rotate_ccw" className="rot">
              <RotIcon ccw /> <span className="rot-label">CCW</span>
            </HoldButton>
            <HoldButton store={store} direction="rotate_cw" className="rot">
              <RotIcon ccw={false} /> <span className="rot-label">CW</span>
            </HoldButton>
          </div>
        </>
      )}
    </div>
  );
}

export function EmergencyStop({ size = 'large' }: { size?: 'large' | 'small' }) {
  const store = useStore();
  const latched = store.control.latched;
  if (size === 'small') {
    return latched ? (
      <button type="button" className="estop-sm latched" onClick={() => store.releaseLatch()} title="UI stop is latched — click to release">
        STOP LATCHED · Release
      </button>
    ) : (
      <button type="button" className="estop-sm" onClick={() => store.emergencyStop()} title="Software stop: sends STOP and blocks further motion commands (Esc)">
        STOP
      </button>
    );
  }
  return (
    <div className={`estop-block ${latched ? 'latched' : ''}`}>
      <button type="button" className="estop" onClick={() => store.emergencyStop()} aria-label="UI emergency stop (Esc)">
        <span>STOP</span>
        <small>Esc</small>
      </button>
      <div className="estop-text">
        {latched ? (
          <>
            <strong>UI stop latched.</strong> Motion commands are blocked.
            <button type="button" className="btn btn-ghost" onClick={() => store.releaseLatch()}>Release latch</button>
          </>
        ) : (
          <>Sends STOP immediately and latches the UI until released.</>
        )}
        <p className="fine">
          Software-only stop. This is <strong>not</strong> a verified physical emergency stop: it depends on the link and firmware.
          The real robot needs a hardware cut-off and a firmware watchdog.
        </p>
      </div>
    </div>
  );
}

const WHEEL_POS: Record<WheelId, { x: number; y: number }> = { FL: { x: 46, y: 30 }, FR: { x: 114, y: 30 }, RL: { x: 46, y: 110 }, RR: { x: 114, y: 110 } };

/** Top-down robot with each wheel's commanded % (from inverse kinematics). Not measured feedback. */
export function WheelDiagram({ direction, speedPct }: { direction: Direction; speedPct: number }) {
  const w = wheelCommandPct(direction, speedPct);
  return (
    <svg viewBox="0 0 160 140" className="wheel-diagram" role="img" aria-label="Commanded wheel speeds">
      <rect x="56" y="14" width="48" height="112" rx="8" className="chassis" />
      <path d="M80 22 L88 34 H72 Z" className="chassis-front" />
      <text x="80" y="74" textAnchor="middle" className="wheel-label">FRONT ↑</text>
      {(Object.keys(WHEEL_POS) as WheelId[]).map((id) => {
        const p = WHEEL_POS[id];
        const v = w[id];
        const tone = v > 0.5 ? 'fwd' : v < -0.5 ? 'rev' : 'idle';
        const left = id === 'FL' || id === 'RL';
        return (
          <g key={id}>
            <rect x={p.x - 8} y={p.y - 15} width="16" height="30" rx="3" className={`wheel ${tone}`} />
            {/* roller hint: X pattern */}
            <line x1={p.x - 5} y1={id === 'FL' || id === 'RR' ? p.y + 9 : p.y - 9} x2={p.x + 5} y2={id === 'FL' || id === 'RR' ? p.y - 9 : p.y + 9} className="roller" />
            <text x={left ? p.x - 12 : p.x + 12} y={p.y - 3} textAnchor={left ? 'end' : 'start'} className="wheel-label">{id}</text>
            <text x={left ? p.x - 12 : p.x + 12} y={p.y + 9} textAnchor={left ? 'end' : 'start'} className={`wheel-label wheel-val ${tone}`}>{v > 0.5 ? '+' : ''}{v.toFixed(0)}%</text>
          </g>
        );
      })}
    </svg>
  );
}
