import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeScene } from "../helpers/fakePhaser.ts";
import { PhaserHost } from "../../src/host/phaserHost.ts";
import { createDefaultConfig } from "../../src/core/config.ts";
import { Logger } from "../../src/core/logger.ts";

test("toolkit sounds follow the Sound Volume of PS Maker's options menu", () => {
  const f = createFakeScene();
  const played: [string, number][] = [];
  f.scene.sound = { play: (key: string, o: { volume: number }) => played.push([key, o.volume]) };
  f.scene.cache = { audio: { exists: (k: string) => k === "chime" } };
  // PlayerAudioSettings.scaleSoundVolume: volume × slider percent.
  let percent = 40;
  f.game.audioSettings = { scaleSoundVolume: (v: number) => (v * percent) / 100 };
  const host = new PhaserHost({ game: f.game, scene: f.scene, player: f.player } as any, createDefaultConfig(), new Logger("[t]", { debug() {}, info() {}, warn() {}, error() {} }));
  host.playSound("chime", 0.5);
  percent = 0;
  host.playSound("chime", 0.5);
  delete f.game.audioSettings;
  host.playSound("chime", 0.5);
  assert.deepEqual(played, [["chime", 0.2], ["chime", 0], ["chime", 0.5]]);
  host.dispose();
});

test("UI Layout: the designer's layout is the HUD, with its fonts; empty or unreadable = the classic HUD", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  f.scene.sys.settings.data = { story: { characters: [], spritesheetAnimations: [], gameUI: { fonts: [{ id: "font-pixel-operator", name: "PixelOperator" }] } } };
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as any[]).find((e) => e.name === name)!.execute(params, { game: f.game, scene: f.scene, player: f.player });
  run("Zelda: Start Toolkit", { language: "en" });
  const tk = getToolkit();
  const warnings: string[] = [];
  tk.configure({ debug: { logLevel: "warn" } });
  (tk.logger as any).sink = { debug() {}, info() {}, warn: (...a: unknown[]) => warnings.push(a.join(" ")), error() {} };
  const layout = { v: 1, scale: 3, theme: { font: "font-pixel-operator" }, elements: [{ id: "rupees", type: "counter", x: 4, y: 4, value: "rupees", icon: "IMG_RUPEE" }, { id: "name", type: "text", text: "{itemName}" }] };
  run("Zelda: UI Layout", { layout: JSON.stringify(layout) });
  let model = tk.session!.hud!.buildModel();
  assert.deepEqual(model.layout.elements.map((e) => e.id), ["rupees", "name"]);
  assert.equal(model.layout.scale, 3);
  assert.equal(model.fonts["font-pixel-operator"], '"ps-maker-font-font-pixel-operator", "PixelOperator", monospace');
  assert.ok("itemName" in model.values && "rupees" in model.values, "the values the layout shows");
  run("Zelda: UI Layout", { layout: "" });
  assert.equal(tk.session!.hud!.buildModel().layout.elements.length, 9, "empty = classic");
  run("Zelda: UI Layout", { layout: "{broken" });
  model = tk.session!.hud!.buildModel();
  assert.equal(model.layout.elements.length, 9, "unreadable = classic");
  assert.ok(warnings.some((w) => w.includes("UI Layout: not valid layout data")), "and the author is told why");
  resetToolkitForTests();
});

test("UI Layout theme: own icons for built-in items (item box, inventory) and an inventory panel picture", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as any[]).find((e) => e.name === name)!.execute(params, { game: f.game, scene: f.scene, player: f.player });
  run("Zelda: Start Toolkit", { language: "en" });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  const theme = { icons: { boomerang: "IMG_BOOM" }, panel: "IMG_PANEL", panelSlice: 7, cursor: "IMG_CUR" };
  run("Zelda: UI Layout", { layout: JSON.stringify({ v: 1, theme, elements: [{ id: "item", type: "item" }] }) });
  tk.inventory.give("boomerang", 1, { silent: true });
  tk.inventory.give("bow", 1, { silent: true });
  tk.state.inventory.activeItem = "boomerang";
  let model = tk.session!.hud!.buildModel();
  assert.equal(model.values["item.icon"], "IMG_BOOM", "own icon in the item box");
  assert.deepEqual([model.layout.theme.panel, model.layout.theme.cursor, model.layout.theme.panelSlice], ["IMG_PANEL", "IMG_CUR", 7]);
  tk.state.inventory.activeItem = "bow";
  model = tk.session!.hud!.buildModel();
  assert.equal(model.values["item.icon"], "icon_bow", "no own icon = built-in");
  resetToolkitForTests();
});

test("Show Stat In Variable: toolkit values in project variables (whole hearts, half heart 0/1, item)", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  const vars = new Map<string, { id: string; type: string; value: unknown }>();
  for (const [id, type] of [["v_full", "number"], ["v_half", "number"], ["v_max", "number"], ["v_rup", "number"], ["v_name", "string"], ["v_bow", "number"]]) vars.set(id, { id, type, value: type === "string" ? "" : 0 });
  f.game.variables = { get: (id: string) => vars.get(id), set: (id: string, v: unknown) => (vars.get(id)!.value = v) };
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as any[]).find((e) => e.name === name)!.execute(params, { game: f.game, scene: f.scene, player: f.player });
  run("Zelda: Start Toolkit", { language: "en", hearts: 3 });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  for (const [stat, variableId] of [["fullHearts", "v_full"], ["halfHeart", "v_half"], ["maxHearts", "v_max"], ["rupees", "v_rup"], ["itemName", "v_name"]]) run("Zelda: Show Stat In Variable", { stat, variableId });
  run("Zelda: Show Stat In Variable", { stat: "selected", item: "bow", variableId: "v_bow" });
  const s = tk.session!;
  const step = () => {
    for (let i = 0; i < 7; i++) s.update(17);
  };
  tk.state.player.hp = 3; // 1.5 hearts of 3
  tk.inventory.give("rupees", 25, { silent: true });
  tk.inventory.give("bow", 1, { silent: true });
  tk.inventory.equip("bow");
  step();
  const v = (id: string) => vars.get(id)!.value;
  assert.deepEqual([v("v_full"), v("v_half"), v("v_max"), v("v_rup"), v("v_bow")], [1, 1, 3, 25, 1]);
  assert.equal(v("v_name"), "Bow");
  tk.state.player.hp = 4;
  step();
  assert.deepEqual([v("v_full"), v("v_half")], [2, 0]);
  resetToolkitForTests();
});
