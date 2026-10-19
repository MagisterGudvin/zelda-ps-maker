/** Geometry helpers shared by every subsystem. All boxes are center + half extents. */

export type Facing = "up" | "down" | "left" | "right";

export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned box described by its center and half extents (pixels). */
export interface AABB {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

export const FACINGS: readonly Facing[] = ["up", "down", "left", "right"];

export const FACING_VECTORS: Readonly<Record<Facing, Readonly<Vec2>>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function isFacing(value: unknown): value is Facing {
  return value === "up" || value === "down" || value === "left" || value === "right";
}

export function makeBox(x = 0, y = 0, hw = 0, hh = 0): AABB {
  return { x, y, hw, hh };
}

export function copyBox(out: AABB, src: AABB): AABB {
  out.x = src.x;
  out.y = src.y;
  out.hw = src.hw;
  out.hh = src.hh;
  return out;
}

export function overlaps(a: AABB, b: AABB): boolean {
  return Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh;
}

export function boxCircleOverlap(a: AABB, cx: number, cy: number, r: number): boolean {
  const nx = clamp(cx, a.x - a.hw, a.x + a.hw);
  const ny = clamp(cy, a.y - a.hh, a.y + a.hh);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/**
 * Minimum translation that moves `a` out of `b` (written into `out`).
 * Returns false when the boxes do not overlap.
 */
export function penetration(a: AABB, b: AABB, out: Vec2): boolean {
  const dx = a.x - b.x;
  const px = a.hw + b.hw - Math.abs(dx);
  if (px <= 0) return false;
  const dy = a.y - b.y;
  const py = a.hh + b.hh - Math.abs(dy);
  if (py <= 0) return false;
  if (px < py) {
    out.x = dx < 0 ? -px : px;
    out.y = 0;
  } else {
    out.x = 0;
    out.y = dy < 0 ? -py : py;
  }
  return true;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Normalizes (x, y) into `out`; a zero vector stays zero. */
export function normalize(out: Vec2, x: number, y: number): Vec2 {
  const len = Math.sqrt(x * x + y * y);
  if (len < 1e-9) {
    out.x = 0;
    out.y = 0;
  } else {
    out.x = x / len;
    out.y = y / len;
  }
  return out;
}

/**
 * Picks a 4-way facing from a movement vector. When moving diagonally the
 * current facing is kept if it matches one of the components (ALttP keeps the
 * facing while strafing diagonally).
 */
export function facingFromVector(dx: number, dy: number, current: Facing): Facing {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 1e-6 && ay < 1e-6) return current;
  if (ax > 1e-6 && ay > 1e-6) {
    if ((current === "left" && dx < 0) || (current === "right" && dx > 0)) return current;
    if ((current === "up" && dy < 0) || (current === "down" && dy > 0)) return current;
  }
  if (ax >= ay) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

export function oppositeFacing(f: Facing): Facing {
  switch (f) {
    case "up":
      return "down";
    case "down":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}

/**
 * True when something located at (srcX, srcY) is in front of an actor at
 * (x, y) facing `facing`. `minDot` is the cosine of the half-angle of the cone.
 */
export function isInFront(facing: Facing, x: number, y: number, srcX: number, srcY: number, minDot: number): boolean {
  const v = FACING_VECTORS[facing];
  const dx = srcX - x;
  const dy = srcY - y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return true;
  return (v.x * dx + v.y * dy) / len >= minDot;
}

/** Moves `value` toward `target` by at most `step`. */
export function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(value + step, target);
  if (value > target) return Math.max(value - step, target);
  return value;
}
