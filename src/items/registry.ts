import type { Entity } from "../core/entity.ts";
import type { Session } from "../core/session.ts";
import type { LocalizedText } from "../core/types.ts";
import type { Facing } from "../core/math.ts";

export interface ItemUseContext {
  session: Session;
  facing: Facing;
  /** Player center. */
  x: number;
  y: number;
  /** Point just in front of the player (spawn position for projectiles/bombs). */
  frontX: number;
  frontY: number;
  dirX: number;
  dirY: number;
  /** The item button that used it (items that act while it is held: the Pegasus Boots). */
  button: "useItem" | "useItem2";
}

/**
 * Return value of `use`: `false` = nothing happened (no resource spent),
 * `true` = used, an `Entity` = used and the entity counts toward `maxActive`.
 */
export type ItemUseResult = boolean | Entity;

/**
 * Contract every usable item implements. New items are added by registering
 * a definition; no other subsystem has to change.
 */
export interface ItemDefinition {
  id: string;
  name?: LocalizedText;
  description?: LocalizedText;
  /** Procedural sprite id or a texture key available in PS Maker. */
  icon: string;
  /** Selectable in the quick-use slot. Passive items (sword, shield) are not. */
  quickUse: boolean;
  /** Stored as a count (custom resources such as "seeds"). */
  stackable?: boolean;
  /** Resource spent per use ("bombs", "arrows", "magic", custom). */
  resource?: string;
  /** Cost per use; may read the live configuration. */
  cost?: number | ((s: Session) => number);
  cooldownMs?: number | ((s: Session) => number);
  maxActive?: number | ((s: Session) => number);
  /** How long the player is busy (movement locked) after using it. */
  useMs?: number;
  /** Resource shown next to the item in the HUD (defaults to `resource`). */
  counter?: string;
  use?(ctx: ItemUseContext): ItemUseResult;
}

export class ItemRegistry {
  private readonly defs = new Map<string, ItemDefinition>();

  register(def: ItemDefinition): void {
    if (!def || typeof def.id !== "string" || def.id.trim() === "") throw new Error("Item definition needs a non-empty string id");
    this.defs.set(def.id, def);
  }

  get(id: string): ItemDefinition | undefined {
    return this.defs.get(id);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  ids(): string[] {
    return [...this.defs.keys()];
  }
}

export function resolveNumber(v: number | ((s: Session) => number) | undefined, s: Session, fallback: number): number {
  if (v === undefined) return fallback;
  return typeof v === "function" ? v(s) : v;
}
