import { test } from "node:test";
import assert from "node:assert/strict";
import { characterFromParam, characterPlan, directionRows, storyOfScene, sheetColumns, sheetForState, sheetImage, type PsSheet, type PsStory } from "../../src/host/psmakerAssets.ts";
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

test("PS Maker data is the map scene's story (GameMap.init), in the game and the editor", () => {
  assert.equal(storyOfScene({ story }), story);
  assert.equal(storyOfScene({ sys: { settings: { data: { story } } } }), story);
  assert.equal(storyOfScene({ story: { characters: "no" } }), null);
  assert.equal(storyOfScene(null), null);
});

test("a PS Maker character becomes enemy animations with its row order and collision box", () => {
  const ch = characterFromParam(story, "SLIME")!;
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

test("frame numbers follow the texture width when it is known (PS Maker numbering)", () => {
  const ch = characterFromParam(story, "SLIME")!;
  // Run sheet: rows of 8 frames, but the image is 10 frames wide.
  const plan = characterPlan(story, ch, (sh) => (sh.id === "run" ? 10 : null));
  assert.deepEqual((plan.animations[plan.states.walk!].frames as Record<string, number[]>).right, [20, 21, 22, 23, 24, 25, 26, 27]);
});

test("sheet names map to states; plain names win over compound ones", () => {
  const playerSheets = story.spritesheetAnimations.filter((s) => s.ownerRef?.type === "player");
  assert.equal(sheetForState(playerSheets, "attack")?.name, "Sword Attack");
  assert.equal(sheetForState(playerSheets, "idle")?.name, "Sword Idle");
  assert.equal(sheetColumns(playerSheets.find((s) => s.name === "Sword Idle")!), 12, "longest row");
});

test("the character chosen in an NPC dropdown is its library id", () => {
  assert.equal(characterFromParam(story, "SLIME")?.name, "Slime");
  assert.equal(characterFromParam(story, "Slime"), null, "a name is not an id");
  assert.equal(characterFromParam(story, ""), null);
  assert.equal(characterFromParam(story, { id: "SLIME" }), null);
});

test("a sheet's texture is the one PS Maker loads for its animations: <animationId>frames", () => {
  const s = story.spritesheetAnimations[1];
  const tex = (keys: string[]) => ({ exists: (k: string) => keys.includes(k) });
  assert.equal(sheetImage(tex(["run2frames", s.src]), s), "run2frames");
  assert.equal(sheetImage(tex([s.src]), s), null, "a file name is not a PS Maker texture key");
});

test("Create Enemy with a PS Maker character and Set Player Sprites with a PS Maker sheet", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  // GameMap keeps the project data as scene.story; PS Maker loads each animation as "<animationId>frames".
  f.scene.story = story;
  for (const sh of story.spritesheetAnimations) for (const a of sh.animations) f.scene.textures.createCanvas(`${a.id}frames`);
  const ctx = { game: f.game, scene: f.scene, player: f.player };
  type AnyAction = { name: string; execute(params: Record<string, unknown>, ctx: unknown): void };
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as unknown as AnyAction[]).find((e) => e.name === name)!.execute(params, ctx);
  run("Zelda: Start Toolkit", { mapId: "ps", language: "en" });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  run("Zelda: Create Enemy", { template: "slime", position: { x: 150, y: 100 }, id: "s1", character: "SLIME", hp: 4 });
  const e = tk.session!.world.get("s1") as unknown as { hp: number; cfg: { width: number; height: number; spriteOffsetX: number; animations: Record<string, string> } };
  assert.equal(e.hp, 4);
  assert.equal(e.cfg.width, 14);
  assert.equal(e.cfg.height, 15);
  assert.equal(e.cfg.animations.walk, "ps_SLIME_walk");
  assert.equal(tk.config.sprites.sheets.ps_run?.image, `${story.spritesheetAnimations[1].animations[0].id}frames`);

  // Picked in the editor's player-animation picker: one row (Sword Attack facing left) → all directions.
  run("Zelda: Set Player Sprites", { attack: "sa1", hurt: "sh0" });
  assert.equal(tk.config.player.sprites.attack, "ps_anim_sa1");
  assert.equal(tk.config.sprites.animations.ps_anim_sa1?.sheet, "ps_sa");
  assert.equal(tk.config.sprites.animations.ps_anim_sh0?.sheet, "ps_sh");
  run("Zelda: Set Player Sprites", { attack: "sa2", hurt: "", spin: "" });
  assert.equal(tk.config.player.sprites.attack, "ps_anim_sa2");

  // Missing Position (PS Maker does not save an untouched one): next to the player.
  run("Zelda: Create Enemy", { template: "slime", id: "near" });
  const near = tk.session!.world.get("near")!;
  assert.ok(Math.abs(near.x - (tk.session!.player.box.x + 32)) < 1);
  resetToolkitForTests();
});

