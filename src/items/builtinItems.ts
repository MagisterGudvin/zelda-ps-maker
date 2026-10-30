import { changeHealth, changeMagic } from "../player/health.ts";
import type { DamageType } from "../core/types.ts";
import type { FlagValue } from "../core/events.ts";
import { AttackInstance, isDamageable, makeDamage, resolveHit } from "../combat/combat.ts";
import { boxCircleOverlap, makeBox } from "../core/math.ts";
import type { Entity } from "../core/entity.ts";
import { Bomb } from "./bomb.ts";
import { Boomerang } from "./boomerang.ts";
import { Projectile } from "./projectile.ts";
import { spawnEffect } from "./effect.ts";
import type { ItemDefinition, ItemRegistry, ItemUseContext } from "./registry.ts";

/** Registers the default item set. Every item uses the same public contract. */
export function registerBuiltinItems(reg: ItemRegistry): void {
  // Passive equipment (not quick-usable; checked by other systems).
  reg.register({ id: "sword", icon: "icon_sword", quickUse: false });
  reg.register({ id: "shield", icon: "icon_shield", quickUse: false });
  // A better shield: sends shots back (shield.reflects). Held up with the shield key like the shield.
  reg.register({ id: "mirror_shield", icon: "icon_mirror_shield", quickUse: false });
  reg.register({ id: "glove", icon: "icon_glove", quickUse: false });

  reg.register({
    id: "bomb",
    icon: "icon_bomb",
    quickUse: true,
    resource: "bombs",
    cost: 1,
    cooldownMs: 200,
    maxActive: (s) => s.config.items.bomb.maxActive,
    use: (ctx) => ctx.session.world.add(new Bomb(ctx.session, ctx.frontX, ctx.frontY)),
  });

  reg.register({
    id: "boomerang",
    icon: "icon_boomerang",
    quickUse: true,
    maxActive: (s) => s.config.items.boomerang.maxActive,
    useMs: 120,
    use: (ctx) => ctx.session.world.add(new Boomerang(ctx.session, ctx.frontX, ctx.frontY, ctx.dirX, ctx.dirY)),
  });

  reg.register({
    id: "bow",
    icon: "icon_bow",
    quickUse: true,
    resource: "arrows",
    cost: 1,
    cooldownMs: 250,
    useMs: 150,
    maxActive: (s) => s.config.items.bow.maxActive,
    use: (ctx) => {
      const c = ctx.session.config.items.bow;
      return ctx.session.world.add(
        new Projectile(
          ctx.session,
          { team: "player", ownerId: "player", x: ctx.frontX, y: ctx.frontY, dirX: ctx.dirX, dirY: ctx.dirY, speed: c.speed, range: c.range, sprite: "arrow", size: 6, damage: c.damage, damageType: "arrow", knockback: 160 },
          "arrow",
        ),
      );
    },
  });


  reg.register({
    id: "fire_rod",
    icon: "icon_fire_rod",
    quickUse: true,
    resource: "magic",
    cost: (s) => s.config.items.fireRod.magicCost,
    cooldownMs: 300,
    useMs: 150,
    use: (ctx) => {
      const c = ctx.session.config.items.fireRod;
      return ctx.session.world.add(
        new Projectile(
          ctx.session,
          { team: "player", ownerId: "player", x: ctx.frontX, y: ctx.frontY, dirX: ctx.dirX, dirY: ctx.dirY, speed: c.speed, range: c.range, sprite: "fireball", size: 8, damage: c.damage, damageType: "fire", knockback: 120 },
          "fireball",
        ),
      );
    },
  });

  // Pegasus Boots: hold the item button to run up, then dash (MoveAbilities).
  reg.register({
    id: "boots",
    icon: "icon_boots",
    quickUse: true,
    use: (ctx) => ctx.session.moves?.startDash(ctx.button) ?? false,
  });

  // Roc's Feather: a jump over pits, spikes and enemies on the ground.
  reg.register({
    id: "feather",
    icon: "icon_feather",
    quickUse: true,
    cooldownMs: (s) => s.config.items.feather.jumpMs + s.config.items.feather.cooldownMs,
    use: (ctx) => ctx.session.moves?.jump() ?? false,
  });

  reg.register({
    id: "healing_spell",
    icon: "icon_healing_spell",
    quickUse: true,
    resource: "magic",
    cost: (s) => s.config.items.healingSpell.magicCost,
    cooldownMs: 500,
    useMs: 300,
    use: (ctx) => {
      const s = ctx.session;
      if (s.state.player.hp >= s.state.player.maxHp) return false;
      changeHealth(s.toolkit, s.config.items.healingSpell.heal);
      spawnEffect(s, "sparkle", ctx.x, ctx.y, 400, 2);
      return true;
    },
  });
}

