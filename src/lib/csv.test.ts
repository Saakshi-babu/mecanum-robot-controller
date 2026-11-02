import { describe, expect, it } from 'vitest';
import { csvEscape, toCsv } from './csv';

describe('csv', () => {
  it('escapes quotes, commas and newlines; empties null/NaN', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(NaN)).toBe('');
    expect(csvEscape(0)).toBe('0');
  });

  it('writes preamble, header and rows with CRLF', () => {
    const out = toCsv(['t', 'v_V'], [[1, 2.5], [2, null]], { mode: 'DEMO' });
    expect(out).toBe('# mode: DEMO\r\nt,v_V\r\n1,2.5\r\n2,\r\n');
  });
});
