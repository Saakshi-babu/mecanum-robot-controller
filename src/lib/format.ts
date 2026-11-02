import type { Reading } from '../types/models';

export function fmtNum(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits);
}

export function fmtReading(r: Reading | null | undefined, digits = 2): string {
  if (!r || r.validity !== 'valid' || r.value === null) return 'N/A';
  return r.value.toFixed(digits);
}

export function fmtClock(ms: number | null | undefined, withMs = false): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const base = d.toLocaleTimeString([], { hour12: false });
  return withMs ? `${base}.${String(d.getMilliseconds()).padStart(3, '0')}` : base;
}

export function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export function fmtAgo(ms: number | null, now: number): string {
  if (ms === null) return 'never';
  const d = now - ms;
  if (d < 1000) return 'just now';
  return `${fmtDuration(d)} ago`;
}
