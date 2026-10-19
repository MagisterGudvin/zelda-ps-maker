import type { FlagValue } from "../core/events.ts";
import { getDungeon } from "../core/state.ts";
import { toWorld } from "../core/units.ts";
import type { Session } from "../core/session.ts";
import { aliveInGroup, spawnEnemy } from "../enemies/spawn.ts";
import { Enemy } from "../enemies/enemy.ts";
import { Interactable, type ObjectState } from "../interactions/interactable.ts";
import { createObject, placePickup } from "../interactions/spawnObject.ts";
import type { ObjectConfig } from "../interactions/objectTypes.ts";
import type { EnemyConfig } from "../enemies/templates.ts";
import { changeHealth } from "../player/health.ts";
import type { Condition, RuleAction } from "./ruleTypes.ts";
import type { RuleContext, RuleRegistry } from "./ruleRegistry.ts";

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return v.split(",").map((x) => x.trim()).filter(Boolean);
  return [];
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function compare(value: number, spec: Obj): boolean {
  if (typeof spec.gte === "number" && !(value >= spec.gte)) return false;
  if (typeof spec.lte === "number" && !(value <= spec.lte)) return false;
  if (typeof spec.gt === "number" && !(value > spec.gt)) return false;
  if (typeof spec.lt === "number" && !(value < spec.lt)) return false;
  if (typeof spec.eq === "number" && value !== spec.eq) return false;
  return true;
}

function object(s: Session, id: string): Interactable | null {
  const e = s.world.get(id);
  return e instanceof Interactable ? e : null;
}

function eachObject(ctx: RuleContext, arg: unknown, what: string, fn: (o: Interactable) => void): void {
  for (const id of asList(arg)) {
    const o = object(ctx.session, id);
    if (o) fn(o);
    else ctx.session.logger.warn(`${what}: object "${id}" not found on map "${ctx.session.mapId}".`);
  }
}

