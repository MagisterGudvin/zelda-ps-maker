import { test } from "node:test";
import assert from "node:assert/strict";
import { createDefaultConfig, mergeConfig } from "../../src/core/config.ts";
import { createRig } from "../helpers/fakeHost.ts";
import { assetId, resolveNpc, resolvePosition } from "../../src/editor/paramResolvers.ts";
import { KeyboardInput, normalizeKey } from "../../src/host/keyboardInput.ts";
import { FakeEmitter } from "../helpers/fakePhaser.ts";
import { builtinSpriteIds, resolveTexture } from "../../src/host/textures.ts";
import { chainable } from "../helpers/fakePhaser.ts";
import { SpatialHash } from "../../src/core/spatialHash.ts";
import { facingFromVector, penetration } from "../../src/core/math.ts";

test("config merge validates keys and types and keeps defaults on bad input", () => {
  const cfg = createDefaultConfig();
  const issues = mergeConfig(cfg, { sword: { damage: 5, dammage: 1, range: "far" }, inventory: { capacities: { seeds: 20 } }, controls: { sword: "Space" } });
  assert.equal(cfg.sword.damage, 5);
  assert.equal(cfg.sword.range, 18);
  assert.equal(cfg.inventory.capacities.seeds, 20, "open records accept new keys");
  assert.deepEqual(cfg.controls.sword, ["KeyX"]);
  assert.deepEqual(
    issues.map((i) => i.path),
    ["sword.dammage", "sword.range", "controls.sword"],
  );
});

test("presets and language apply", () => {
  const rig = createRig();
  assert.equal(rig.tk.applyPreset("casual"), true);
  assert.equal(rig.tk.config.player.maxHealth, 10);
  assert.equal(rig.tk.applyPreset("nope"), false);
  rig.tk.configure({ language: "ru" });
  assert.equal(rig.tk.i18n.t("msg.got_item", { item: "Лук" }), "Получено: Лук!");
  rig.tk.configure({ language: "en" });
  assert.equal(rig.tk.i18n.text({ en: "Ice Rod", ru: "Ледяной жезл" }), "Ice Rod");
});

test("inventory: capacities, quick-item cycling, keys, heart containers", () => {
  const rig = createRig();
  const inv = rig.tk.inventory;
  inv.give("bombs", 50, { silent: true });
  assert.equal(inv.count("bombs"), 10, "capped at capacity");
  assert.ok(inv.owns("bomb"), "bombs unlock the bomb item");
  inv.give("bow", 1, { silent: true });
  inv.give("boomerang", 1, { silent: true });
  assert.deepEqual(inv.quickItems(), ["bow", "boomerang", "bomb"]);
  inv.equip("bow");
  assert.equal(inv.cycle(1), "boomerang");
  assert.equal(inv.cycle(1), "bomb");
  assert.equal(inv.cycle(1), "bow");
  assert.equal(inv.cycle(-1), "bomb");
  assert.equal(inv.spend("arrows", 1), false);
  const max = rig.tk.state.player.maxHp;
  inv.give("heart_container", 1, { silent: true });
  assert.equal(rig.tk.state.player.maxHp, max + rig.tk.config.player.heartValue);
  assert.equal(rig.tk.state.player.hp, rig.tk.state.player.maxHp);
  const messages: string[] = [];
  rig.tk.bus.on("zelda:message", (m) => messages.push(m.text));
  inv.give("glove");
  assert.deepEqual(messages, ["You got Power Glove!"]);
});

test("HUD model reflects hearts, magic, counters and the active item", () => {
  const rig = createRig();
  rig.tk.inventory.give("bombs", 4, { silent: true });
  rig.tk.state.player.hp = 3;
  rig.tk.bus.emit("zelda:custom:refresh", {});
  rig.step();
  const m = rig.host.hud.last!;
  assert.equal(m.hp, 3);
  assert.equal(m.maxHp, 6);
  assert.equal(m.activeItem?.itemId, "bomb");
  assert.equal(m.activeItem?.count, 4);
  assert.deepEqual(
    m.counters.map((c) => [c.id, c.value]),
    [
      ["rupees", 0],
      ["bombs", 4],
      ["arrows", 0],
      ["keys", 0],
    ],
  );
  const renders = rig.host.hud.renders;
  rig.step(10);
  assert.equal(rig.host.hud.renders, renders, "no re-render when nothing changed");
});

test("param resolvers read the values PS Maker 1.2.1 saves: { x, y }, an in-map NPC id, an asset id", () => {
  const cfg = createDefaultConfig();
  assert.deepEqual(resolvePosition({ x: 10, y: 20 }, cfg), { x: 10, y: 20 });
  assert.equal(resolvePosition(undefined, cfg), null);
  assert.equal(resolvePosition({ x: "1", y: 2 }, cfg), null, "not numbers");
  cfg.world.positionUnits = "tiles";
  assert.deepEqual(resolvePosition({ x: 2, y: 3 }, cfg), { x: 40, y: 56 });
  // GameMap.NPCs: the map's NPC sprites, each with its inGameCharacterId.
  const npc = { inGameCharacterId: "in-game-character-1", x: 5, y: 6 };
  const scene = { NPCs: [{ inGameCharacterId: "in-game-character-2" }, npc] };
  assert.equal(resolveNpc("in-game-character-1", scene), npc);
  assert.equal(resolveNpc("missing", scene), null);
  assert.equal(resolveNpc("in-game-character-1", {}), null, "no NPC list");
  assert.equal(assetId("IMG1"), "IMG1");
  assert.equal(assetId(undefined), "");
});

