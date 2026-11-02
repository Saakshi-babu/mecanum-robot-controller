import type { GridConfig, Pose } from '../types/models';

/**
 * Grid coordinate conventions (used everywhere in the app):
 *  - Physical grid-frame coordinates in metres. Origin (0, 0) = bottom-left corner of the grid.
 *  - +X points right (increasing column), +Y points up (increasing row).
 *  - Cell indices are zero-based: col = floor(x / cellSize), row = floor(y / cellSize).
 *    Row 0 is the bottom row. Display label is "C{col}·R{row}".
 *  - A point exactly on the far edge (x == width) is assigned to the last column.
 *  - Heading in degrees, 0° = +X, counter-clockwise positive, normalised to (-180, 180].
 */

export const GRID_LIMITS = {
  rows: { min: 1, max: 50 },
  cols: { min: 1, max: 50 },
  cellSizeM: { min: 0.05, max: 5 },
} as const;

/** Tolerance (m) for boundary tests, absorbs floating-point error such as 6 × 0.3 = 1.7999999999999998. */
const EDGE_EPS = 1e-9;

export interface Cell {
  col: number;
  row: number;
}

export function gridWidthM(g: Pick<GridConfig, 'cols' | 'cellSizeM'>): number {
  return g.cols * g.cellSizeM;
}

export function gridHeightM(g: Pick<GridConfig, 'rows' | 'cellSizeM'>): number {
  return g.rows * g.cellSizeM;
}

export function normalizeHeading(deg: number): number {
  let h = ((deg % 360) + 360) % 360; // [0, 360)
  if (h > 180) h -= 360; // (-180, 180]
  return h === -0 ? 0 : h;
}

/** Shortest signed angular difference a - b, in (-180, 180]. */
export function headingDiff(a: number, b: number): number {
  return normalizeHeading(a - b);
}

export function isInsideGrid(g: GridConfig, x: number, y: number): boolean {
  return x >= -EDGE_EPS && y >= -EDGE_EPS && x <= gridWidthM(g) + EDGE_EPS && y <= gridHeightM(g) + EDGE_EPS;
}

/** Cell containing (x, y), or null if outside the grid. */
export function pointToCell(g: GridConfig, x: number, y: number): Cell | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !isInsideGrid(g, x, y)) return null;
  const col = Math.min(g.cols - 1, Math.max(0, Math.floor(x / g.cellSizeM + EDGE_EPS)));
  const row = Math.min(g.rows - 1, Math.max(0, Math.floor(y / g.cellSizeM + EDGE_EPS)));
  return { col, row };
}

/** Centre point of a cell in metres. */
export function cellCenter(g: GridConfig, cell: Cell): { x: number; y: number } {
  return { x: (cell.col + 0.5) * g.cellSizeM, y: (cell.row + 0.5) * g.cellSizeM };
}

export function cellLabel(cell: Cell | null): string {
  return cell ? `C${cell.col}·R${cell.row}` : '—';
}

/** Grid metres → SVG pixel coordinates (SVG y grows downward). */
export function worldToSvg(g: GridConfig, x: number, y: number, pxPerM: number): { px: number; py: number } {
  return { px: x * pxPerM, py: (gridHeightM(g) - y) * pxPerM };
}

/** SVG pixel coordinates → grid metres. */
export function svgToWorld(g: GridConfig, px: number, py: number, pxPerM: number): { x: number; y: number } {
  return { x: px / pxPerM, y: gridHeightM(g) - py / pxPerM };
}

/** Rotate a body-frame displacement (dx forward, dy left) into the grid frame for a given heading. */
export function bodyToGrid(dxBody: number, dyBody: number, headingDeg: number): { dx: number; dy: number } {
  const th = (headingDeg * Math.PI) / 180;
  return {
    dx: dxBody * Math.cos(th) - dyBody * Math.sin(th),
    dy: dxBody * Math.sin(th) + dyBody * Math.cos(th),
  };
}

export function clampToGrid(g: GridConfig, x: number, y: number): { x: number; y: number; clamped: boolean } {
  const cx = Math.min(Math.max(x, 0), gridWidthM(g));
  const cy = Math.min(Math.max(y, 0), gridHeightM(g));
  return { x: cx, y: cy, clamped: cx !== x || cy !== y };
}

export interface ValidationResult {
  ok: boolean;
  errors: Partial<Record<'rows' | 'cols' | 'cellSizeM' | 'x' | 'y' | 'headingDeg', string>>;
}

export function validateGridConfig(g: GridConfig): ValidationResult {
  const errors: ValidationResult['errors'] = {};
  const intIn = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (!intIn(g.rows, GRID_LIMITS.rows.min, GRID_LIMITS.rows.max))
    errors.rows = `Rows must be a whole number from ${GRID_LIMITS.rows.min} to ${GRID_LIMITS.rows.max}.`;
  if (!intIn(g.cols, GRID_LIMITS.cols.min, GRID_LIMITS.cols.max))
    errors.cols = `Columns must be a whole number from ${GRID_LIMITS.cols.min} to ${GRID_LIMITS.cols.max}.`;
  if (!(Number.isFinite(g.cellSizeM) && g.cellSizeM >= GRID_LIMITS.cellSizeM.min && g.cellSizeM <= GRID_LIMITS.cellSizeM.max))
    errors.cellSizeM = `Cell size must be ${GRID_LIMITS.cellSizeM.min}–${GRID_LIMITS.cellSizeM.max} m.`;
  if (!errors.cols && !errors.cellSizeM) {
    const w = gridWidthM(g);
    if (!(Number.isFinite(g.initialPose.x) && g.initialPose.x >= 0 && g.initialPose.x <= w + EDGE_EPS))
      errors.x = `Initial X must be within 0–${w.toFixed(2)} m.`;
  }
  if (!errors.rows && !errors.cellSizeM) {
    const h = gridHeightM(g);
    if (!(Number.isFinite(g.initialPose.y) && g.initialPose.y >= 0 && g.initialPose.y <= h + EDGE_EPS))
      errors.y = `Initial Y must be within 0–${h.toFixed(2)} m.`;
  }
  if (!(Number.isFinite(g.initialPose.headingDeg) && g.initialPose.headingDeg > -180 && g.initialPose.headingDeg <= 180))
    errors.headingDeg = 'Heading must be greater than -180° and at most 180°.';
  return { ok: Object.keys(errors).length === 0, errors };
}

export function poseDistance(a: Pose, b: Pose): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
