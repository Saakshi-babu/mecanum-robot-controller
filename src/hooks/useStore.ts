import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { RobotStore } from '../store/robotStore';

export const StoreContext = createContext<RobotStore | null>(null);

/** Access the store and re-render whenever it changes (batched to animation frames). */
export function useStore(): RobotStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreContext missing');
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

/** Re-render periodically so relative times ("3 s ago") stay fresh. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
