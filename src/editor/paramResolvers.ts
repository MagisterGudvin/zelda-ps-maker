import type { ToolkitConfig } from "../core/config.ts";
import { toWorld } from "../core/units.ts";
import type { Vec2 } from "../core/math.ts";

/**
 * The runtime shapes of `position`, `npc` and `image` parameters are typed
 * `any` in @ps-maker/plugin-api 0.0.3 and not documented. These resolvers
 * accept every plausible shape and return null when nothing matches, so the
 * caller can log a clear message (see docs/ENGINE_AUDIT.md, U-2..U-4).
 */

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function resolvePosition(value: unknown, config: ToolkitConfig): Vec2 | null {
  let x: unknown;
  let y: unknown;
  if (Array.isArray(value)) {
    [x, y] = value;
  } else if (typeof value === "string") {
    const parts = value.split(/[,;\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 2) [x, y] = parts;
  } else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.position && typeof o.position === "object") return resolvePosition(o.position, config);
    x = o.x ?? o.tileX ?? o.col;
    y = o.y ?? o.tileY ?? o.row;
  }
  if (typeof x === "string") x = Number(x);
  if (typeof y === "string") y = Number(y);
  if (!finite(x) || !finite(y)) return null;
  return { x: toWorld(config, x), y: toWorld(config, y) };
}

const ID_KEYS = ["id", "npcId", "instanceId", "uuid", "key", "name"];

function matches(obj: any, wanted: string): boolean {
  if (!obj) return false;
  for (const k of ID_KEYS) {
    const v = obj[k];
    if ((typeof v === "string" || typeof v === "number") && String(v) === wanted) return true;
  }
  if (typeof obj.getData === "function") {
    for (const k of ID_KEYS) {
      const v = obj.getData(k);
      if ((typeof v === "string" || typeof v === "number") && String(v) === wanted) return true;
    }
  }
  const cfg = obj.config ?? obj.npc ?? obj.data?.values;
  if (cfg && typeof cfg === "object") {
    for (const k of ID_KEYS) {
      const v = (cfg as Record<string, unknown>)[k];
      if ((typeof v === "string" || typeof v === "number") && String(v) === wanted) return true;
    }
  }
  return false;
}

/** Returns a Phaser game object for an `npc` parameter value, or null. */
export function resolveNpc(value: unknown, scene: any): any | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") {
    const o = value as any;
    if (typeof o.x === "number" && typeof o.y === "number" && (typeof o.setVisible === "function" || o.body)) return o;
    for (const k of ["sprite", "gameObject", "actor"]) if (o[k] && typeof o[k].x === "number") return o[k];
    for (const k of ID_KEYS) if (o[k] !== undefined) return resolveNpc(String(o[k]), scene);
    return null;
  }
  const wanted = String(value);
  const list: any[] = scene?.children?.list ?? [];
  for (const obj of list) if (matches(obj, wanted)) return obj;
  return null;
}

/** Returns a texture key for an `image` parameter value ("" when empty). */
export function resolveImage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of ["key", "textureKey", "texture", "name", "id"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return "";
}

/** Parses "true"/"false"/numbers; other text stays a string. */
export function parseFlagValue(text: string): boolean | number | string {
  const t = (text ?? "").trim();
  if (t === "" || t.toLowerCase() === "true") return true;
  if (t.toLowerCase() === "false") return false;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

export function parseJsonValue(text: string): { value: unknown; error: string | null } {
  const t = (text ?? "").trim();
  if (t === "") return { value: undefined, error: null };
  try {
    return { value: JSON.parse(t), error: null };
  } catch (err) {
    return { value: undefined, error: (err as Error).message };
  }
}
