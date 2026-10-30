import type { AABB } from "./math.ts";

/** Damage classes. Enemies and objects declare multipliers/permissions per class. */
export type DamageType =
  | "sword"
  | "spin"
  | "poke"
  | "arrow"
  | "bomb"
  | "boomerang"
  | "fire"
  | "ice"
  | "magic"
  | "thrown"
  | "hookshot"
  | "contact"
  | "projectile"
  | "hazard"
  | "fall"
  | "script";

export const DAMAGE_TYPES: readonly DamageType[] = [
  "sword",
  "spin",
  "poke",
  "arrow",
  "bomb",
  "boomerang",
  "fire",
  "ice",
  "magic",
  "thrown",
  "hookshot",
  "contact",
  "projectile",
  "hazard",
  "fall",
  "script",
];

export type Team = "player" | "enemy" | "neutral";

export type EntityKind = "enemy" | "object" | "projectile" | "pickup" | "effect";

/** One hit delivered by an attack, a projectile, an explosion or a script. */
export interface DamageInfo {
  amount: number;
  type: DamageType;
  /** Id of the attacking entity (or "player", "script"). */
  sourceId: string;
  team: Team;
  /** Origin of the hit; used for knockback direction and shield checks. */
  originX: number;
  originY: number;
  /** Knockback speed in px/s; 0 disables knockback. */
  knockback: number;
  /** Stun duration in ms (boomerang). */
  stunMs: number;
  /** Projectiles and similar can be blocked by shields. */
  blockable: boolean;
}

export type HitResult = "damaged" | "blocked" | "immune" | "ignored" | "killed";

/** Anything that can be hit by the shared combat resolver. */
export interface Damageable extends AABB {
  readonly id: string;
  readonly team: Team;
  /** Applies already-scaled damage. Implementations own their own cooldowns. */
  receiveHit(info: DamageInfo): HitResult;
  isHittable(): boolean;
}

/** Drop table entry; `item` is an item or resource id understood by the inventory. */
export interface DropEntry {
  item: string;
  count?: number;
  weight: number;
}

export interface DropTable {
  chance: number;
  entries: DropEntry[];
}

/** Text that is either a localization key or a literal per-language map. */
export type LocalizedText = string | { en?: string; ru?: string; [lang: string]: string | undefined };