test("keyboard input latches taps between ticks and maps friendly key names", () => {
  assert.equal(normalizeKey("x"), "KeyX");
  assert.equal(normalizeKey("ShiftLeft"), "Shift");
  const kb = new FakeEmitter();
  const cfg = createDefaultConfig();
  cfg.controls.sword = ["x"];
  const input = new KeyboardInput(cfg, kb, null, () => null);
  kb.emit("keydown", { code: "KeyX" });
  kb.emit("keyup", { code: "KeyX" });
  input.latch();
  assert.equal(input.pressed("sword"), true, "a tap shorter than a tick is not lost");
  assert.equal(input.isDown("sword"), false);
  input.latch();
  assert.equal(input.pressed("sword"), false, "reported once");
  kb.emit("keydown", { code: "KeyX" });
  kb.emit("keydown", { code: "KeyX" }); // key repeat
  input.latch();
  input.latch();
  assert.equal(input.pressed("sword"), false, "auto-repeat is not a new press");
  assert.equal(input.isDown("sword"), true);
  input.dispose();
  assert.equal(kb.count(), 0);
});

test("every built-in sprite paints without throwing", () => {
  const made = new Set<string>();
  const tm = {
    exists: (k: string) => made.has(k),
    createCanvas: (k: string) => {
      made.add(k);
      return { context: chainable(), refresh: () => {} };
    },
  };
  for (const id of builtinSpriteIds()) assert.equal(resolveTexture(tm, id), `zmt_${id}`);
  assert.equal(resolveTexture(tm, "author_texture"), null);
  made.add("author_texture");
  assert.equal(resolveTexture(tm, "author_texture"), "author_texture", "author textures win");
});

test("math helpers", () => {
  assert.equal(facingFromVector(1, 1, "right"), "right", "diagonal keeps matching facing");
  assert.equal(facingFromVector(1, 1, "up"), "right");
  assert.equal(facingFromVector(0, -2, "left"), "up");
  const out = { x: 0, y: 0 };
  assert.equal(penetration({ x: 0, y: 0, hw: 5, hh: 5 }, { x: 8, y: 0, hw: 5, hh: 5 }, out), true);
  assert.deepEqual(out, { x: -2, y: 0 });
  const h = new SpatialHash<{ x: number; y: number; hw: number; hh: number; id: number }>(16);
  const a = { x: 0, y: 0, hw: 20, hh: 20, id: 1 };
  h.insert(a);
  const res: (typeof a)[] = [];
  h.query({ x: 0, y: 0, hw: 30, hh: 30 }, res);
  assert.equal(res.length, 1, "multi-cell items are returned once");
});

test("keys pressed while PS Maker pauses the game (options menu) do nothing after it resumes", () => {
  const kb = new FakeEmitter();
  const game = new FakeEmitter();
  const cfg = createDefaultConfig();
  cfg.controls.sword = ["x"];
  const input = new KeyboardInput(cfg, kb, game, () => null);
  const t0 = performance.now();
  game.emit("pause");
  const inMenu = performance.now();
  game.emit("resume");
  // Phaser delivers the queued event after the resume; its time says it was pressed in the menu.
  kb.emit("keydown", { code: "KeyX", timeStamp: inMenu });
  input.latch();
  assert.equal(input.pressed("sword"), false);
  kb.emit("keyup", { code: "KeyX", timeStamp: inMenu });
  kb.emit("keydown", { code: "KeyX", timeStamp: performance.now() + 1 });
  input.latch();
  assert.equal(input.pressed("sword"), true, "a press after the menu counts");
  assert.ok(t0 <= inMenu);
  input.dispose();
  assert.equal(game.count(), 0);
});

test("held movement keys give a facing hint (facing a wall without moving)", () => {
  const kb = new FakeEmitter();
  const input = new KeyboardInput(createDefaultConfig(), kb, null, () => null);
  assert.equal(input.directionHint("down"), null);
  kb.emit("keydown", { code: "ArrowUp" });
  assert.equal(input.directionHint("down"), "up");
  kb.emit("keydown", { code: "KeyD" });
  assert.equal(input.directionHint("up"), "up", "keeps the current facing while it is still held");
  assert.equal(input.directionHint("down"), "right", "otherwise the latest direction");
  kb.emit("keyup", { code: "ArrowUp" });
  kb.emit("keyup", { code: "KeyD" });
  assert.equal(input.directionHint("right"), null);
  input.dispose();
});
