import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig } from "../helpers/fakeHost.ts";
import { createObject } from "../../src/interactions/spawnObject.ts";
import { spawnEnemy } from "../../src/enemies/spawn.ts";

test("rules fire on the rising edge only, once rules are remembered in state", () => {
  const rig = createRig();
  const rules = rig.session.rules!;
  let fired = 0;
  rig.tk.ruleRegistry.registerAction("count", () => fired++);
  rules.addRule({ id: "r", when: { flag: "a" }, then: [{ count: true }], once: false, else: [] });
  rig.step();
  assert.equal(fired, 0);
  rig.tk.setFlag("a", true);
  rig.step(5);
  assert.equal(fired, 1, "not every tick");
  rig.tk.setFlag("a", false);
  rig.step();
  rig.tk.setFlag("a", true);
  rig.step();
  assert.equal(fired, 2, "fires again after the condition went false");

  rules.addRule({ id: "once", when: { flag: "b" }, then: [{ count: true }] });
  rig.tk.setFlag("b", true);
  rig.step();
  assert.equal(fired, 3);
  assert.equal(rig.tk.state.flags["rule:once"], true);
});

test("defeating every enemy of a group reveals a chest (enemiesDefeated)", () => {
  const rig = createRig();
  const chest = createObject(rig.session, "chest", 50, 50, { id: "reward", overrides: { hidden: true, contents: { item: "key", count: 1 } } })!;
  rig.session.rules!.addRule({ id: "room", when: { enemiesDefeated: "room1" }, then: [{ reveal: "reward" }] });
  rig.step();
  assert.equal(chest.visible, false, "no enemies spawned yet: condition is false, not vacuously true");
  const a = spawnEnemy(rig.session, "slime", 200, 200, { group: "room1", overrides: { detectRange: 0 } })!;
  const b = spawnEnemy(rig.session, "slime", 220, 200, { group: "room1", overrides: { detectRange: 0 } })!;
  a.die();
  rig.step();
  assert.equal(chest.visible, false);
  b.die();
  rig.step();
  assert.equal(chest.visible, true);
});

test("switch sequence: wrong order resets, correct order solves and runs actions", () => {
  const rig = createRig();
  for (const id of ["s1", "s2", "s3"]) createObject(rig.session, "button", 0, 0, { id });
  const door = createObject(rig.session, "door", 100, 100, { id: "seq_door", overrides: { lock: "switch" } })!;
  rig.session.rules!.addSequence({ id: "seq", switches: ["s1", "s2", "s3"], onSolved: [{ openDoor: "seq_door" }] });
  const sw = (id: string) => rig.session.rules!.execute([{ activateSwitch: id }], "t");
  let failed = 0;
  rig.tk.bus.on("zelda:puzzle:failed", () => failed++);
  sw("s1");
  sw("s3");
  assert.equal(failed, 1);
  assert.equal((rig.session.world.get("s1") as unknown as { objState: string }).objState, "off", "reset after mistake");
  sw("s1");
  sw("s2");
  sw("s3");
  assert.equal(door.objState, "opened");
  assert.equal(rig.tk.state.flags["puzzle:seq"], true);
});

test("wave room: doors shut during waves and open after the last wave", () => {
  const rig = createRig();
  const door = createObject(rig.session, "door", 10, 10, { id: "exit", overrides: { lock: "switch", startOpen: true } })!;
  assert.equal(door.objState, "opened");
  let cleared = 0;
  rig.tk.bus.on("zelda:wave:cleared", () => cleared++);
  rig.session.dungeons!.addWaveRoom({
    id: "arena",
    lockDoors: ["exit"],
    waves: [[{ template: "slime", x: 300, y: 300, overrides: { detectRange: 0 } }], [{ template: "slime", x: 320, y: 300, overrides: { detectRange: 0 } }, { template: "slime", x: 340, y: 300, overrides: { detectRange: 0 } }]],
    onCleared: [{ giveItem: { item: "rupees", count: 20, silent: true } }],
  });
  assert.equal(door.objState, "closed");
  const killAll = () => {
    for (const e of rig.session.world.list("enemy")) if (e.alive) (e as unknown as { die(): void }).die();
  };
  killAll();
  rig.run(800);
  assert.equal(rig.session.world.list("enemy").filter((e) => e.alive).length, 2, "second wave spawned");
  killAll();
  rig.run(800);
  assert.equal(cleared, 1);
  assert.equal(door.objState, "opened");
  assert.equal(rig.tk.inventory.count("rupees"), 20);
});

test("dungeon keys are counted per dungeon; boss completes the dungeon", () => {
  const rig = createRig();
  const d = rig.session.dungeons!;
  d.enter("d1");
  rig.tk.inventory.give("key", 2, { silent: true });
  d.enter("d2");
  assert.equal(rig.tk.inventory.count("key"), 0);
  d.enter("d1");
  assert.equal(rig.tk.inventory.count("key"), 2);
  let completed = "";
  rig.tk.bus.on("zelda:dungeon:completed", (e) => (completed = e.dungeonId));
  spawnEnemy(rig.session, "ogre", 300, 300, { id: "boss" })!.die();
  assert.equal(completed, "d1");
  assert.equal(rig.tk.state.dungeons.d1.bossDefeated, true);
});

test("unknown conditions/actions are logged and do not throw", () => {
  const rig = createRig();
  assert.equal(rig.session.rules!.evaluate({ teleported: true }), false);
  rig.session.rules!.execute([{ teleport: 1 }], "t");
  assert.ok(rig.logs.some((l) => String(l.args[1]).includes("Unknown condition")));
  assert.ok(rig.logs.some((l) => String(l.args[1]).includes('unknown action "teleport"')));
});

test("if action and nested logic", () => {
  const rig = createRig();
  rig.tk.inventory.give("bow", 1, { silent: true });
  rig.session.rules!.execute([{ if: { when: { all: [{ hasItem: "bow" }, { not: { flag: "x" } }] }, then: [{ setFlag: "ok" }], else: [{ setFlag: "bad" }] } }], "t");
  assert.equal(rig.tk.state.flags.ok, true);
  assert.equal(rig.tk.state.flags.bad, undefined);
});
