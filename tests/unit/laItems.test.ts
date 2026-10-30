import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig } from "../helpers/fakeHost.ts";
import { spawnEnemy } from "../../src/enemies/spawn.ts";
import type { Enemy } from "../../src/enemies/enemy.ts";
import { Projectile } from "../../src/items/projectile.ts";
import { createObject } from "../../src/interactions/spawnObject.ts";
import { Pickup } from "../../src/items/pickup.ts";

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

test("Shovel: digs plain ground (a drop by chance, a dug patch), not walls or rocks; buried treasure comes up once and stays dug", () => {
  const r = createRig({ items: { shovel: { drops: { chance: 1, entries: [{ item: "rupees", count: 5, weight: 1 }] } } } });
  r.tk.inventory.give("shovel", 1, { silent: true });
  r.tk.inventory.equip("shovel");
  face(r, 1, 0);
  const p = r.host.player!;
  let dug = 0;
  r.tk.bus.on("zelda:ground:dug", () => dug++);
  r.host.input.tap("useItem");
  r.step(2);
  assert.equal(dug, 1);
  assert.ok(r.session.world.list("pickup").length >= 1, "the ground gave a drop");
  r.run(500);
  // A rock in front: a clink, nothing dug.
  createObject(r.session, "rock", p.x + 16, p.y, { id: "rock1" });
  r.host.input.tap("useItem");
  r.step(2);
  assert.equal(dug, 1);
  r.session.world.remove(r.session.world.get("rock1")!);
  r.step();
  // Buried treasure in front (Create Chest: Buried).
  const spot = createObject(r.session, "buried", p.x + 12, p.y, { id: "buried@1", overrides: { contents: { item: "heart_container", count: 1 } } }) as any;
  assert.equal(spot.visible, false, "unseen until dug");
  const max = r.tk.state.player.maxHp;
  r.run(400);
  r.host.input.tap("useItem");
  r.step(2);
  assert.equal(r.tk.state.player.maxHp, max + r.tk.config.player.heartValue, "the treasure");
  assert.equal(spot.objState, "revealed");
  assert.equal(spot.visible, true, "the hole stays");
  r.run(400);
  r.host.input.tap("useItem");
  r.step(2);
  assert.equal(r.tk.state.player.maxHp, max + r.tk.config.player.heartValue, "only once");
});

test("Magic Powder: comes with 10 powder; a cloud in front hurts and stuns the enemy and lights the torch; one powder a use", () => {
  const r = createRig();
  r.tk.inventory.give("magic_powder", 1, { silent: true });
  assert.equal(r.tk.inventory.count("powder"), 10);
  r.tk.inventory.equip("magic_powder");
  face(r, 1, 0);
  const p = r.host.player!;
  const enemy = spawnEnemy(r.session, "slime", p.x + 16, p.y - 4, { overrides: STILL }) as Enemy;
  const torch = createObject(r.session, "torch", p.x + 16, p.y + 8, { id: "torch1" }) as any;
  r.host.input.tap("useItem");
  r.step(2);
  assert.equal(enemy.hp, 20 - r.tk.config.items.powder.damage);
  assert.equal(enemy.state, "stunned");
  assert.equal(torch.objState, "lit");
  assert.equal(r.tk.inventory.count("powder"), 9);
});

test("bomb arrows: the bow and the bombs on the two item buttons pressed together shoot an arrow that explodes; one alone, after a moment, is a plain arrow", () => {
  const r = createRig({ combat: { bombsHurtPlayer: false } });
  const inv = r.tk.inventory;
  inv.give("bow", 1, { silent: true });
  inv.give("arrows", 10, { silent: true });
  inv.give("bombs", 5, { silent: true });
  inv.assign(1, "bow");
  inv.assign(2, "bomb");
  face(r, 1, 0);
  const p = r.host.player!;
  const enemy = spawnEnemy(r.session, "slime", p.x + 60, p.y, { overrides: STILL }) as Enemy;
  let exploded = 0;
  r.tk.bus.on("zelda:bomb:exploded", () => exploded++);
  r.host.input.tap("useItem");
  r.host.input.tap("useItem2");
  r.step();
  assert.ok(r.session.world.list("projectile").some((e) => e.id.startsWith("bomb_arrow")), "a bomb arrow flies");
  assert.deepEqual([inv.count("arrows"), inv.count("bombs")], [9, 4]);
  r.run(600);
  assert.equal(exploded, 1);
  assert.equal(enemy.hp, 20 - r.tk.config.items.bomb.damage, "the explosion hit it");
  r.run(500);
  r.host.input.tap("useItem");
  r.step();
  assert.equal(r.session.world.list("projectile").filter((e) => !e.removed).length, 0, "waits for the other button first");
  r.run(r.tk.config.items.bombArrow.comboMs + 50);
  assert.ok(r.session.world.list("projectile").some((e) => e.id.startsWith("arrow")), "then a plain arrow");
  assert.deepEqual([inv.count("arrows"), inv.count("bombs")], [8, 4]);
});

