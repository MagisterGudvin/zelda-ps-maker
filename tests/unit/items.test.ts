import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig, errors, type TestRig } from "../helpers/fakeHost.ts";
import { spawnEnemy } from "../../src/enemies/spawn.ts";
import { createObject } from "../../src/interactions/spawnObject.ts";
import { Boomerang } from "../../src/items/boomerang.ts";
import { createDataItem } from "../../src/items/builtinItems.ts";
import { Pickup } from "../../src/items/pickup.ts";

function face(rig: TestRig, dx: number, dy: number): void {
  rig.step();
  rig.host.walk(dx, dy);
  rig.step();
}

function useItem(rig: TestRig, id: string): void {
  rig.tk.inventory.equip(id);
  rig.host.input.tap("useItem");
  rig.step();
}

test("bombs: placing one spends exactly one bomb; none left means no bomb", () => {
  const rig = createRig();
  rig.tk.inventory.give("bombs", 2, { silent: true });
  assert.equal(rig.tk.inventory.count("bombs"), 2);
  useItem(rig, "bomb");
  assert.equal(rig.tk.inventory.count("bombs"), 1);
  rig.run(300);
  useItem(rig, "bomb");
  assert.equal(rig.tk.inventory.count("bombs"), 0);
  rig.run(300);
  const failed: string[] = [];
  rig.tk.bus.on("zelda:item:failed", (e) => failed.push(e.reason));
  useItem(rig, "bomb");
  assert.equal(rig.tk.inventory.count("bombs"), 0);
  assert.deepEqual(failed, ["noResource"]);
});

test("bomb explosion damages enemies, breaks bombable walls and respects maxActive", () => {
  const rig = createRig({ combat: { bombsHurtPlayer: false }, items: { bomb: { maxActive: 1 } } });
  face(rig, 1, 0);
  const p = rig.host.player!;
  rig.tk.inventory.give("bombs", 5, { silent: true });
  const wall = createObject(rig.session, "bombable_wall", p.x + 30, p.y, { id: "wall_1" })!;
  const enemy = spawnEnemy(rig.session, "slime", p.x + 15, p.y + 12, { overrides: { hp: 10, detectRange: 0, speed: 0 } })!;
  let destroyed = 0;
  rig.tk.bus.on("zelda:object:destroyed", () => destroyed++);
  useItem(rig, "bomb");
  rig.run(300);
  useItem(rig, "bomb"); // second bomb while the first is still ticking: refused
  assert.equal(rig.tk.inventory.count("bombs"), 4);
  rig.run(rig.tk.config.items.bomb.fuseMs);
  assert.equal(enemy.hp, 10 - rig.tk.config.items.bomb.damage);
  assert.equal(wall.objState, "destroyed");
  assert.equal(wall.solid, false, "passage opened");
  assert.equal(destroyed, 1);
  assert.equal(rig.tk.state.objects["test_map/wall_1"], "destroyed", "persisted");
});

test("boomerang stuns an enemy, returns to the player and only one can fly", () => {
  const rig = createRig();
  face(rig, 1, 0);
  const p = rig.host.player!;
  rig.tk.inventory.give("boomerang", 1, { silent: true });
  const enemy = spawnEnemy(rig.session, "slime", p.x + 50, p.y, { overrides: { detectRange: 0, speed: 0 } })!;
  useItem(rig, "boomerang");
  assert.equal(rig.session.world.list("projectile").filter((e) => e instanceof Boomerang).length, 1);
  rig.run(200);
  useItem(rig, "boomerang");
  assert.equal(rig.session.world.list("projectile").filter((e) => e instanceof Boomerang).length, 1, "maxActive 1");
  rig.run(400);
  assert.equal(enemy.state, "stunned");
  rig.run(1500);
  assert.equal(rig.session.world.list("projectile").filter((e) => e instanceof Boomerang).length, 0, "caught");
});

