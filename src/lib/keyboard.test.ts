import { describe, expect, it } from 'vitest';
import { resolveKeys } from './keyboard';

const r = (keys: string, rot = true) => resolveKeys(new Set(keys.split('')), rot);

describe('resolveKeys', () => {
  it('maps single keys and diagonals', () => {
    expect(r('').direction).toBe('stop');
    expect(r('w').direction).toBe('forward');
    expect(r('s').direction).toBe('backward');
    expect(r('a').direction).toBe('left');
    expect(r('d').direction).toBe('right');
    expect(r('wa').direction).toBe('forward_left');
    expect(r('wd').direction).toBe('forward_right');
    expect(r('sa').direction).toBe('backward_left');
    expect(r('sd').direction).toBe('backward_right');
    expect(r('q').direction).toBe('rotate_ccw');
    expect(r('e').direction).toBe('rotate_cw');
  });

  it('cancels opposing keys and flags a conflict', () => {
    expect(r('ws')).toMatchObject({ direction: 'stop', conflict: true });
    expect(r('ad')).toMatchObject({ direction: 'stop', conflict: true });
    expect(r('wsa')).toMatchObject({ direction: 'left', conflict: true });
    expect(r('qe')).toMatchObject({ direction: 'stop', conflict: true });
  });

  it('never blends translation with rotation', () => {
    expect(r('wq')).toMatchObject({ direction: 'stop', conflict: true });
    expect(r('de')).toMatchObject({ direction: 'stop', conflict: true });
  });

  it('ignores rotation keys when rotation is disabled', () => {
    expect(r('q', false).direction).toBe('stop');
    expect(r('wq', false).direction).toBe('forward');
  });
});
