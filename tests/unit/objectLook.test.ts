import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeScene } from "../helpers/fakePhaser.ts";
import { fillMapObjectOptions, MAP_OBJECT_OPTIONS } from "../../src/editor/fields.ts";
import { mapObjectLook, type PsStory } from "../../src/host/psmakerAssets.ts";

type AnyAction = { name: string; parameterDefs: Record<string, any>; execute(p: unknown, c: unknown): void };

// A map object library as PS Maker 1.2.1 saves it (story.mapObjects); pictures are loaded as
// textures under the map object id ("<id>_frames" for animated ones).
const story: PsStory = {
  characters: [],
  spritesheetAnimations: [],
  mapObjects: [
    { id: "BUSH", name: "Small Bush", type: "static", collision: { enabled: true, box: { x: 3, y: 4, width: 10, height: 10 } } },
    { id: "STUMP", name: "Short Stump", type: "static", collision: { enabled: true, box: { x: 9, y: 13, width: 16, height: 13 } } },
    { id: "CRATE", name: "Crate", type: "static", collision: { enabled: true, box: { x: 2, y: 17, width: 11, height: 11 } } },
    { id: "TORCH", name: "Torch", type: "animated", animationConfig: { frameWidth: 16, frameHeight: 32 } },
    { id: "ROCK1", name: "Rock" },
    { id: "ROCK2", name: "Rock" },
  ],
};
const SIZES: Record<string, { width: number; height: number }> = { BUSH: { width: 16, height: 16 }, STUMP: { width: 32, height: 32 }, CRATE: { width: 16, height: 32 }, TORCH_frames: { width: 16, height: 32 } };

async function setup() {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  f.scene.sys.settings.data = { story };
  for (const k of Object.keys(SIZES)) f.textures.add(k);
  f.scene.textures.getFrame = (key: string) => SIZES[key] ?? null;
  const ctx = { game: f.game, scene: f.scene, player: f.player };
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as unknown as AnyAction[]).find((e) => e.name === name)!.execute(params, ctx);
  run("Zelda: Start Toolkit", { mapId: "looks", language: "en" });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  return { run, s: tk.session!, done: resetToolkitForTests, plugin };
}
const cfgOf = (s: any, id: string) => s.world.get(id)?.cfg;

test("a map object as an object's look: its picture at natural size, its collision box as the body", async () => {
  const { run, s, done } = await setup();
  run("Zelda: Create Object", { type: "bush", position: { x: 100, y: 100 }, look: "BUSH", lookUsed: "STUMP" });
  const bush = s.world.get("bush@100,100") as any;
  assert.equal(bush.cfg.sprite, "BUSH");
  assert.equal(bush.cfg.activeSprite, "STUMP");
  assert.deepEqual([bush.hw * 2, bush.hh * 2], [10, 10], "body = the map object's collision box");
  assert.deepEqual([bush.cfg.spriteOffsetX, bush.cfg.spriteOffsetY], [0, -1], "picture placed around the body like a PS Maker map object");
  assert.equal(bush.cfg.spriteScale, 1, "natural size, not stretched to the body");
  bush.destroy();
  assert.equal(bush.visible, true, "a chosen after-use look stays: the stump");
  run("Zelda: Create Object", { type: "pot", position: { x: 140, y: 100 } });
  const pot = s.world.get("pot@140,100") as any;
  pot.destroy();
  assert.equal(pot.visible, false, "without one the object vanishes as before");
  // An explicit size wins over the collision box.
  run("Zelda: Create Object", { type: "rock", position: { x: 180, y: 100 }, look: "CRATE", width: 16, height: 16 });
  assert.deepEqual([cfgOf(s, "rock@180,100").width, cfgOf(s, "rock@180,100").height, cfgOf(s, "rock@180,100").spriteOffsetX], [16, 16, 0]);
  done();
});

test("chests, doors and items take a look; animated map objects show their first frame; unknown ids warn", async () => {
  const { run, s, done } = await setup();
  run("Zelda: Create Chest", { position: { x: 60, y: 60 }, item: "arrows", count: 5, look: "CRATE", lookOpen: "STUMP" });
  const chest = cfgOf(s, "chest@60,60");
  assert.deepEqual([chest.sprite, chest.activeSprite, chest.width, chest.height, chest.spriteOffsetY], ["CRATE", "STUMP", 11, 11, -6]);
  run("Zelda: Create Door", { position: { x: 90, y: 60 }, lock: "none", look: "TORCH" });
  assert.equal(cfgOf(s, "door@90,60").sprite, "TORCH_frames#0", "sheet texture, first frame");
  run("Zelda: Place Item", { item: "key", position: { x: 120, y: 60 }, look: "CRATE" });
  const pickup = s.world.list("pickup")[0] as any;
  assert.ok(pickup, "item placed");
  run("Zelda: Create Object", { type: "bush", position: { x: 150, y: 60 }, look: "NOPE" });
  assert.equal(cfgOf(s, "bush@150,60").sprite, "obj_bush", "unknown map object: built-in sprite");
  assert.ok(s.logger.history.some((h: any) => /map object "NOPE" is not in the project/.test(h.text)));
  done();
});

test("the Look dropdowns list the project's map objects (filled in the editor)", async () => {
  const { plugin } = await setup();
  const field = (plugin.events as unknown as AnyAction[]).find((e) => e.name === "Zelda: Create Chest")!.parameterDefs.look;
  assert.equal(field.options, MAP_OBJECT_OPTIONS, "the form reads this very list");
  assert.ok(fillMapObjectOptions(story.mapObjects));
  assert.deepEqual(MAP_OBJECT_OPTIONS.map((o) => o.label), ["Built-in", "Small Bush", "Short Stump", "Crate", "Torch", "Rock", "Rock (2)"]);
  assert.equal(fillMapObjectOptions(story.mapObjects), false, "unchanged: nothing to do");
  assert.equal(mapObjectLook(story, "Crate")?.sprite, "CRATE", "also found by name");
  fillMapObjectOptions([]);
});