function withHookshot(config: unknown = {}) {
  const r = createRig(config);
  r.tk.inventory.give("hookshot", 1, { silent: true });
  r.tk.inventory.equip("hookshot");
  face(r, 1, 0);
  return r;
}

test("Hookshot: an enemy in front is hurt and stunned; the hook comes back and the player is free again", () => {
  const r = withHookshot();
  const p = r.host.player!;
  const enemy = spawnEnemy(r.session, "slime", p.x + 50, p.y, { overrides: STILL }) as Enemy;
  r.host.input.tap("useItem");
  r.step();
  assert.ok(r.session.player.isLocked("hookshot"), "the player waits while the hook is out");
  r.run(800);
  assert.equal(enemy.hp, 20 - r.tk.config.items.hookshot.damage);
  assert.equal(enemy.state, "stunned");
  assert.ok(!r.session.player.isLocked("hookshot"));
  assert.equal(r.session.world.list("projectile").filter((e) => !e.removed).length, 0);
});

test("Hookshot: a dropped item rides the hook back to the player", () => {
  const r = withHookshot();
  const p = r.host.player!;
  r.session.world.add(new Pickup(r.session, p.x + 60, p.y, { item: "rupees", count: 5 }));
  r.run(1000);
  r.host.input.tap("useItem");
  r.run(1000);
  assert.equal(r.tk.inventory.count("rupees"), 5);
});

test("Hookshot: it holds a hook post and pulls the player across a pit (no fall); a wall just sends it back", () => {
  const r = withHookshot();
  const p = r.host.player!;
  const x0 = p.x;
  createObject(r.session, "pit", x0 + 30, p.y, { id: "pit1" });
  createObject(r.session, "pit", x0 + 46, p.y, { id: "pit2" });
  const post = createObject(r.session, "hook_post", x0 + 72, p.y, { id: "post1" })!;
  const hp = r.tk.state.player.hp;
  let grabbed = 0;
  r.tk.bus.on("zelda:hookshot:grabbed", () => grabbed++);
  r.host.input.tap("useItem");
  r.run(900);
  assert.equal(grabbed, 1);
  assert.ok(p.x > x0 + 50, `pulled to ${p.x - x0}`);
  assert.ok(post.x - p.x < 20, "next to the post");
  r.run(300);
  assert.equal(r.tk.state.player.hp, hp, "flew over the pits");
  // A wall ahead: the hook comes back, the player stays.
  r.host.walls.push({ x: p.x + 40, y: p.y, hw: 4, hh: 40 });
  r.session.world.remove(post);
  r.step();
  const x1 = p.x;
  r.host.input.tap("useItem");
  r.run(900);
  assert.ok(Math.abs(p.x - x1) < 1);
  assert.ok(!r.session.player.isLocked("hookshot"));
});

test("a placed bomb can be picked up (Z) and thrown (Z): it flies and goes off where it lands; held too long, it goes off in the hands", () => {
  const r = createRig();
  r.tk.inventory.give("bombs", 5, { silent: true });
  r.tk.inventory.equip("bomb");
  face(r, 1, 0);
  const p = r.host.player!;
  r.host.input.tap("useItem");
  r.step(2);
  const bomb = r.session.world.list("projectile").find((e) => e.id.startsWith("bomb")) as any;
  assert.ok(bomb);
  r.run(250);
  r.host.input.tap("action");
  r.step();
  assert.ok(r.session.interactions!.isCarrying() && bomb.carried, "picked up");
  assert.ok(bomb.y < p.y - 4, "over the head");
  r.host.input.tap("action");
  r.step();
  assert.ok(!r.session.interactions!.isCarrying());
  r.run(600);
  assert.ok(bomb.x > p.x + r.tk.config.items.thrown.range * 0.7, `thrown to ${bomb.x - p.x}`);
  let at: { x: number } | null = null;
  r.tk.bus.on("zelda:bomb:exploded", (e) => (at = e));
  r.run(r.tk.config.items.bomb.fuseMs);
  assert.ok(at && (at as { x: number }).x > p.x + 40, "went off where it landed");
  // Held too long.
  r.run(400);
  r.host.input.tap("useItem");
  r.step(2);
  r.run(200);
  r.host.input.tap("action");
  r.step();
  assert.ok(r.session.interactions!.isCarrying());
  const hp = r.tk.state.player.hp;
  r.run(r.tk.config.items.bomb.fuseMs);
  assert.ok(r.tk.state.player.hp < hp, "the blast in the hands hurt the player");
  assert.ok(!r.session.interactions!.isCarrying());
});
