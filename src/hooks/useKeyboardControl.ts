import { useEffect, useRef, useState } from 'react';
import type { RobotStore } from '../store/robotStore';
import { isMovementKey, isTypingTarget, resolveKeys } from '../lib/keyboard';

/**
 * Global keyboard driving.
 *  - W/A/S/D translate (diagonals by combination), Q/E rotate, Space = stop, Esc = UI emergency stop.
 *  - Ignored while typing in a text field, and when Ctrl/Cmd/Alt is held (browser shortcuts).
 *  - Auto-repeat keydown events are ignored; state is derived from the set of held keys.
 *  - Window blur / tab hidden → all keys released and the robot is stopped (keyup would be lost).
 */
export function useKeyboardControl(store: RobotStore): ReadonlySet<string> {
  const held = useRef(new Set<string>());
  const [snapshot, setSnapshot] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const apply = () => {
      setSnapshot(new Set(held.current));
      const res = resolveKeys(held.current, store.settings.controller.enableRotation);
      if (res.direction === 'stop') {
        // Only stop if the keyboard owns the current motion (don't cancel a held on-screen button).
        if (store.control.origin === 'keyboard' && store.control.direction !== 'stop') store.setDirection('stop', 'keyboard', res.conflict ? res.reason ?? null : null);
        else if (res.conflict) store.setDirection('stop', 'keyboard', res.reason ?? null);
      } else {
        store.setDirection(res.direction, 'keyboard', res.conflict ? res.reason ?? null : null);
      }
    };
    const releaseAll = (why: string) => {
      if (held.current.size === 0) return;
      held.current.clear();
      setSnapshot(new Set());
      if (store.control.origin === 'keyboard' && store.control.direction !== 'stop') {
        store.stop('safety');
        store.log('stop', 'warning', 'ui', `Keyboard released (${why}) — stopped`);
      }
    };
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'spacebar') {
        // Let Space activate a focused button normally; otherwise Space = stop.
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tag === 'button' || tag === 'a') return;
        e.preventDefault();
        held.current.clear();
        setSnapshot(new Set());
        store.stop('stop_button');
        return;
      }
      if (k === 'escape') {
        e.preventDefault();
        held.current.clear();
        setSnapshot(new Set());
        store.emergencyStop();
        return;
      }
      if (!isMovementKey(k)) return;
      e.preventDefault();
      if (e.repeat && held.current.has(k)) return;
      held.current.add(k);
      apply();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!held.current.has(k)) return;
      held.current.delete(k);
      apply();
    };
    // macOS swallows keyup for keys pressed while Meta is held — treat Meta keydown as release-all.
    const meta = (e: KeyboardEvent) => {
      if (e.key === 'Meta') releaseAll('modifier pressed');
    };
    const blur = () => releaseAll('window lost focus');
    const vis = () => {
      if (document.hidden) releaseAll('tab hidden');
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keydown', meta);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keydown', meta);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [store]);

  return snapshot;
}
