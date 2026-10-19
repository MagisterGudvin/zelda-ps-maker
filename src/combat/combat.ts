import type { ToolkitConfig } from "../core/config.ts";
import type { Damageable, DamageInfo, DamageType, HitResult, Team } from "../core/types.ts";

/**
 * One attack instance (a sword swing, an explosion, a projectile). Tracks how
 * many times each target was hit so a single swing can never deal damage every
 * frame while its hitbox keeps overlapping the target.
 */
export class AttackInstance {
  private static nextId = 1;
  id = 0;
  maxHitsPerTarget = 1;
  private readonly counts = new Map<string, number>();

  constructor(maxHitsPerTarget = 1) {
    this.begin(maxHitsPerTarget);
  }

  /** Starts a new attack, reusing the map (no allocation per swing). */
  begin(maxHitsPerTarget = this.maxHitsPerTarget): void {
    this.id = AttackInstance.nextId++;
    this.maxHitsPerTarget = Math.max(1, maxHitsPerTarget);
    this.counts.clear();
  }

  canHit(targetId: string): boolean {
    return (this.counts.get(targetId) ?? 0) < this.maxHitsPerTarget;
  }

  record(targetId: string): void {
    this.counts.set(targetId, (this.counts.get(targetId) ?? 0) + 1);
  }

  hitCount(targetId: string): number {
    return this.counts.get(targetId) ?? 0;
  }
}

export function isDamageable(value: unknown): value is Damageable {
  return typeof value === "object" && value !== null && typeof (value as Damageable).receiveHit === "function";
}

export function makeDamage(partial: Partial<DamageInfo> & { amount: number; type: DamageType; team: Team }): DamageInfo {
  return {
    amount: partial.amount,
    type: partial.type,
    team: partial.team,
    sourceId: partial.sourceId ?? partial.team,
    originX: partial.originX ?? 0,
    originY: partial.originY ?? 0,
    knockback: partial.knockback ?? 0,
    stunMs: partial.stunMs ?? 0,
    blockable: partial.blockable ?? false,
  };
}

/**
 * Applies a hit through the attack's per-target counter. Friendly fire is
 * ignored. Returns the target's result; "ignored" hits are not counted.
 */
export function resolveHit(target: Damageable, info: DamageInfo, attack: AttackInstance | null): HitResult {
  if (!target.isHittable()) return "ignored";
  if (target.team === info.team && info.team !== "neutral") return "ignored";
  if (attack && !attack.canHit(target.id)) return "ignored";
  const result = target.receiveHit(info);
  if (attack && result !== "ignored") attack.record(target.id);
  return result;
}

/**
 * Final damage = base x global multiplier for the type x target resistance.
 * A resistance of 0 means immune. Non-zero damage is rounded but never below 1.
 */
export function scaleDamage(config: ToolkitConfig, amount: number, type: DamageType, resistances: Partial<Record<DamageType, number>> | undefined): number {
  const global = config.combat.damageTable[type] ?? 1;
  const resist = resistances?.[type] ?? 1;
  const raw = amount * global * resist;
  if (raw <= 0) return 0;
  return Math.max(1, Math.round(raw));
}
