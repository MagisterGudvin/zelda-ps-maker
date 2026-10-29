import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig } from "../helpers/fakeHost.ts";
import { createObject } from "../../src/interactions/spawnObject.ts";
import { SAVE_FORMAT, SAVE_VERSION, parseProgress, serializeProgress } from "../../src/save/save.ts";
import { Toolkit } from "../../src/core/toolkit.ts";
import { FakeHost } from "../helpers/fakeHost.ts";

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

test("progress text restores health, items, resources, abilities, flags, objects and dungeons", () => {
  const rig = createRig();
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
  const text = serializeProgress(tk.state);
  assert.equal(serializeProgress(tk.state), text, "unchanged progress, same text");

  // A fresh toolkit (a PS Maker save loaded on a new page).
  const tk2 = new Toolkit({ logSink: quiet });
  tk2.configure({ publicApi: false });
  assert.equal(tk2.restoreProgress(text), true);
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

test("restoring while on a map re-syncs objects already placed", () => {
  const rig = createRig();
  const door = createObject(rig.session, "door", 10, 10, { id: "d" })!;
  const text = serializeProgress(rig.tk.state);
  rig.tk.inventory.give("key", 1, { silent: true });
  door.tryUnlock(false);
  assert.equal(door.objState, "unlocked");
  rig.tk.restoreProgress(text);
  assert.equal(door.objState, "locked");
  assert.equal(door.solid, true);
});

test("corrupted, foreign and newer progress is rejected without throwing", () => {
  const rig = createRig();
  assert.equal(rig.tk.restoreProgress("{not json"), false);
  assert.equal(rig.tk.restoreProgress(JSON.stringify({ format: "other", version: 1, state: {} })), false);
  assert.equal(rig.tk.restoreProgress(JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION + 1, state: {} })), false);
  assert.equal(rig.logs.filter((l) => l.level === "error").length, 3);
});

test("old/partial progress loads with safe defaults", () => {
  const rig = createRig();
  const raw = JSON.stringify({ format: SAVE_FORMAT, version: 1, state: { player: { hp: -5, maxHp: "lots" }, inventory: { owned: ["bow", 7, "bow"], counts: { arrows: 5.4, bombs: "x" }, activeItem: "hammer" }, flags: { a: true, b: { nested: 1 } } } });
  const s = parseProgress(raw, rig.tk.config, rig.tk.logger)!;
  assert.equal(s.player.maxHp, rig.tk.config.player.maxHealth);
  assert.ok(s.player.hp > 0, "never loads into a death loop");
  assert.deepEqual(s.inventory.owned, ["bow"]);
  assert.deepEqual(s.inventory.counts, { arrows: 5 });
  assert.equal(s.inventory.activeItem, null);
  assert.deepEqual(s.flags, { a: true });
  assert.deepEqual(s.dungeons, {});
});
