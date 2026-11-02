import { describe, expect, it } from 'vitest';
import { encodeCommand, parseMessage } from './protocol';

describe('draft protocol', () => {
  it('encodes commands', () => {
    expect(JSON.parse(encodeCommand({ seq: 3, direction: 'forward_left', speedPct: 42.4, issuedAt: 0, origin: 'button', heartbeat: false })))
      .toEqual({ type: 'cmd', seq: 3, dir: 'forward_left', speed: 42, hb: false });
  });

  it('parses acks and rejects bad seq', () => {
    expect(parseMessage('{"type":"ack","seq":5,"proc_us":250}', 100)).toEqual({ type: 'ack', ack: { seq: 5, receivedAt: 100, deviceProcessingMs: 0.25, source: 'esp32' } });
    expect(parseMessage('{"type":"ack","seq":"5"}', 0).type).toBe('invalid');
    expect(parseMessage('not json', 0).type).toBe('invalid');
    expect(parseMessage('{"type":"bogus"}', 0).type).toBe('invalid');
  });

  it('marks absent telemetry fields missing and bad ones invalid', () => {
    const m = parseMessage('{"type":"telemetry","v":11.8,"i":"x"}', 50);
    expect(m.type).toBe('telemetry');
    if (m.type !== 'telemetry') return;
    expect(m.frame.voltage).toMatchObject({ value: 11.8, validity: 'valid', source: 'esp32' });
    expect(m.frame.current).toMatchObject({ value: null, validity: 'invalid' });
    expect(m.frame.wheels).toBeNull();
  });

  it('parses per-wheel encoder data', () => {
    const m = parseMessage('{"type":"telemetry","wheels":{"FL":{"ticks":10,"rpm":5},"FR":{"ticks":11}}}', 0);
    if (m.type !== 'telemetry') throw new Error('expected telemetry');
    const fl = m.frame.wheels!.find((w) => w.wheel === 'FL')!;
    const rr = m.frame.wheels!.find((w) => w.wheel === 'RR')!;
    expect(fl.encoderTicks.value).toBe(10);
    expect(m.frame.wheels!.find((w) => w.wheel === 'FR')!.rpm.validity).toBe('missing');
    expect(rr.encoderTicks.validity).toBe('missing');
  });
});
