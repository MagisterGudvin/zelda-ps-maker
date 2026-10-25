import { test } from "node:test";
import assert from "node:assert/strict";
import { characterPlan, directionRows, findCharacter, findStory, playerSheetAnim, sheetColumns, sheetForState, sheetImage, type PsSheet, type PsStory } from "../../src/host/psmakerAssets.ts";
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
  run("Zelda: Create Enemy", { template: "slime", position: { x: 150, y: 100 }, id: "s1", character: "Slime", hp: 4 });
  const e = tk.session!.world.get("s1") as unknown as { hp: number; cfg: { width: number; height: number; spriteOffsetX: number; animations: Record<string, string> } };
  assert.equal(e.hp, 4);
  assert.equal(e.cfg.width, 14);
  assert.equal(e.cfg.height, 15);
  assert.equal(e.cfg.animations.walk, "ps_SLIME_walk");
  assert.equal(tk.config.sprites.sheets.ps_run?.image, story.spritesheetAnimations[1].src);

  run("Zelda: Set Player Sprites", { attackSheet: "Sword Attack" });
  assert.equal(tk.config.player.sprites.attack, "ps_player_attack");
  assert.equal(tk.config.sprites.animations.ps_player_attack?.sheet, "ps_sa");

  // Missing Position (PS Maker does not save an untouched one): next to the player.
  run("Zelda: Create Enemy", { template: "slime", id: "near" });
  const near = tk.session!.world.get("near")!;
  assert.ok(Math.abs(near.x - (tk.session!.player.box.x + 32)) < 1);
  resetToolkitForTests();
});