/** JSON shape accepted by `Zelda: Define Item` (no programming required). */
export interface DataItemSpec {
  id: string;
  name?: ItemDefinition["name"];
  description?: ItemDefinition["description"];
  icon?: string;
  resource?: string;
  cost?: number;
  cooldownMs?: number;
  maxActive?: number;
  useMs?: number;
  stackable?: boolean;
  quickUse?: boolean;
  effect: "projectile" | "area" | "heal" | "restoreMagic" | "setFlag" | "emit" | "none";
  projectile?: { damage?: number; damageType?: DamageType; speed?: number; range?: number; sprite?: string; stunMs?: number; knockback?: number; pierce?: boolean; tint?: number; size?: number };
  area?: { radius?: number; damage?: number; damageType?: DamageType; knockback?: number; stunMs?: number; sprite?: string };
  amount?: number;
  flag?: string;
  value?: FlagValue;
  event?: string;
}

/** Builds an `ItemDefinition` from data; throws with a readable message on bad input. */
export function createDataItem(spec: DataItemSpec): ItemDefinition {
  if (!spec || typeof spec.id !== "string" || !spec.id) throw new Error('Item JSON needs an "id"');
  const effect = spec.effect ?? "none";
  const def: ItemDefinition = {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    icon: spec.icon ?? "icon_generic",
    quickUse: spec.quickUse ?? effect !== "none",
    stackable: spec.stackable,
    resource: spec.resource,
    cost: spec.cost ?? (spec.resource ? 1 : 0),
    cooldownMs: spec.cooldownMs ?? 250,
    maxActive: spec.maxActive,
    useMs: spec.useMs ?? 120,
  };
  switch (effect) {
    case "projectile": {
      const p = spec.projectile ?? {};
      def.use = (ctx) =>
        ctx.session.world.add(
          new Projectile(
            ctx.session,
            {
              team: "player",
              ownerId: "player",
              x: ctx.frontX,
              y: ctx.frontY,
              dirX: ctx.dirX,
              dirY: ctx.dirY,
              speed: p.speed ?? 200,
              range: p.range ?? 150,
              sprite: p.sprite ?? "fireball",
              size: p.size ?? 8,
              damage: p.damage ?? 2,
              damageType: p.damageType ?? "magic",
              stunMs: p.stunMs ?? 0,
              knockback: p.knockback ?? 120,
              pierce: p.pierce ?? false,
              tint: p.tint,
            },
            spec.id,
          ),
        );
      break;
    }
    case "area": {
      const a = spec.area ?? {};
      def.use = (ctx) => areaBurst(ctx, a.radius ?? 32, a.damage ?? 2, a.damageType ?? "magic", a.knockback ?? 180, a.stunMs ?? 0, a.sprite ?? "explosion");
      break;
    }
    case "heal":
      def.use = (ctx) => changeHealth(ctx.session.toolkit, spec.amount ?? 2) > 0;
      break;
    case "restoreMagic":
      def.use = (ctx) => changeMagic(ctx.session.toolkit, spec.amount ?? 8) > 0;
      break;
    case "setFlag":
      def.use = (ctx) => {
        if (!spec.flag) return false;
        ctx.session.rules?.setFlag(spec.flag, spec.value ?? true);
        return true;
      };
      break;
    case "emit":
      def.use = (ctx) => {
        if (!spec.event) return false;
        ctx.session.bus.emit(`zelda:custom:${spec.event}`, { itemId: spec.id });
        return true;
      };
      break;
    case "none":
      break;
    default:
      throw new Error(`Unknown item effect "${String(effect)}"`);
  }
  return def;
}

const areaBox = makeBox();
const areaFound: Entity[] = [];

function areaBurst(ctx: ItemUseContext, radius: number, damage: number, type: DamageType, knockback: number, stunMs: number, sprite: string): boolean {
  const s = ctx.session;
  spawnEffect(s, sprite, ctx.x, ctx.y, 350, (radius * 2) / 16);
  areaBox.x = ctx.x;
  areaBox.y = ctx.y;
  areaBox.hw = radius;
  areaBox.hh = radius;
  areaFound.length = 0;
  s.world.query(areaBox, areaFound, isDamageable);
  const attack = new AttackInstance(1);
  const info = makeDamage({ amount: damage, type, team: "player", sourceId: "player", originX: ctx.x, originY: ctx.y, knockback, stunMs });
  for (const t of areaFound) if (isDamageable(t) && boxCircleOverlap(t, ctx.x, ctx.y, radius)) resolveHit(t, info, attack);
  areaFound.length = 0;
  return true;
}
