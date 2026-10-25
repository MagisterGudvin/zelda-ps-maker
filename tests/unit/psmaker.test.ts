import { test } from "node:test";
import assert from "node:assert/strict";
import { characterFromParam, characterPlan, directionRows, findCharacter, findStory, playerAutoAnims, playerSheetAnim, sheetColumns, sheetForState, sheetImage, type PsSheet, type PsStory } from "../../src/host/psmakerAssets.ts";
import { createFakeScene } from "../helpers/fakePhaser.ts";

// Synthetic project data in the format of a PS Maker 1.2.1 story.json
// (4 rows per sheet: down, left, right, up — as in Mana Seed sheets).
const rows = (prefix: string, cols: number[]) => cols.map((n, row) => ({ id: `${prefix}${row}`, name: `Animation ${row + 1}`, startCol: 0, startRow: row, endCol: n - 1, endRow: row }));
const sheet = (id: string, name: string, owner: PsSheet["ownerRef"], cols: number[]): PsSheet => ({ id, name, src: `animation-x-${id}-asset-y-${name.replace(/\s/g, "_")}.png`, frameWidth: 64, frameHeight: 64, frameRate: 8, ownerRef: owner, animations: rows(id, cols) });

const slime = { type: "npc", id: "SLIME" };
const story: PsStory = {
  characters: [
    {
      id: "SLIME",
      name: "Slime",
      key: "slime",
      defaultAnimationSetId: "set1",
      animationSets: [{ id: "set1", animations: { movementDirections: 4, down: "base0", left: "base1", right: "base2", up: "base3", idleDown: "idl0", idleLeft: "idl1", idleRight: "idl2", idleUp: "idl3" }, collision: { enabled: true, box: { x: 26, y: 25, width: 14, height: 15 } }, depthOrigin: 38 }],
    },
  ],
  spritesheetAnimations: [
    sheet("base", "Spritesheet 1", slime, [6, 6, 6, 6]),
    sheet("run", "Slime Run", slime, [8, 8, 8, 8]),
    sheet("idl", "Slime Idle", slime, [6, 6, 6, 6]),
    sheet("atk", "Slime Attack", slime, [7, 7, 7, 7]),
    sheet("hrt", "Slime Hurt", slime, [5, 5, 5, 5]),
    sheet("die", "Slime Death", slime, [9, 9, 9, 9]),
    sheet("pw", "Spritesheet 1", { type: "player" }, [6, 6, 6, 6]),
    sheet("sa", "Sword Attack", { type: "player" }, [8, 8, 8, 8]),
    sheet("swa", "Sword Walk Attack", { type: "player" }, [6, 6, 6, 6]),
    sheet("si", "Sword Idle", { type: "player" }, [12, 12, 12, 4]),
    sheet("uh", "Unarmed Hurt", { type: "player" }, [5, 5, 5, 5]),
    sheet("sh", "Sword Hurt", { type: "player" }, [5, 5, 5, 5]),
  ],
  player: { defaultAnimationSetId: "p", animationSets: [{ id: "p", animations: { movementDirections: 8, down: "pw0", left: "pw1", right: "pw2", up: "pw3" } }] },
};

test("PS Maker data is found in the Phaser JSON cache or registry, bounded", () => {
  const cache = new Map<string, unknown>([["fonts", { a: 1 }], ["story", story]]);
  const found = findStory([{ label: "cache.json", value: cache }]);
  assert.equal(found?.story, story);
  assert.equal(found?.where, "cache.json.story");
  const nested = findStory([{ label: "game", value: { registry: { list: { data: { project: story } } } } }]);
  assert.equal(nested?.where, "game.registry.list.data.project");
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(findStory([{ label: "x", value: circular }]), null);
});

test("a PS Maker character becomes enemy animations with its row order and collision box", () => {
  const ch = findCharacter(story, "slime")!;
  assert.equal(ch.name, "Slime");
  assert.deepEqual(directionRows(story, ch.animationSets[0]), { down: 0, left: 1, right: 2, up: 3 });
  const plan = characterPlan(story, ch);
  assert.deepEqual(Object.keys(plan.states).sort(), ["attack", "death", "hurt", "idle", "walk"]);
  const walk = plan.animations[plan.states.walk!];
  assert.equal(walk.sheet, "ps_run");
  assert.equal(walk.loop, true);
  assert.equal(walk.fps, 8);
  // Row 2 (right) of an 8-column sheet: frames 16..23.
  assert.deepEqual((walk.frames as Record<string, number[]>).right, [16, 17, 18, 19, 20, 21, 22, 23]);
  assert.equal(plan.animations[plan.states.attack!].loop, false);
  // Collision box 14x15 at (26,25) in a 64x64 frame: picture moves so the box is centered on the hitbox.
  assert.deepEqual(plan.hitbox, { width: 14, height: 15, offsetX: -1, offsetY: 0 });
});

