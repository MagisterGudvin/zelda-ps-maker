import { test } from "node:test";
import assert from "node:assert/strict";
import { actionRoute, previewItems, startEditorPreview, zeldaActions, type PreviewItem } from "../../src/editor/editorPreview.ts";
import { buildDemoStory, DEMO_ASSETS } from "../../scripts/demo-project.mjs";
import { MAPS } from "../../examples/harness/demo-maps.js";
import { createFakeScene } from "../helpers/fakePhaser.ts";

type Any = any;

/** The demo project as PS Maker saves it (library entries carry only what the preview reads). */
async function demo(): Promise<Any> {
  const named = (names: Record<string, string>) => Object.values(names).map((name, i) => ({ id: `${name.replace(/\W/g, "")}${i}`, name, animationSets: [] }));
  const source = { controls: {}, metadata: { schemaVersion: 32 }, gameUI: {}, characters: named(DEMO_ASSETS.characters), spritesheetAnimations: [], terrains: named(DEMO_ASSETS.terrains), terrainTilesets: [], mapObjects: named(DEMO_ASSETS.objects), player: {}, gameConfig: {} };
  const { default: plugin } = await import("../../src/index.ts");
  return buildDemoStory({ source, plugin, maps: MAPS, seed: 1 }).story;
}
const sprites = (items: PreviewItem[]) => items.filter((i): i is Extract<PreviewItem, { kind: "sprite" }> => i.kind === "sprite");

test("editor preview: what the field's Zelda actions create, with PS Maker looks", async () => {
  const story = await demo();
  const field = story.maps[0];
  assert.equal(zeldaActions(field).length, field.initialActions.filter((a: Any) => a.pluginName).length);
  const items = previewItems(field, story);
  const slime = sprites(items).find((s) => s.label === "slime G1")!;
  assert.deepEqual([slime.x, slime.y, slime.look?.name], [230, 120, "Slime"]);
  assert.equal(sprites(items).find((s) => s.label === "soldier G1")?.look?.name, "New Male");
  assert.ok(items.some((i) => i.kind === "path"), "patrol route");
  const gate = sprites(items).find((s) => s.sprite === "obj_door")!;
  assert.deepEqual([gate.x, gate.y, gate.h, gate.label], [392, 112, 32, "switch"]);
  assert.ok(items.some((i) => i.kind === "link" && i.from.x === 340 && i.to.x === 392), "button → gate rule");
  assert.ok(items.some((i) => i.kind === "label" && i.label === "→ knight G1" && i.x === 120), "Enemy From NPC above the guard");
  assert.ok(sprites(items).some((s) => s.sprite === "obj_chest" && s.label === "boomerang"));
  assert.ok(sprites(items).some((s) => s.sprite === "obj_pit"));
});

test("editor preview: wave room area from its centre, wave enemies and the guardian's Define Enemy look", async () => {
  const story = await demo();
  const items = previewItems(story.maps[1], story);
  const area = items.find((i) => i.kind === "area") as Extract<PreviewItem, { kind: "area" }>;
  assert.deepEqual([area.x, area.y, area.w, area.h], [212, 16, 172, 208]);
  const waves = sprites(items).filter((s) => s.label?.startsWith("wave"));
  assert.equal(waves.length, 4);
  assert.ok(waves.every((w) => w.alpha === 0.6));
  assert.equal(waves.find((w) => w.label === "wave 1")?.look?.name, "Slime", "Define Enemy look reaches the wave enemy");
  assert.equal(sprites(items).find((s) => s.label === "after the waves")?.look?.name, "Bull");
  assert.equal(sprites(items).find((s) => s.sprite === "obj_chest" && s.label === "rupees")?.alpha, 0.5, "hidden chest is faded");
  assert.deepEqual(previewItems({}, null), []);
});

test("editor preview overlay: drawn only on a map in editor mode, redrawn on change, removed after", async () => {
  const story = await demo();
  const rig = createFakeScene();
  const scene = rig.scene;
  scene.map = structuredClone(story.maps[0]);
  scene.inEditorMode = true;
  let tick: () => void = () => {};
  const win: Any = { document: {}, setInterval: (f: () => void) => ((tick = f), 1), clearInterval: () => {}, console, game: { scene: { getScenes: () => [scene] } } };
  startEditorPreview(win);
  tick();
  const first = rig.created.filter((o) => !o.destroyed).length;
  assert.ok(first > 20, `drew ${first} objects`);
  tick();
  assert.equal(rig.created.length, first, "nothing redrawn while the map is unchanged");
  scene.map.initialActions = scene.map.initialActions.filter((a: Any) => a.actionName !== "Zelda: Create Chest");
  tick();
  assert.ok(rig.created.filter((o) => !o.destroyed).length < first, "redrawn without the chests");
  scene.inEditorMode = false; // playtest
  tick();
  assert.equal(rig.created.filter((o) => !o.destroyed).length, 0);
  // A reloaded plugin replaces the watcher; nothing outside a browser.
  scene.inEditorMode = true;
  startEditorPreview(win);
  tick();
  assert.ok(rig.created.some((o) => !o.destroyed));
  startEditorPreview({});
});

test("editor preview: each picture knows its action (for click and double click) and its collision box", async () => {
  const story = await demo();
  const field = story.maps[0];
  assert.ok(zeldaActions(field).every(({ root }) => root === "__map_start__"));
  const items = previewItems(field, story);
  const chest = sprites(items).find((s) => s.label === "bombs")!;
  const action = field.initialActions.find((a: Any) => a.actionName === "Zelda: Create Chest" && a.pluginParams.item === "bombs");
  assert.deepEqual(chest.ref, { id: action.id, root: "__map_start__" });
  assert.deepEqual(chest.box, { w: 16, h: 16 }, "chests are solid");
  assert.equal(sprites(items).find((s) => s.sprite === "obj_grass")?.box, null, "grass is not");
  assert.deepEqual(sprites(items).find((s) => s.sprite === "obj_door")?.box, { w: 16, h: 32 }, "closed gate: its size");
  assert.deepEqual(sprites(items).find((s) => s.label === "slime G1")?.box, { w: 14, h: 14 }, "enemy body: the type's size");
  const withLook = previewItems(field, { ...story, characters: story.characters.map((c: Any) => (c.name === "Slime" ? { ...c, animationSets: [{ id: "s", animations: {}, collision: { enabled: true, box: { x: 26, y: 25, width: 14, height: 15 } } }] } : c)) });
  assert.deepEqual(sprites(withLook).find((s) => s.label === "slime G1")?.box, { w: 14, h: 15 }, "with a Look: the character's collision box");

  assert.equal(
    actionRoute("/editor/Zelda%20Demo/maps/zelda-demo-field", "zelda-demo-field", { id: "Ab_1", root: "__map_start__" }),
    "/editor/Zelda%20Demo/maps/zelda-demo-field/Ab_1?bc=root%3A__map_start__",
  );
  assert.equal(actionRoute("/editor/P/maps/m/old-action", "m", { id: "x", root: "__map_enter__" }), "/editor/P/maps/m/x?bc=root%3A__map_enter__");
  assert.equal(actionRoute("/editor/P/play", "m", { id: "x", root: "__map_start__" }), null, "not on a map page");
  assert.equal(actionRoute("/editor/P/maps/m", "m", { id: "x", root: "" }), null, "actions inside events are not opened");
});
