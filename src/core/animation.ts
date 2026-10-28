import type { Facing } from "./math.ts";

/**
 * Sprite-sheet animations defined by authors (e.g. Mana Seed character and
 * weapon sheets). Frame numbers count left-to-right, top-to-bottom from 0;
 * `Zelda: Preview Sprite Sheet` shows them over the sheet in the game.
 */
export interface SheetDef {
  /** Texture key already loaded in PS Maker, or an image URL / data URI. */
  image: string;
  frameWidth: number;
  frameHeight: number;
  margin?: number;
  spacing?: number;
}

export interface AnimDef {
  sheet: string;
  /** One list for every direction, or a list per direction. */
  frames: number[] | Partial<Record<Facing, number[]>>;
  /** Frames per second; without it the animation is stretched over the action (attack swing). */
  fps?: number;
  loop?: boolean;
  /** Force horizontal mirroring per direction (left is mirrored from right automatically when missing). */
  flipX?: Partial<Record<Facing, boolean>>;
}

export interface AnimFrame {
  sheet: string;
  frame: number;
  flipX: boolean;
}

const OPPOSITE: Partial<Record<Facing, Facing>> = { left: "right", right: "left" };

/** Frames for a direction, mirroring left/right when only one side is drawn. */
export function framesFor(def: AnimDef, facing: Facing): { frames: number[]; flipX: boolean } | null {
  if (Array.isArray(def.frames)) return def.frames.length > 0 ? { frames: def.frames, flipX: def.flipX?.[facing] ?? false } : null;
  const own = def.frames[facing];
  if (own && own.length > 0) return { frames: own, flipX: def.flipX?.[facing] ?? false };
  const opp = OPPOSITE[facing];
  const mirrored = opp ? def.frames[opp] : undefined;
  if (mirrored && mirrored.length > 0) return { frames: mirrored, flipX: !(def.flipX?.[opp!] ?? false) };
  for (const f of ["down", "right", "up", "left"] as Facing[]) {
    const list = def.frames[f];
    if (list && list.length > 0) return { frames: list, flipX: false };
  }
  return null;
}

/**
 * Picks the frame to show `elapsedMs` into an animation. With `durationMs`
 * and no `fps`, the frames are spread evenly over the duration (so an attack
 * animation always matches the configured swing timing).
 */
export function animFrame(def: AnimDef, facing: Facing, elapsedMs: number, durationMs?: number): AnimFrame | null {
  const f = framesFor(def, facing);
  if (!f) return null;
  const n = f.frames.length;
  let idx: number;
  if (durationMs !== undefined && durationMs > 0 && !def.fps) {
    idx = Math.floor((Math.max(0, elapsedMs) / durationMs) * n);
  } else {
    idx = Math.floor((Math.max(0, elapsedMs) * (def.fps ?? 10)) / 1000);
  }
  idx = def.loop ? idx % n : Math.min(idx, n - 1);
  return { sheet: def.sheet, frame: f.frames[Math.max(0, idx)], flipX: f.flipX };
}