test("sheet names map to states; plain names win over compound ones", () => {
  const playerSheets = story.spritesheetAnimations.filter((s) => s.ownerRef?.type === "player");
  assert.equal(sheetForState(playerSheets, "attack")?.name, "Sword Attack");
  assert.equal(sheetForState(playerSheets, "idle")?.name, "Sword Idle");
  assert.equal(sheetColumns(playerSheets.find((s) => s.name === "Sword Idle")!), 12, "longest row");
});

test("a player sheet by name becomes a directional attack animation", () => {
  const found = playerSheetAnim(story, "sword attack")!;
  assert.equal(found.sheet.name, "Sword Attack");
  assert.deepEqual((found.anim.frames as Record<string, number[]>).up, [24, 25, 26, 27, 28, 29, 30, 31]);
  assert.equal(playerSheetAnim(story, "Kick"), null);
});

test("the character chosen in an NPC dropdown is matched whatever PS Maker passes", () => {
  for (const v of ["SLIME", "Slime", "slime", { id: "SLIME" }, { characterId: "SLIME" }, { assetId: "SLIME", name: "x" }, { texture: { key: "slime" } }, { npc: { id: "SLIME" } }]) {
    assert.equal(characterFromParam(story, v)?.id, "SLIME", JSON.stringify(v));
  }
  assert.equal(characterFromParam(story, ""), null);
  assert.equal(characterFromParam(story, { id: "nobody" }), null);
});

test("the player's attack and hurt sheets are found by name", () => {
  const auto = playerAutoAnims(story);
  assert.equal(auto.attack?.sheet.name, "Sword Attack");
  assert.equal(auto.hurt?.sheet.name, "Sword Hurt", "same set as the attack");
});

test("sheet textures are matched by id, file name or image URL", () => {
  const s = story.spritesheetAnimations[1];
  const tex = (keys: Record<string, string>) => ({
    exists: (k: string) => k in keys,
    getTextureKeys: () => Object.keys(keys),
    get: (k: string) => ({ source: [{ image: { src: keys[k] } }] }),
  });
  assert.equal(sheetImage(tex({ [s.src]: "" }), s, story), s.src);
  assert.equal(sheetImage(tex({ [`sheet:${s.id}`]: "" }), s, story), `sheet:${s.id}`);
  assert.equal(sheetImage(tex({ k1: `https://game/assets/${s.src}` }), s, story), "k1");
  // Another project image is loaded: build the URL from its folder.
  const other = story.spritesheetAnimations[0];
  assert.equal(sheetImage(tex({ k2: `https://game/assets/${other.src}` }), s, story), `https://game/assets/${s.src}`);
  assert.equal(sheetImage(tex({ unrelated: "https://x/y.png" }), s, story), null);
});

test("Create Enemy with a PS Maker character and Set Player Sprites with a PS Maker sheet", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  // PS Maker keeps its project JSON in the Phaser cache (assumption under test) and the sheet textures by file name.
  f.game.cache = { json: { entries: { entries: { story } } } };
  for (const sh of story.spritesheetAnimations) f.scene.textures.createCanvas(sh.src);
  const ctx = { game: f.game, scene: f.scene, player: f.player };
  type AnyAction = { name: string; execute(params: Record<string, unknown>, ctx: unknown): void };
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as unknown as AnyAction[]).find((e) => e.name === name)!.execute(params, ctx);
  run("Zelda: Start Toolkit", { mapId: "ps", language: "en" });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  run("Zelda: Create Enemy", { template: "slime", position: { x: 150, y: 100 }, id: "s1", character: { id: "SLIME" }, hp: 4 });
  const e = tk.session!.world.get("s1") as unknown as { hp: number; cfg: { width: number; height: number; spriteOffsetX: number; animations: Record<string, string> } };
  assert.equal(e.hp, 4);
  assert.equal(e.cfg.width, 14);
  assert.equal(e.cfg.height, 15);
  assert.equal(e.cfg.animations.walk, "ps_SLIME_walk");
  assert.equal(tk.config.sprites.sheets.ps_run?.image, story.spritesheetAnimations[1].src);

  run("Zelda: Set Player Sprites", { usePsMaker: true });
  assert.equal(tk.config.player.sprites.attack, "ps_player_attack");
  assert.equal(tk.config.sprites.animations.ps_player_attack?.sheet, "ps_sa");
  assert.equal(tk.config.sprites.animations.ps_player_hurt?.sheet, "ps_sh");

  // Missing Position (PS Maker does not save an untouched one): next to the player.
  run("Zelda: Create Enemy", { template: "slime", id: "near" });
  const near = tk.session!.world.get("near")!;
  assert.ok(Math.abs(near.x - (tk.session!.player.box.x + 32)) < 1);
  resetToolkitForTests();
});

