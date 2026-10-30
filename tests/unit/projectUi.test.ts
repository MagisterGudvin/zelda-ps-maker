import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeScene } from "../helpers/fakePhaser.ts";
import { projectUi } from "../../src/editor/projectUi.ts";
import { designerSetup } from "../../src/editor/layoutEdit.ts";

const layoutText = (...ids: string[]) => JSON.stringify({ v: 1, elements: ids.map((id) => ({ id, type: "text" })) });
const ui = (id: string, params: Record<string, unknown>) => ({ id, actionName: "Zelda: UI Layout", pluginParams: params });
const start = { id: "st", actionName: "Zelda: Start Toolkit", pluginParams: { language: "en" } };

/** A project: the field holds the shared HUD and the pause screen, the dungeon has none, the cave its own. */
function project(dungeonActions: unknown[] = []) {
  return {
    characters: [],
    spritesheetAnimations: [],
    gameConfig: { width: 1280, height: 720, zoom: 4 },
    maps: [
      { id: "field", name: "Field", initialActions: [start, ui("hudA", { name: "", layout: layoutText("fieldHud") }), ui("pause", { name: "pause", layout: layoutText("resume") })] },
      { id: "dungeon", name: "Dungeon", initialActions: [start, ...dungeonActions] },
      { id: "cave", name: "Cave", initialActions: [start, ui("hudC", { name: "", thisMapOnly: true, layout: layoutText("caveHud") })] },
    ],
  };
}

test("the project's shared HUD is the first one by map order; 'This map only' ones and screens are not it", () => {
  const p = projectUi(project([ui("hudB", { name: "", layout: layoutText("second") })]) as any);
  assert.deepEqual([p.hud?.actionId, p.hud?.mapName], ["hudA", "Field"]);
  assert.deepEqual(p.screens.map((s) => [s.name, s.mapName]), [["pause", "Field"]]);
  assert.equal(projectUi({ maps: [project().maps[2]] } as any).hud, null, "only a this-map HUD: none shared");
  assert.deepEqual(projectUi(null), { hud: null, screens: [] });
});

async function startOn(mapId: string, story: unknown) {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  f.scene.sys.settings.data = { story };
  f.scene.sys.settings.key = mapId;
  f.scene.map = { id: mapId };
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as any[]).find((e) => e.name === name)!.execute(params, { game: f.game, scene: f.scene, player: f.player });
  run("Zelda: Start Toolkit", { language: "en" });
  const tk = getToolkit();
  const warnings: string[] = [];
  (tk.logger as any).sink = { debug() {}, info() {}, warn: (...a: unknown[]) => warnings.push(a.join(" ")), error() {} };
  tk.configure({ debug: { logLevel: "warn" } });
  return { tk, run, warnings, done: resetToolkitForTests };
}

test("a map without a HUD of its own shows the shared HUD, and every screen of the project opens there", async () => {
  const { tk, run, done } = await startOn("dungeon", project());
  assert.deepEqual(tk.hudLayout?.elements.map((e) => e.id), ["fieldHud"]);
  run("Zelda: Open UI Screen", { name: "pause" });
  assert.equal(tk.session!.screens!.current?.name, "pause", "the screen made on the field");
  done();
});

test("a second shared HUD on a map is not shown (the project's is); 'This map only' replaces it on its map", async () => {
  const { tk, run, warnings, done } = await startOn("dungeon", project([ui("hudB", { name: "", layout: layoutText("second") })]));
  run("Zelda: UI Layout", { name: "", layout: layoutText("second") });
  assert.deepEqual(tk.hudLayout?.elements.map((e) => e.id), ["fieldHud"]);
  assert.ok(warnings.some((w) => w.includes('second shared HUD') && w.includes('"Field"')));
  run("Zelda: UI Layout", { name: "", thisMapOnly: true, layout: layoutText("mine") });
  assert.deepEqual(tk.hudLayout?.elements.map((e) => e.id), ["mine"]);
  // The shared HUD's own action, run on its map, is the shared HUD.
  run("Zelda: UI Layout", { name: "", layout: layoutText("fieldHud") });
  assert.deepEqual(tk.hudLayout?.elements.map((e) => e.id), ["fieldHud"]);
  done();
});

test("editor frame: the shared HUD from another map, a map's own, a second shared one", () => {
  const story = project([ui("hudB", { name: "", layout: layoutText("second") })]) as any;
  const shown = (mapId: string, openId = "") => {
    const st = designerSetup(story.maps.find((m: any) => m.id === mapId), story, 0, openId)!;
    return [st.sharing, st.layout.elements.map((e) => e.id).join(), st.action?.id ?? null, st.sharedMap];
  };
  assert.deepEqual(shown("field"), ["shared", "fieldHud", "hudA", "Field"]);
  assert.deepEqual(shown("cave"), ["thisMap", "caveHud", "hudC", "Field"]);
  assert.deepEqual(shown("dungeon"), ["conflict", "fieldHud", "hudB", "Field"], "what the game shows");
  assert.deepEqual(shown("dungeon", "hudB"), ["conflict", "second", "hudB", "Field"], "opened: its own layout, to fix it");
  const plain = project() as any;
  const st = designerSetup(plain.maps[1], plain, 0)!;
  assert.deepEqual([st.sharing, st.layout.elements.map((e) => e.id).join(), st.action], ["project", "fieldHud", null]);
});
