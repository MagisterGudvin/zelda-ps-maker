import type { ToolkitConfig } from "../core/config.ts";
import { toWorld } from "../core/units.ts";
import type { Vec2 } from "../core/math.ts";

/**
 * Plugin parameter values as PS Maker 1.2.1 saves them (`pluginParams`, passed to `execute`
 * unchanged; field types in docs/ENGINE_AUDIT.md, section 11): "map-position" is `{ x, y }`,
 * "in-map-npc" the NPC's `inGameCharacterId`, "image" and "audio" the id of a library asset
 * (PS Maker loads project images and sounds under their id).
 */

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** A map position `{ x, y }` in world pixels, or null. */
export function resolvePosition(value: unknown, config: ToolkitConfig): Vec2 | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (!finite(x) || !finite(y)) return null;
  return { x: toWorld(config, x), y: toWorld(config, y) };
}

/** The NPC of the map scene (`GameMap.NPCs`) picked in an "in-map-npc" field, or null. */
export function resolveNpc(value: unknown, scene: any): any | null {
  if (typeof value !== "string" || !value) return null;
  const npcs: any[] = Array.isArray(scene?.NPCs) ? scene.NPCs : [];
  return npcs.find((n) => n?.inGameCharacterId === value) ?? null;
}

/** The asset id of an "image" or "audio" field ("" when empty). */
export function assetId(value: unknown): string {
  return typeof value === "string" ? value : "";
}
