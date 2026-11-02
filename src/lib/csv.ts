/** Minimal RFC 4180 CSV writer with a '#'-prefixed metadata preamble. */

export type CsvValue = string | number | boolean | null | undefined;

export function csvEscape(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && !Number.isFinite(v)) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvValue[][], meta: Record<string, string> = {}): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(meta)) lines.push(`# ${k}: ${v.replace(/[\r\n]+/g, ' ')}`);
  lines.push(header.map(csvEscape).join(','));
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function isoStamp(ms: number): string {
  return new Date(ms).toISOString();
}

export function fileStamp(ms = Date.now()): string {
  return new Date(ms).toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
