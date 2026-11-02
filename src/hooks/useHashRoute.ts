import { useEffect, useState } from 'react';

export const ROUTES = ['overview', 'controller', 'dashboard', 'localization', 'events', 'settings'] as const;
export type Route = (typeof ROUTES)[number];

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(h) ? (h as Route) : 'overview';
}

/** Minimal hash router (#/dashboard) — works when served from any static host or the ESP32 itself. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
