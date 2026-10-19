import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig } from "../helpers/fakeHost.ts";
import { createObject } from "../../src/interactions/spawnObject.ts";
import { SAVE_FORMAT, SAVE_VERSION, createMemoryStorage } from "../../src/save/save.ts";
import { Toolkit } from "../../src/core/toolkit.ts";
import { FakeHost } from "../helpers/fakeHost.ts";

test("save and load restore health, items, resources, abilities, flags, objects and dungeons", () => {
  const storage = createMemoryStorage();
  const rig = createRig({}, { storage });
  const tk = rig.tk;
  tk.inventory.give("bow", 1, { silent: true });
  tk.inventory.give("arrows", 12, { silent: true });
  tk.inventory.give("heart_container", 1, { silent: true });
  tk.inventory.setAbility("bow", false);
  rig.session.dungeons!.enter("d1");
  tk.inventory.give("key", 2, { silent: true });
  tk.setFlag("met_sage", true);
  const chest = createObject(rig.session, "chest", 10, 10, { id: "c", overrides: { contents: { item: "rupees", count: 50 } } })!;
  chest.open();
  tk.state.player.hp = 3;
  assert.equal(tk.saves.save(), true);

  // A fresh toolkit (new page load) reading the same storage.
  const tk2 = new Toolkit({ storage, logSink: { debug() {}, info() {}, warn() {}, error() {} } });
  tk2.configure({ publicApi: false });
  assert.equal(tk2.saves.load(), true);
  const s = tk2.state;
  assert.equal(s.player.hp, 3);
  assert.equal(s.player.maxHp, 8);
  assert.ok(s.inventory.owned.includes("bow"));
  assert.equal(s.inventory.counts.arrows, 12);
  assert.equal(s.inventory.counts.rupees, 50);
  assert.equal(s.abilities.bow, false);
  assert.equal(s.flags.met_sage, true);
  assert.equal(s.objects["test_map/c"], "opened");
  assert.equal(s.dungeons.d1.keys, 2);
  assert.equal(s.currentDungeon, "d1");

  // Objects on the new map come back in their saved state.
  const session2 = tk2.start(new FakeHost(), "test_map");
  const chest2 = createObject(session2, "chest", 10, 10, { id: "c", overrides: { contents: { item: "rupees", count: 50 } } })!;
  assert.equal(chest2.objState, "opened");
});

test("loading while on a map re-syncs objects already placed", () => {
  const rig = createRig();
  const door = createObject(rig.session, "door", 10, 10, { id: "d" })!;
  rig.tk.saves.save();
  rig.tk.inventory.give("key", 1, { silent: true });
  door.tryUnlock(false);
  assert.equal(door.objState, "unlocked");
  rig.tk.saves.load({ silent: true });
  assert.equal(door.objState, "locked");
  assert.equal(door.solid, true);
});

test("corrupted, foreign and newer saves are rejected without throwing", () => {
  const rig = createRig();
  const key = rig.tk.saves.key();
  rig.storage.setItem(key, "{not json");
  assert.equal(rig.tk.saves.load(), false);
  rig.storage.setItem(key, JSON.stringify({ format: "other", version: 1, state: {} }));
  assert.equal(rig.tk.saves.load(), false);
  rig.storage.setItem(key, JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION + 1, state: {} }));
  assert.equal(rig.tk.saves.load(), false);
  assert.equal(rig.logs.filter((l) => l.level === "error").length, 3);
});

test("old/partial saves load with safe defaults", () => {
  const rig = createRig();
  rig.storage.setItem(
    rig.tk.saves.key(),
    JSON.stringify({ format: SAVE_FORMAT, version: 1, state: { player: { hp: -5, maxHp: "lots" }, inventory: { owned: ["bow", 7, "bow"], counts: { arrows: 5.4, bombs: "x" }, activeItem: "hammer" }, flags: { a: true, b: { nested: 1 } } } }),
  );
  assert.equal(rig.tk.saves.load({ silent: true }), true);
  const s = rig.tk.state;
  assert.equal(s.player.maxHp, rig.tk.config.player.maxHealth);
  assert.ok(s.player.hp > 0, "never loads into a death loop");
  assert.deepEqual(s.inventory.owned, ["bow"]);
  assert.deepEqual(s.inventory.counts, { arrows: 5 });
  assert.equal(s.inventory.activeItem, null);
  assert.deepEqual(s.flags, { a: true });
  assert.deepEqual(s.dungeons, {});
});

test("saving is skipped cleanly when no storage is available", () => {
  const tk = new Toolkit({ storage: null, logSink: { debug() {}, info() {}, warn() {}, error() {} } });
  tk.configure({ publicApi: false });
  assert.equal(tk.saves.available, false);
  assert.equal(tk.saves.save(), false);
  assert.equal(tk.saves.load(), false);
});
