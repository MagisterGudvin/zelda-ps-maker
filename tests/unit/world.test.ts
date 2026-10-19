import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig, type TestRig } from "../helpers/fakeHost.ts";
import { createObject } from "../../src/interactions/spawnObject.ts";
import { spawnEnemy } from "../../src/enemies/spawn.ts";
import type { Interactable } from "../../src/interactions/interactable.ts";

function face(rig: TestRig, dx: number, dy: number): void {
  rig.step();
  rig.host.walk(dx, dy);
  rig.step();
}

test("chest: action key opens it once, gives the item and stays opened", () => {
  const rig = createRig();
  face(rig, 0, -1);
  const p = rig.host.player!;
  const chest = createObject(rig.session, "chest", p.x, p.y - 16, { id: "c1", overrides: { contents: { item: "arrows", count: 10 } } })!;
  let opened = 0;
  rig.tk.bus.on("zelda:chest:opened", () => opened++);
  rig.host.input.tap("action");
  rig.step();
  rig.host.input.tap("action");
  rig.step();
  assert.equal(opened, 1);
  assert.equal(rig.tk.inventory.count("arrows"), 10);
  assert.equal(chest.objState, "opened");
  assert.equal(rig.tk.state.objects["test_map/c1"], "opened");
});

test("chest needing the Big Key refuses without it", () => {
  const rig = createRig();
  face(rig, 0, -1);
  const p = rig.host.player!;
  const chest = createObject(rig.session, "chest", p.x, p.y - 16, { id: "big", overrides: { requires: { bigKey: true }, contents: { item: "bow", count: 1 } } })!;
  rig.host.input.tap("action");
  rig.step();
  assert.equal(chest.objState, "closed");
  rig.tk.inventory.give("big_key", 1, { silent: true });
  rig.host.input.tap("action");
  rig.step();
  assert.equal(chest.objState, "opened");
  assert.ok(rig.tk.inventory.owns("bow"));
});

test("locked door: walking into it spends a small key; without a key it stays shut and solid", () => {
  const rig = createRig();
  const p = rig.host.player!;
  const door = createObject(rig.session, "door", p.x + 16, p.y, { id: "d1" })!;
  face(rig, 1, 0);
  for (let i = 0; i < 10; i++) {
    rig.host.walk(1, 0);
    rig.step();
  }
  assert.equal(door.objState, "locked");
  assert.ok(rig.host.player!.x + rig.host.player!.hw <= door.x - door.hw + 0.01, "player pushed out of the closed door");
  rig.tk.inventory.give("key", 1, { silent: true });
  rig.step();
  rig.host.walk(1, 0);
  rig.step();
  rig.host.walk(1, 0);
  rig.step();
  assert.equal(door.objState, "unlocked");
  assert.equal(door.solid, false);
  assert.equal(rig.tk.inventory.count("key"), 0);
});

test("push a block onto a pressure plate and a rule opens a door", () => {
  const rig = createRig({ interactions: { pushMs: 100 } });
  const p = rig.host.player!;
  const block = createObject(rig.session, "block", p.x + 16, p.y, { id: "b1" })!;
  const plate = createObject(rig.session, "pressure_plate", p.x + 32, p.y, { id: "plate1" })!;
  const door = createObject(rig.session, "door", p.x, p.y - 64, { id: "d2", overrides: { lock: "switch" } })!;
  rig.session.rules!.addRule({ id: "r1", when: { switchOn: "plate1" }, then: [{ openDoor: "d2" }], else: [{ closeDoor: "d2" }], once: false });
  const bx0 = block.x;
  face(rig, 1, 0);
  // Keep walking into the block until it starts sliding (pushMs), then stop.
  for (let i = 0; i < 60 && block.x === bx0; i++) {
    rig.host.walk(1, 0);
    rig.step();
  }
  rig.run(400);
  assert.equal(block.x, bx0 + rig.tk.config.world.tileSize, "block moved one tile");
  assert.equal(plate.objState, "on");
  assert.equal(door.objState, "opened");
});

test("lever toggles and sets/clears its flag", () => {
  const rig = createRig();
  face(rig, 1, 0);
  const p = rig.host.player!;
  const lever = createObject(rig.session, "lever", p.x + 16, p.y, { id: "lv", overrides: { setFlag: "lever_on" } })!;
  rig.host.input.tap("action");
  rig.step();
  assert.equal(lever.objState, "on");
  assert.equal(rig.tk.state.flags.lever_on, true);
  rig.host.input.tap("action");
  rig.step();
  assert.equal(lever.objState, "off");
  assert.equal(rig.tk.state.flags.lever_on, undefined);
});