test("boomerang activates a switch and fetches a pickup", () => {
  const rig = createRig();
  face(rig, 1, 0);
  const p = rig.host.player!;
  rig.tk.inventory.give("boomerang", 1, { silent: true });
  const sw = createObject(rig.session, "button", p.x + 60, p.y, { id: "sw" })!;
  rig.session.world.add(new Pickup(rig.session, p.x + 30, p.y, { item: "rupees", count: 5 }));
  useItem(rig, "boomerang");
  rig.run(2000);
  assert.equal(sw.objState, "on");
  assert.equal(rig.tk.inventory.count("rupees"), 5);
});

test("bow spends arrows and arrows damage enemies", () => {
  const rig = createRig();
  face(rig, 1, 0);
  const p = rig.host.player!;
  rig.tk.inventory.give("bow", 1, { silent: true });
  rig.tk.inventory.give("arrows", 3, { silent: true });
  const enemy = spawnEnemy(rig.session, "slime", p.x + 60, p.y, { overrides: { hp: 10, detectRange: 0, speed: 0 } })!;
  useItem(rig, "bow");
  assert.equal(rig.tk.inventory.count("arrows"), 2);
  rig.run(500);
  assert.equal(enemy.hp, 10 - rig.tk.config.items.bow.damage);
});

test("fire rod spends magic and lights torches; healing spell does nothing at full health", () => {
  const rig = createRig();
  face(rig, 1, 0);
  const p = rig.host.player!;
  rig.tk.inventory.give("fire_rod", 1, { silent: true });
  rig.tk.inventory.give("healing_spell", 1, { silent: true });
  const torch = createObject(rig.session, "torch", p.x + 40, p.y, { id: "torch_1" })!;
  const m0 = rig.tk.state.player.magic;
  useItem(rig, "fire_rod");
  rig.run(500);
  assert.equal(rig.tk.state.player.magic, m0 - rig.tk.config.items.fireRod.magicCost);
  assert.equal(torch.objState, "lit");
  const m1 = rig.tk.state.player.magic;
  rig.run(400);
  useItem(rig, "healing_spell");
  assert.equal(rig.tk.state.player.magic, m1, "no magic spent at full health");
  rig.tk.state.player.hp = 2;
  rig.run(600);
  useItem(rig, "healing_spell");
  assert.equal(rig.tk.state.player.hp, 2 + rig.tk.config.items.healingSpell.heal);
  assert.equal(rig.tk.state.player.magic, m1 - rig.tk.config.items.healingSpell.magicCost);
});

test("data-driven custom item: projectile with ice damage and magic cost", () => {
  const rig = createRig();
  face(rig, 1, 0);
  const p = rig.host.player!;
  rig.tk.items.register(createDataItem({ id: "ice_rod", resource: "magic", cost: 5, effect: "projectile", projectile: { damageType: "ice", damage: 3, stunMs: 500 } }));
  rig.tk.inventory.give("ice_rod", 1, { silent: true });
  const enemy = spawnEnemy(rig.session, "slime", p.x + 40, p.y, { overrides: { hp: 10, detectRange: 0, speed: 0 } })!;
  const m0 = rig.tk.state.player.magic;
  useItem(rig, "ice_rod");
  rig.run(400);
  assert.equal(rig.tk.state.player.magic, m0 - 5);
  assert.equal(enemy.hp, 7);
  assert.equal(errors(rig).length, 0);
});

test("items cannot be used while the ability is disabled", () => {
  const rig = createRig();
  rig.tk.inventory.give("bombs", 3, { silent: true });
  rig.tk.inventory.setAbility("bomb", false);
  const r = rig.session.items!.use("bomb");
  assert.deepEqual(r, { ok: false, reason: "disabled" });
  assert.equal(rig.tk.inventory.count("bombs"), 3);
});

test("invalid data item JSON is rejected with a clear error", () => {
  assert.throws(() => createDataItem({} as never), /needs an "id"/);
  assert.throws(() => createDataItem({ id: "x", effect: "teleport" } as never), /Unknown item effect/);
});
