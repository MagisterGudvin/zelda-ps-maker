import type { Session } from "../core/session.ts";
import { objectKey } from "../core/state.ts";
import { Pickup } from "../items/pickup.ts";
import { Interactable } from "./interactable.ts";
import { isObjectType, OBJECT_TYPES, type ObjectConfig, resolveObjectConfig } from "./objectTypes.ts";

export interface CreateObjectOptions {
  id?: string;
  overrides?: Partial<ObjectConfig>;
}

/** Creates an interactive object; null (with a logged reason) on bad input. */
export function createObject(s: Session, type: string, x: number, y: number, opts: CreateObjectOptions = {}): Interactable | null {
  if (!s.feature("interactions")) {
    s.logger.warn(`Object "${type}" not created: the "interactions" feature is disabled.`);
    return null;
  }
  if (!isObjectType(type)) {
    s.logger.warn(`Unknown object type "${type}". Known: ${OBJECT_TYPES.join(", ")}`);
    return null;
  }
  const explicit = !!opts.id;
  const id = opts.id || s.world.nextId(type);
  if (s.world.has(id)) {
    s.logger.warn(`Object id "${id}" already exists on this map; creation skipped.`);
    return null;
  }
  const cfg = resolveObjectConfig(type, opts.overrides);
  s.logger.info(`Object "${id}" (${type}) created at ${Math.round(x)}, ${Math.round(y)}.`);
  return s.world.add(new Interactable(s, id, cfg, x, y, explicit));
}

/**
 * Places an item on the ground. With an id it is persistent: once collected it
 * will not reappear (keys, heart containers placed by the author).
 */
export function placePickup(s: Session, item: string, count: number, x: number, y: number, id?: string, sprite?: string): Pickup | null {
  const persistentId = id ? objectKey(s.mapId, id) : undefined;
  if (persistentId && s.state.objects[persistentId] === "collected") return null;
  return s.world.add(new Pickup(s, x, y, { item, count, persistentId, lifetimeMs: 0, silent: false, ...(sprite ? { sprite } : {}) }));
}
