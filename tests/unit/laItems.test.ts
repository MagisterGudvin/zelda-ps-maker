import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig } from "../helpers/fakeHost.ts";
import { spawnEnemy } from "../../src/enemies/spawn.ts";
import type { Enemy } from "../../src/enemies/enemy.ts";
import { Projectile } from "../../src/items/projectile.ts";
import { createObject } from "../../src/interactions/spawnObject.ts";

type Rig = ReturnType<typeof createRig>;

/** PS Maker moves the player; the toolkit derives facing from the movement delta. */
function face(rig: Rig, dx: number, dy: number): void {
  rig.step();
  rig.host.walk(dx, dy);
  rig.step();
}

const STILL = { hp: 20, speed: 0, chaseSpeed: 0, detectRange: 0, contactDamage: false, knockbackResist: 0 };

test("shield up: slower walking, facing kept while stepping back; lowered: back to normal", () => {
  const r = createRig();
  r.tk.inventory.give("shield", 1, { silent: true });
  face(r, 1, 0);
  r.host.input.press("shield");
  r.step();
  assert.equal(r.host.speedFactor, r.tk.config.shield.walkSpeed);
  r.host.walk(-1, 0);
  r.step();
  assert.equal(r.session.player.facing, "right", "stepping back with the shield up keeps facing the threat");
  r.host.input.release("shield");
  r.step();
  assert.equal(r.host.speedFactor, 1);
});

test("shield bash: an enemy running into the raised shield is thrown back hard, the player takes nothing", () => {
  const r = createRig();
  r.tk.inventory.give("shield", 1, { silent: true });
  face(r, 1, 0);
  const p = r.host.player!;
  const enemy = spawnEnemy(r.session, "slime", p.x + 10, p.y, { overrides: { ...STILL, contactDamage: true } }) as Enemy;
  r.host.input.press("shield");
  const hp = r.tk.state.player.hp;
  let blocked = 0;
  r.tk.bus.on("zelda:player:blocked", () => blocked++);
  let fastest = 0;
  for (let i = 0; i < 3; i++) {
    r.step();
    fastest = Math.max(fastest, enemy.vx);
  }
  assert.ok(blocked >= 1);
  assert.equal(r.tk.state.player.hp, hp);
  assert.ok(fastest >= r.tk.config.shield.bashKnockback * 0.9, `pushed back at ${fastest}`);
});

test("Mirror Shield: an enemy shot from the front flies back and hits the shooter", () => {
  const r = createRig();
  r.tk.inventory.give("mirror_shield", 1, { silent: true });
  face(r, 1, 0);
  const p = r.host.player!;
  const shooter = spawnEnemy(r.session, "slime", p.x + 80, p.y, { overrides: STILL }) as Enemy;
  let reflected = 0;
  r.tk.bus.on("zelda:player:reflected", () => reflected++);
  r.host.input.press("shield");
  r.session.world.add(new Projectile(r.session, { team: "enemy", ownerId: shooter.id, x: p.x + 40, y: p.y, dirX: -1, dirY: 0, speed: 200, range: 200, sprite: "enemy_shot", damage: 2, damageType: "projectile", blockable: true }));
  r.run(1200);
  assert.equal(reflected, 1);
  assert.equal(r.tk.state.player.hp, r.tk.config.player.maxHealth);
  assert.equal(shooter.hp, 18, "its own shot hit it");
});

test("Pegasus Boots on the second item button: run-up in place, then a dash that cuts the enemy in front; letting go stops", () => {
  const r = createRig({ enemies: { defaultDrops: { chance: 0 } } });
  r.tk.inventory.give("boots", 1, { silent: true });
  r.tk.inventory.assign(2, "boots");
  face(r, 1, 0);
  const p = r.host.player!;
  const x0 = p.x;
  const enemy = spawnEnemy(r.session, "slime", x0 + 60, p.y, { overrides: STILL }) as Enemy;
  r.host.input.press("useItem2");
  r.run(r.tk.config.items.boots.chargeMs - 50);
  assert.ok(Math.abs(p.x - x0) < 1, "the run-up stays in place");
  assert.ok(r.session.moves!.isDashing);
  r.run(400);
  assert.ok(p.x > x0 + 40, `dashed to ${p.x - x0}`);
  assert.equal(enemy.hp, 20 - r.tk.config.sword.damage, "the sword held out hit it once");
  r.host.input.release("useItem2");
  r.step();
  assert.ok(!r.session.moves!.isDashing);
  const x1 = p.x;
  r.step(5);
  assert.ok(Math.abs(p.x - x1) < 1, "stopped");
});

test("Pegasus Boots: a dash into a rock is a bump that throws the player back", () => {
  const r = createRig();
  r.tk.inventory.give("boots", 1, { silent: true });
  r.tk.inventory.equip("boots");
  face(r, 1, 0);
  const p = r.host.player!;
  createObject(r.session, "rock", p.x + 40, p.y, { id: "rock1" });
  let bumped = 0;
  r.tk.bus.on("zelda:player:bumped", () => bumped++);
  r.host.input.press("useItem");
  r.run(r.tk.config.items.boots.chargeMs + 400);
  assert.equal(bumped, 1);
  assert.ok(!r.session.moves!.isDashing);
  assert.ok(r.session.player.isKnockedBack || p.x < r.session.world.get("rock1")!.x - 16, "thrown back");
});

test("Roc's Feather: a jump over a pit (no fall in the air), drawn above the ground; landing on the pit falls", () => {
  const r = createRig();
  r.tk.inventory.give("feather", 1, { silent: true });
  r.tk.inventory.equip("feather");
  face(r, 1, 0);
  const p = r.host.player!;
  createObject(r.session, "pit", p.x, p.y, { id: "pit1" });
  const hp = r.tk.state.player.hp;
  // Standing on the pit already: jump at once (the fall check runs after the item on the same tick).
  r.host.input.tap("useItem");
  r.step();
  assert.ok(r.session.moves!.isAirborne);
  r.run(r.tk.config.items.feather.jumpMs - 60);
  assert.equal(r.tk.state.player.hp, hp, "no fall in the air");
  assert.ok(Math.max(...r.host.hops) > r.tk.config.items.feather.height * 0.8, "drawn above the ground");
  r.run(200);
  assert.ok(!r.session.moves!.isAirborne);
  assert.equal(r.host.hop, 0);
  assert.ok(r.tk.state.player.hp < hp, "landed on the pit: a fall");
});

test("Roc's Feather: enemies on the ground do not touch the player in the air", () => {
  const r = createRig();
  r.tk.inventory.give("feather", 1, { silent: true });
  r.tk.inventory.equip("feather");
  face(r, 1, 0);
  const p = r.host.player!;
  r.host.input.tap("useItem");
  r.step();
  spawnEnemy(r.session, "slime", p.x + 2, p.y, { overrides: { ...STILL, contactDamage: true, knockbackResist: 1 } });
  const hp = r.tk.state.player.hp;
  r.run(200);
  assert.equal(r.tk.state.player.hp, hp);
});