// ---- PS Maker StoryRunner contract ------------------------------------------------------

type AnyAction = { name: string; execute(params: Record<string, unknown>, ctx: unknown): void };

/**
 * Minimal model of PS Maker 1.2.1's StoryRunner: actions of one event run in order,
 * each waiting for ctx.endAction(); errors are logged and end the action.
 */
async function playEvent(actions: AnyAction[], list: [string, Record<string, unknown>][], base: Record<string, unknown>, timeoutMs = 200): Promise<string[]> {
  const finished: string[] = [];
  for (const [name, params] of list) {
    const def = actions.find((e) => e.name === name)!;
    const ended = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      const endAction = () => {
        clearTimeout(timer);
        resolve(true);
      };
      try {
        def.execute(params, { ...base, endAction });
      } catch {
        endAction();
      }
    });
    if (!ended) break; // the event would wait forever
    finished.push(name);
  }
  return finished;
}

test("every action ends itself (ctx.endAction) exactly once, also on errors", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  const base = { game: f.game, scene: f.scene, player: f.player };
  const actions = plugin.events as unknown as AnyAction[];
  const counts = new Map<string, number>();
  for (const a of actions) {
    a.execute({}, { ...base, endAction: () => counts.set(a.name, (counts.get(a.name) ?? 0) + 1) });
    if (a.name === "Zelda: Start Toolkit") getToolkit().configure({ debug: { logLevel: "silent" } });
  }
  for (const a of actions) assert.equal(counts.get(a.name), 1, `${a.name} called endAction ${counts.get(a.name) ?? 0} times`);
  // Also when the action body throws.
  getToolkit().configure({ debug: { rethrowErrors: true } });
  let ended = 0;
  const broken = { ...base, endAction: () => ended++ };
  Object.defineProperty(broken, "player", { get: () => { throw new Error("broken context"); } });
  getToolkit().stop("test");
  assert.throws(() => actions.find((e) => e.name === "Zelda: Create Enemy")!.execute({ template: "slime" }, broken), /broken context/);
  assert.equal(ended, 1);
  resetToolkitForTests();
});

test("in a PS Maker event, Create Enemy now runs after Start Toolkit", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  const base = { game: f.game, scene: f.scene, player: f.player };
  const done = await playEvent(plugin.events as unknown as AnyAction[], [
    ["Zelda: Start Toolkit", { mapId: "start", language: "en" }],
    ["Zelda: Create Enemy", { template: "slime", id: "e1", position: { x: 140, y: 100 } }],
    ["Zelda: Create Chest", { id: "c1", item: "key", count: 1, position: { x: 60, y: 60 } }],
  ], base);
  assert.deepEqual(done, ["Zelda: Start Toolkit", "Zelda: Create Enemy", "Zelda: Create Chest"]);
  assert.ok(getToolkit().session!.world.get("e1"));
  assert.ok(getToolkit().session!.world.get("c1"));
  resetToolkitForTests();
});

test("combat pauses while a PS Maker dialogue is open (GameMap.playingDialogue)", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  const ctx = { game: f.game, scene: f.scene, player: f.player, endAction: () => {} };
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as unknown as AnyAction[]).find((e) => e.name === name)!.execute(params, ctx);
  run("Zelda: Start Toolkit", { mapId: "d", language: "en" });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  const s = tk.session!;
  s.update(20);
  assert.equal(s.isPaused("dialogue"), false);
  f.scene.playingDialogue = true;
  s.update(20);
  assert.equal(s.isPaused("dialogue"), true);
  f.scene.playingDialogue = false;
  s.update(20);
  assert.equal(s.isPaused(), false);
  tk.configure({ combat: { pauseDuringDialogue: false } });
  f.scene.playingDialogue = true;
  s.update(20);
  assert.equal(s.isPaused(), false, "can be turned off");
  resetToolkitForTests();
});
