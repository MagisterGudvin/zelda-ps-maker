import { animFrame } from "../core/animation.ts";
import type { ToolkitConfig } from "../core/config.ts";
import type { Facing } from "../core/math.ts";
import type { OverlayLayer } from "../host/types.ts";

/** Which player animation wins when several want to show (higher wins). */
export const OVERLAY_PRIORITY = { pose: 1, hurt: 2, sword: 3, action: 4, itemGet: 5, death: 6 } as const;

/**
 * Builds the player overlay (body + optional weapon layer) for one moment of
 * an action. Returns null when the body animation is not configured or not
 * defined, so callers fall back to the built-in visuals.
 */
export function buildOverlay(config: ToolkitConfig, bodyId: string, weaponId: string, facing: Facing, elapsedMs: number, durationMs?: number): OverlayLayer[] | null {
  const anims = config.sprites.animations;
  const body = bodyId ? anims[bodyId] : undefined;
  const weapon = weaponId ? anims[weaponId] : undefined;
  if (!body && !weapon) return null;
  const layers: OverlayLayer[] = [];
  const behind = config.player.sprites.weaponBehind.includes(facing);
  const w = weapon ? animFrame(weapon, facing, elapsedMs, durationMs) : null;
  if (w && behind) layers.push({ ...w, behind: true });
  const b = body ? animFrame(body, facing, elapsedMs, durationMs) : null;
  if (b) layers.push({ ...b, behind: false });
  if (w && !behind) layers.push({ ...w, behind: false });
  return layers.length > 0 ? layers : null;
}