test("sword cuts bushes and grass but not rocks or pots", () => {
  const rig = createRig({ interactions: { defaultDrops: { chance: 1 } } });
  face(rig, 1, 0);
  const p = rig.host.player!;
  const bush = createObject(rig.session, "bush", p.x + 16, p.y)!;
  rig.host.input.tap("sword");
  rig.run(400);
  assert.equal(bush.objState, "destroyed");
  assert.equal(rig.session.world.list("pickup").length, 1, "bush dropped something");
  const rock = createObject(rig.session, "rock", p.x + 16, p.y)!;
  rig.host.input.tap("sword");
  rig.run(400);
  assert.equal(rock.objState, "idle");
});

test("lift and throw a pot; it shatters and damages an enemy", () => {
  const rig = createRig();
  face(rig, 1, 0);
  const p = rig.host.player!;
  const pot = createObject(rig.session, "pot", p.x + 16, p.y, { id: "pot1" })!;
  const enemy = spawnEnemy(rig.session, "slime", p.x + 60, p.y, { overrides: { hp: 10, detectRange: 0, speed: 0 } })!;
  rig.host.input.tap("action");
  rig.step();
  assert.equal(rig.session.interactions!.isCarrying(), true);
  assert.equal(pot.solid, false);
  rig.host.input.tap("action");
  rig.run(600);
  assert.equal(rig.session.interactions!.isCarrying(), false);
  assert.equal(pot.objState, "destroyed");
  assert.equal(enemy.hp, 10 - rig.tk.config.items.thrown.damage);
});

test("rocks need the glove", () => {
  const rig = createRig();
  face(rig, 1, 0);
  const p = rig.host.player!;
  createObject(rig.session, "rock", p.x + 16, p.y);
  rig.host.input.tap("action");
  rig.step();
  assert.equal(rig.session.interactions!.isCarrying(), false);
  rig.tk.inventory.give("glove", 1, { silent: true });
  rig.host.input.tap("action");
  rig.step();
  assert.equal(rig.session.interactions!.isCarrying(), true);
});

test("pits hurt and return the player to the last safe spot; spikes respect invulnerability", () => {
  const rig = createRig({ player: { knockbackSpeed: 0 } });
  const p = rig.host.player!;
  rig.step(5);
  const safe = { x: p.x, y: p.y };
  createObject(rig.session, "pit", p.x + 40, p.y, { id: "pit" });
  rig.host.player!.x += 40;
  rig.step();
  assert.deepEqual({ x: rig.host.player!.x, y: rig.host.player!.y }, safe);
  assert.equal(rig.tk.state.player.hp, rig.tk.config.player.maxHealth - 1);
  createObject(rig.session, "spikes", safe.x, safe.y + 40);
  rig.host.player!.y += 40;
  rig.run(300);
  assert.equal(rig.tk.state.player.hp, rig.tk.config.player.maxHealth - 1, "still invulnerable after the fall");
});

test("hidden objects appear when revealed and button cooldown prevents flicker", () => {
  const rig = createRig();
  const chest = createObject(rig.session, "chest", 50, 50, { id: "hidden_chest", overrides: { hidden: true } })!;
  assert.equal(chest.visible, false);
  assert.equal(chest.solid, false);
  rig.session.rules!.execute([{ reveal: "hidden_chest" }], "test");
  assert.equal(chest.visible, true);
  assert.equal(chest.solid, true);
  const btn = createObject(rig.session, "button", 80, 80, { id: "btn" }) as Interactable;
  const hit = { amount: 1, type: "sword" as const, team: "player" as const, sourceId: "p", originX: 70, originY: 80, knockback: 0, stunMs: 0, blockable: false };
  btn.receiveHit(hit);
  btn.receiveHit(hit);
  assert.equal(btn.objState, "on");
});

test("object reset restores the initial state and forgets persistence", () => {
  const rig = createRig();
  const wall = createObject(rig.session, "bombable_wall", 50, 50, { id: "w" })!;
  wall.destroy();
  assert.equal(rig.tk.state.objects["test_map/w"], "destroyed");
  wall.reset();
  assert.equal(wall.objState, "idle");
  assert.equal(wall.solid, true);
  assert.equal(rig.tk.state.objects["test_map/w"], undefined);
});
