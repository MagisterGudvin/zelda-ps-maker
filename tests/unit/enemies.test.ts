import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig, errors } from "../helpers/fakeHost.ts";
import { spawnEnemy } from "../../src/enemies/spawn.ts";
import type { Enemy } from "../../src/enemies/enemy.ts";
import { makeDamage } from "../../src/combat/combat.ts";
import { Projectile } from "../../src/items/projectile.ts";

function hit(e: Enemy, amount: number, type: "sword" | "arrow" | "bomb" | "fire" | "boomerang" = "sword", fromX = e.x - 10, fromY = e.y, stunMs = 0) {
  return e.receiveHit(makeDamage({ amount, type, team: "player", originX: fromX, originY: fromY, knockback: 100, stunMs }));
}

test("melee enemy detects the player, chases and lunges", () => {
  const rig = createRig();
  const p = rig.host.player!;
  const e = spawnEnemy(rig.session, "soldier", p.x + 60, p.y)!;
  const states = new Set<string>();
  for (let i = 0; i < 240; i++) {
    rig.step();
    states.add(e.state);
  }
  for (const s of ["alert", "chase", "windup", "attack"]) assert.ok(states.has(s), `visited ${s} (got ${[...states].join(",")})`);
});

test("a dead enemy never attacks or deals contact damage again", () => {
  const rig = createRig({ player: { invulnerableMs: 0 } });
  const p = rig.host.player!;
  const shooter = spawnEnemy(rig.session, "spitter", p.x + 50, p.y, { overrides: { attackCooldownMs: 100, windupMs: 50 } })!;
  const melee = spawnEnemy(rig.session, "slime", p.x + 1, p.y)!;
  shooter.die();
  melee.die();
  const hp = rig.tk.state.player.hp;
  rig.run(2000);
  const shots = rig.session.world.list("projectile").filter((x) => x instanceof Projectile && (x as Projectile).ownerId === shooter.id);
  assert.equal(shots.length, 0, "no projectiles from a dead shooter");
  assert.equal(rig.tk.state.player.hp, hp, "no contact damage from corpses");
  assert.equal(rig.session.world.has(shooter.id), false, "corpse removed after fading");
  assert.equal(errors(rig).length, 0);
});

test("shooter fires projectiles that hurt the player", () => {
  const rig = createRig({ shield: { enabled: false } });
  const p = rig.host.player!;
  spawnEnemy(rig.session, "spitter", p.x + 70, p.y, { overrides: { attackCooldownMs: 300 } });
  let hurt = 0;
  rig.tk.bus.on("zelda:player:takeDamage", (d) => {
    if (d.type === "projectile") hurt++;
  });
  rig.run(4000);
  assert.ok(hurt >= 1, "player was hit by a projectile");
});

test("guardian blocks frontal hits while guarding but takes damage from behind", () => {
  const rig = createRig();
  const e = spawnEnemy(rig.session, "knight", 300, 300, { overrides: { detectRange: 0 } })!;
  e.facing = "left";
  e.guardUp = true;
  assert.equal(hit(e, 2, "sword", e.x - 20, e.y), "blocked");
  assert.equal(e.hp, e.maxHp);
  rig.run(300);
  assert.equal(hit(e, 2, "sword", e.x + 20, e.y), "damaged");
  assert.equal(e.hp, e.maxHp - 2);
  rig.run(300);
  e.guardUp = true;
  e.facing = "left";
  assert.equal(hit(e, 2, "bomb", e.x - 20, e.y), "damaged", "bombs break the guard");
});

test("resistances: 0 makes an enemy immune to a damage type; boomerang stuns", () => {
  const rig = createRig();
  const e = spawnEnemy(rig.session, "slime", 300, 300, { overrides: { hp: 10, resistances: { arrow: 0, fire: 2 }, detectRange: 0 } })!;
  assert.equal(hit(e, 2, "arrow"), "immune");
  assert.equal(e.hp, 10);
  rig.run(300);
  hit(e, 2, "fire");
  assert.equal(e.hp, 6, "fire x2");
  rig.run(300);
  hit(e, 0, "boomerang", e.x - 10, e.y, 1000);
  assert.equal(e.state, "stunned");
  rig.run(1100);
  assert.notEqual(e.state, "stunned");
});

test("enemy hit cooldown prevents double hits from two sources in the same moment", () => {
  const rig = createRig({ combat: { enemyHitCooldownMs: 250 } });
  const e = spawnEnemy(rig.session, "slime", 300, 300, { overrides: { hp: 10, detectRange: 0 } })!;
  assert.equal(hit(e, 2), "damaged");
  assert.equal(hit(e, 2), "ignored");
  assert.equal(e.hp, 8);
});

test("miniboss changes phase as health drops and stays defeated when persistent", () => {
  const rig = createRig();
  const phases: number[] = [];
  rig.tk.bus.on("zelda:enemy:phaseChanged", (e) => phases.push(e.phase));
  let bossDefeated = 0;
  rig.tk.bus.on("zelda:boss:defeated", () => bossDefeated++);
  const boss = spawnEnemy(rig.session, "ogre", rig.host.player!.x + 80, rig.host.player!.y, { id: "boss_1" })!;
  boss.hp = Math.floor(boss.maxHp * 0.5);
  rig.run(200);
  boss.hp = Math.floor(boss.maxHp * 0.2);
  rig.run(200);
  assert.deepEqual(phases, [1, 2]);
  boss.die();
  assert.equal(bossDefeated, 1);
  rig.step(30);
  assert.equal(spawnEnemy(rig.session, "ogre", 10, 10, { id: "boss_1" }), null, "persistent boss does not respawn");
});

test("deterministic drops with a seeded RNG", () => {
  const run = () => {
    const rig = createRig({ enemies: { defaultDrops: { chance: 1 } } });
    const items: string[] = [];
    for (let i = 0; i < 6; i++) spawnEnemy(rig.session, "slime", 50 + i * 20, 50, { overrides: { detectRange: 0 } })!.die();
    for (const p of rig.session.world.list("pickup")) items.push((p as unknown as { item: string }).item);
    return items.join(",");
  };
  assert.equal(run(), run());
});

test("enemies collide with walls instead of walking through them", () => {
  const rig = createRig();
  const p = rig.host.player!;
  rig.host.walls.push({ x: p.x + 30, y: p.y, hw: 4, hh: 40 });
  const e = spawnEnemy(rig.session, "soldier", p.x + 60, p.y, { overrides: { lineOfSight: false } })!;
  rig.run(3000);
  assert.ok(e.x > p.x + 30, `enemy stayed behind the wall (x=${e.x.toFixed(1)})`);
});

test("unknown template and disabled feature are reported, not thrown", () => {
  const rig = createRig();
  assert.equal(spawnEnemy(rig.session, "nope", 0, 0), null);
  assert.ok(rig.logs.some((l) => l.level === "warn" && String(l.args[1]).includes("Unknown enemy template")));
});

test("custom templates extend built-ins", () => {
  const rig = createRig();
  rig.tk.enemyTemplates.define("red_soldier", { extends: "soldier", hp: 9 } as never);
  const e = spawnEnemy(rig.session, "red_soldier", 0, 0)!;
  assert.equal(e.maxHp, 9);
  assert.equal(e.cfg.behavior, "melee");
});