// ---- saved map events -------------------------------------------------------------------

const startAction = { type: "plugin:zelda-maker-toolkit:zelda-start-toolkit", pluginName: "Zelda Maker Toolkit", actionName: "Zelda: Start Toolkit", pluginParams: { mapId: "start", language: "en" } };
const enemyAction = { type: "plugin:zelda-maker-toolkit:zelda-create-enemy", pluginName: "Zelda Maker Toolkit", actionName: "Zelda: Create Enemy", pluginParams: { template: "slime", id: "m_slime", position: { x: 140, y: 100 } } };
const chestAction = { type: "plugin:zelda-maker-toolkit:zelda-create-chest", pluginName: "Zelda Maker Toolkit", actionName: "Zelda: Create Chest", pluginParams: { id: "m_chest", item: "key", count: 1, position: { x: 60, y: 60 } } };
const waitAction = { type: "waitAction", name: "Wait" };

test("toolkit actions saved right after Start Toolkit are read from the map, up to the first other action", async () => {
  const { actionsAfterStart, findMap, mapActionSummary } = await import("../../src/host/psmakerAssets.ts");
  const withMap: PsStory = { ...story, maps: [{ id: "GameMap", setupActions: [{ type: "movePlayerAction", name: "Move player" }], initialActions: [startAction, enemyAction, waitAction, chestAction] }] };
  const map = findMap(withMap, "GameMap")!;
  const block = actionsAfterStart(map)!;
  assert.equal(block.list, "initialActions");
  assert.deepEqual(block.actions.map((a) => a.name), ["Zelda: Create Enemy"]);
  assert.equal(mapActionSummary(map), "setupActions: Move player; initialActions: Start Toolkit, Create Enemy, Wait, Create Chest");
  assert.equal(findMap(withMap, "other"), null);
});

async function mapRig(initialActions: unknown[]) {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  const { MAP_FALLBACK_MS } = await import("../../src/editor/actions.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  // Where PS Maker 1.2.1 keeps the project data during a playtest (seen in diagnostics).
  f.scene.sys.settings.data = { story: { ...story, maps: [{ id: "GameMap", initialActions }] } };
  const ctx = { game: f.game, scene: f.scene, player: f.player };
  type AnyAction = { name: string; execute(params: Record<string, unknown>, ctx: unknown): void };
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as unknown as AnyAction[]).find((e) => e.name === name)!.execute(params, ctx);
  const wait = () => new Promise((ok) => setTimeout(ok, MAP_FALLBACK_MS + 100));
  return { run, wait, getToolkit, done: resetToolkitForTests };
}

test("actions PS Maker does not call are run from the map data, once", async () => {
  const { run, wait, getToolkit, done } = await mapRig([startAction, enemyAction, chestAction]);
  run("Zelda: Start Toolkit", startAction.pluginParams);
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  assert.equal(tk.session!.world.count("enemy"), 0);
  await wait();
  assert.ok(tk.session!.world.get("m_slime"), "enemy created from the saved action");
  assert.ok(tk.session!.world.get("m_chest"), "chest created from the saved action");
  assert.match(tk.logger.history.filter((l) => l.level === "warn").at(-1)!.text, /PS Maker did not call Create Enemy, Create Chest/);
  assert.equal(tk.actionCounts.get("Create Enemy (map data)"), 1);
  // PS Maker calls it after all: skipped, no second enemy.
  run("Zelda: Create Enemy", enemyAction.pluginParams);
  assert.equal(tk.session!.world.count("enemy"), 1);
  done();
});

test("actions PS Maker does call are not run twice", async () => {
  const { run, wait, getToolkit, done } = await mapRig([startAction, enemyAction]);
  run("Zelda: Start Toolkit", startAction.pluginParams);
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  run("Zelda: Create Enemy", enemyAction.pluginParams);
  await wait();
  assert.equal(tk.session!.world.count("enemy"), 1);
  assert.equal(tk.actionCounts.get("Create Enemy (map data)"), undefined);
  done();
});