/** Built-in condition/action vocabulary. See docs/RULES.md for the reference. */
export function registerBuiltinRules(reg: RuleRegistry): void {
  // ---- logic ----
  reg.registerCondition("all", (arg, ctx) => Array.isArray(arg) && arg.every((c) => ctx.evaluate(c as Condition)));
  reg.registerCondition("any", (arg, ctx) => Array.isArray(arg) && arg.some((c) => ctx.evaluate(c as Condition)));
  reg.registerCondition("not", (arg, ctx) => !ctx.evaluate(asObj(arg)));
  reg.registerCondition("always", (arg) => arg !== false);

  // ---- flags ----
  reg.registerCondition("flag", (arg, ctx) => {
    const flags = ctx.session.state.flags;
    if (typeof arg === "string") return !!flags[arg];
    const o = asObj(arg);
    const name = String(o.name ?? "");
    return "equals" in o ? flags[name] === o.equals : !!flags[name];
  });
  reg.registerCondition("notFlag", (arg, ctx) => !ctx.session.state.flags[String(arg)]);

  // ---- objects ----
  const objectActive = (arg: unknown, ctx: RuleContext) => {
    const ids = asList(arg);
    return ids.length > 0 && ids.every((id) => object(ctx.session, id)?.isActive === true);
  };
  reg.registerCondition("switchOn", objectActive);
  reg.registerCondition("objectActive", objectActive);
  reg.registerCondition("chestOpened", objectActive);
  reg.registerCondition("doorOpen", objectActive);
  reg.registerCondition("objectState", (arg, ctx) => {
    const o = asObj(arg);
    return object(ctx.session, String(o.id))?.objState === o.state;
  });
  reg.registerCondition("objectDestroyed", (arg, ctx) => asList(arg).every((id) => object(ctx.session, id)?.objState === "destroyed"));

  // ---- enemies ----
  reg.registerCondition("enemiesDefeated", (arg, ctx) => {
    const group = String(arg);
    return (ctx.session.rules?.spawnedInGroup(group) ?? 0) > 0 && aliveInGroup(ctx.session, group) === 0;
  });
  reg.registerCondition("enemyAlive", (arg, ctx) => {
    const e = ctx.session.world.get(String(arg));
    return e instanceof Enemy && e.alive;
  });
  reg.registerCondition("enemyState", (arg, ctx) => {
    const o = asObj(arg);
    const e = ctx.session.world.get(String(o.id));
    return e instanceof Enemy && e.state === o.state;
  });

  // ---- inventory / player ----
  reg.registerCondition("hasItem", (arg, ctx) => {
    if (typeof arg === "string") return ctx.session.toolkit.inventory.has(arg);
    const o = asObj(arg);
    return ctx.session.toolkit.inventory.has(String(o.item), num(o.count, 1));
  });
  reg.registerCondition("resource", (arg, ctx) => {
    const o = asObj(arg);
    return compare(ctx.session.toolkit.inventory.count(String(o.id)), o);
  });
  reg.registerCondition("playerHealth", (arg, ctx) => compare(ctx.session.state.player.hp, asObj(arg)));
  reg.registerCondition("abilityEnabled", (arg, ctx) => ctx.session.toolkit.inventory.isAbilityEnabled(String(arg)));

  // ---- dungeons ----
  reg.registerCondition("bossDefeated", (arg, ctx) => getDungeon(ctx.session.state, typeof arg === "string" ? arg : ctx.session.state.currentDungeon).bossDefeated);
  reg.registerCondition("dungeonCompleted", (arg, ctx) => getDungeon(ctx.session.state, typeof arg === "string" ? arg : ctx.session.state.currentDungeon).completed);
  reg.registerCondition("puzzleSolved", (arg, ctx) => !!ctx.session.state.flags[`puzzle:${String(arg)}`]);

  // ======================= actions =======================
  reg.registerAction("openDoor", (arg, ctx) => eachObject(ctx, arg, "openDoor", (o) => o.open()));
  reg.registerAction("closeDoor", (arg, ctx) => eachObject(ctx, arg, "closeDoor", (o) => o.close()));
  reg.registerAction("unlockDoor", (arg, ctx) =>
    eachObject(ctx, arg, "unlockDoor", (o) => {
      if (o.objState === "locked" || o.objState === "closed") o.setState("unlocked");
    }),
  );
  reg.registerAction("reveal", (arg, ctx) => eachObject(ctx, arg, "reveal", (o) => o.reveal()));
  reg.registerAction("hide", (arg, ctx) => eachObject(ctx, arg, "hide", (o) => o.hide()));
  reg.registerAction("destroyObject", (arg, ctx) => eachObject(ctx, arg, "destroyObject", (o) => o.destroy()));
  reg.registerAction("resetObject", (arg, ctx) => eachObject(ctx, arg, "resetObject", (o) => o.reset()));
  reg.registerAction("removeObject", (arg, ctx) => {
    for (const id of asList(arg)) {
      const e = ctx.session.world.get(id);
      if (e) ctx.session.world.remove(e);
    }
  });
  reg.registerAction("setState", (arg, ctx) => {
    const o = asObj(arg);
    eachObject(ctx, o.id, "setState", (obj) => obj.setState(String(o.state) as ObjectState));
  });
  reg.registerAction("activateSwitch", (arg, ctx) => {
    const o = typeof arg === "string" ? { id: arg, on: true } : asObj(arg);
    eachObject(ctx, o.id, "activateSwitch", (obj) => obj.setState(o.on === false ? "off" : "on"));
  });
  reg.registerAction("createObject", (arg, ctx) => {
    const o = asObj(arg);
    const { type, x, y, id, ...rest } = o;
    createObject(ctx.session, String(type), toWorld(ctx.session.config, num(x, 0)), toWorld(ctx.session.config, num(y, 0)), {
      id: id ? String(id) : undefined,
      overrides: rest as Partial<ObjectConfig>,
    });
  });

  reg.registerAction("setFlag", (arg, ctx) => {
    if (typeof arg === "string") ctx.session.rules?.setFlag(arg, true);
    else {
      const o = asObj(arg);
      ctx.session.rules?.setFlag(String(o.name), (o.value ?? true) as FlagValue);
    }
  });
  reg.registerAction("clearFlag", (arg, ctx) => {
    for (const f of asList(arg)) ctx.session.rules?.setFlag(f, false);
  });
  reg.registerAction("toggleFlag", (arg, ctx) => {
    const f = String(arg);
    ctx.session.rules?.setFlag(f, !ctx.session.state.flags[f]);
  });

  reg.registerAction("spawnEnemy", (arg, ctx) => {
    const o = asObj(arg);
    const s = ctx.session;
    spawnEnemy(s, String(o.template ?? "slime"), toWorld(s.config, num(o.x, 0)), toWorld(s.config, num(o.y, 0)), {
      id: o.id ? String(o.id) : undefined,
      group: o.group ? String(o.group) : "",
      overrides: asObj(o.overrides) as Partial<EnemyConfig>,
    });
  });
  reg.registerAction("killEnemy", (arg, ctx) => {
    for (const id of asList(arg)) {
      const e = ctx.session.world.get(id);
      if (e instanceof Enemy) e.die();
    }
  });
  reg.registerAction("killGroup", (arg, ctx) => {
    for (const e of ctx.session.world.list("enemy")) if (e instanceof Enemy && e.group === String(arg)) e.die();
  });

  reg.registerAction("giveItem", (arg, ctx) => {
    if (typeof arg === "string") ctx.session.toolkit.inventory.give(arg, 1);
    else {
      const o = asObj(arg);
      ctx.session.toolkit.inventory.give(String(o.item), num(o.count, 1), { silent: o.silent === true });
    }
  });
  reg.registerAction("spendResource", (arg, ctx) => {
    const o = asObj(arg);
    ctx.session.toolkit.inventory.spend(String(o.id), num(o.count, 1));
  });
  reg.registerAction("spawnPickup", (arg, ctx) => {
    const o = asObj(arg);
    const s = ctx.session;
    placePickup(s, String(o.item), num(o.count, 1), toWorld(s.config, num(o.x, 0)), toWorld(s.config, num(o.y, 0)), o.id ? String(o.id) : undefined);
  });
  reg.registerAction("enableAbility", (arg, ctx) => {
    const o = typeof arg === "string" ? { ability: arg, enabled: true } : asObj(arg);
    ctx.session.toolkit.inventory.setAbility(String(o.ability), o.enabled !== false);
  });

  reg.registerAction("heal", (arg, ctx) => {
    changeHealth(ctx.session.toolkit, num(arg, 2));
  });
  reg.registerAction("damagePlayer", (arg, ctx) => {
    const p = ctx.session.player;
    p.applyDamage(num(arg, 1), { type: "script", sourceId: "script", originX: p.box.x, originY: p.box.y, knockback: 0 });
  });
  reg.registerAction("setRespawn", (arg, ctx) => {
    const o = asObj(arg);
    const s = ctx.session;
    s.player.setRespawnPoint(toWorld(s.config, num(o.x, s.player.box.x)), toWorld(s.config, num(o.y, s.player.box.y)));
  });

  reg.registerAction("message", (arg, ctx) => {
    const s = ctx.session;
    const o = typeof arg === "string" ? { text: arg } : asObj(arg);
    s.bus.emit("zelda:message", { text: s.i18n.text(o.text as string), durationMs: num(o.durationMs, s.config.ui.messageMs) });
  });
  reg.registerAction("emit", (arg, ctx) => {
    const o = typeof arg === "string" ? { event: arg } : asObj(arg);
    ctx.session.bus.emit(`zelda:custom:${String(o.event)}`, asObj(o.data));
  });

  reg.registerAction("enterDungeon", (arg, ctx) => ctx.session.dungeons?.enter(String(arg)));
  reg.registerAction("completeDungeon", (arg, ctx) => ctx.session.dungeons?.complete(typeof arg === "string" ? arg : null));
  reg.registerAction("startWaves", (arg, ctx) => ctx.session.dungeons?.startWaves(String(arg)));
  reg.registerAction("save", (_arg, ctx) => {
    ctx.session.toolkit.saves.save();
  });
  reg.registerAction("if", (arg, ctx) => {
    const o = asObj(arg);
    const ok = ctx.evaluate(asObj(o.when));
    const branch = ok ? o.then : o.else;
    if (Array.isArray(branch)) ctx.execute(branch as RuleAction[]);
  });
}
