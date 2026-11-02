import { describe, expect, it } from 'vitest';
import { bodyToGrid, cellCenter, cellLabel, headingDiff, normalizeHeading, pointToCell, svgToWorld, validateGridConfig, worldToSvg } from './grid';
import type { GridConfig } from '../types/models';

const g: GridConfig = { rows: 6, cols: 8, cellSizeM: 0.3, initialPose: { x: 0.45, y: 0.45, headingDeg: 0 } };

describe('grid coordinates', () => {
  it('maps points to zero-based cells with row 0 at the bottom', () => {
    expect(pointToCell(g, 0, 0)).toEqual({ col: 0, row: 0 });
    expect(pointToCell(g, 0.45, 0.45)).toEqual({ col: 1, row: 1 });
    expect(pointToCell(g, 0.2999, 0.3)).toEqual({ col: 0, row: 1 });
    expect(pointToCell(g, 0.6, 0.9)).toEqual({ col: 2, row: 3 }); // exact cell boundaries despite float error
    expect(pointToCell(g, 2.4, 1.8)).toEqual({ col: 7, row: 5 }); // far edge → last cell
    expect(pointToCell(g, 2.41, 1)).toBeNull();
    expect(pointToCell(g, -0.01, 1)).toBeNull();
    expect(pointToCell(g, NaN, 1)).toBeNull();
  });

  it('cell centre round-trips to the same cell', () => {
    for (let col = 0; col < g.cols; col++)
      for (let row = 0; row < g.rows; row++) {
        const c = cellCenter(g, { col, row });
        expect(pointToCell(g, c.x, c.y)).toEqual({ col, row });
      }
    expect(cellLabel({ col: 3, row: 2 })).toBe('C3·R2');
  });

  it('world ↔ SVG conversion flips Y and round-trips', () => {
    const a = worldToSvg(g, 0, 0, 100);
    expect(a.px).toBeCloseTo(0);
    expect(a.py).toBeCloseTo(180);
    const b = worldToSvg(g, 2.4, 1.8, 100);
    expect(b.px).toBeCloseTo(240);
    expect(b.py).toBeCloseTo(0);
    const w = svgToWorld(g, 123, 45, 100);
    const back = worldToSvg(g, w.x, w.y, 100);
    expect(back.px).toBeCloseTo(123);
    expect(back.py).toBeCloseTo(45);
  });
});

describe('heading', () => {
  it('normalises to (-180, 180]', () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(180)).toBe(180);
    expect(normalizeHeading(-180)).toBe(180);
    expect(normalizeHeading(270)).toBe(-90);
    expect(normalizeHeading(-450)).toBe(-90);
    expect(normalizeHeading(720)).toBe(0);
  });

  it('computes shortest signed difference', () => {
    expect(headingDiff(170, -170)).toBe(-20);
    expect(headingDiff(-170, 170)).toBe(20);
  });

  it('rotates body displacement into grid frame', () => {
    const f = bodyToGrid(1, 0, 90); // forward while facing +Y
    expect(f.dx).toBeCloseTo(0);
    expect(f.dy).toBeCloseTo(1);
    const l = bodyToGrid(0, 1, 0); // strafe left while facing +X → +Y
    expect(l.dx).toBeCloseTo(0);
    expect(l.dy).toBeCloseTo(1);
  });
});

describe('validateGridConfig', () => {
  it('accepts a valid config', () => expect(validateGridConfig(g).ok).toBe(true));
  it('rejects bad dimensions and out-of-grid initial pose', () => {
    const v = validateGridConfig({ rows: 0, cols: 2.5, cellSizeM: 0.01, initialPose: { x: 1, y: 1, headingDeg: 200 } });
    expect(v.ok).toBe(false);
    expect(Object.keys(v.errors).sort()).toEqual(['cellSizeM', 'cols', 'headingDeg', 'rows']);
    const v2 = validateGridConfig({ ...g, initialPose: { x: 3, y: -1, headingDeg: 0 } });
    expect(v2.errors.x).toBeDefined();
    expect(v2.errors.y).toBeDefined();
  });
});
