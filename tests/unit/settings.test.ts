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

test("HUD Style: pictures by slot, a project font as PS Maker registers it, empty = built-in", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  f.scene.sys.settings.data = { story: { characters: [], spritesheetAnimations: [], gameUI: { fonts: [{ id: "font-pixel-operator", name: "PixelOperator" }] } } };
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as any[]).find((e) => e.name === name)!.execute(params, { game: f.game, scene: f.scene, player: f.player });
  run("Zelda: Start Toolkit", { language: "en" });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  run("Zelda: HUD Style", { heartFull: "IMG1", digits: "IMG2", bar: "IMG3", barSlice: 6, lifeLabel: false, font: "font-pixel-operator", textColor: "#ffffff", scale: 3 });
  const ui = tk.config.ui;
  assert.equal(ui.skin.heartFull, "IMG1");
  assert.equal(ui.skin.digits, "IMG2");
  assert.equal(ui.skin.rupees, "", "not chosen = built-in");
  assert.deepEqual([ui.barSlice, ui.showLifeLabel, ui.textColor, ui.scale], [6, false, "#ffffff", 3]);
  assert.equal(ui.fontFamily, '"ps-maker-font-font-pixel-operator", "PixelOperator", monospace');
  const model = tk.session!.hud!.buildModel();
  assert.equal(model.skin.heartFull, "IMG1");
  assert.equal(model.showLifeLabel, false);
  run("Zelda: HUD Style", {});
  assert.equal(tk.config.ui.skin.heartFull, "");
  assert.equal(tk.config.ui.fontFamily, "monospace");
  resetToolkitForTests();
});

test("the Font dropdown lists the project's fonts (filled from the open project)", async () => {
  const { FONT_OPTIONS, fillFontOptions } = await import("../../src/editor/fields.ts");
  assert.equal(fillFontOptions([{ id: "f1", name: "PixelOperator" }, { id: "f2", name: "Mana" }]), true);
  assert.deepEqual(FONT_OPTIONS.map((o) => o.value), ["", "f1", "f2"]);
  assert.equal(fillFontOptions([{ id: "f1", name: "PixelOperator" }, { id: "f2", name: "Mana" }]), false, "unchanged");
  fillFontOptions([]);
  assert.deepEqual(FONT_OPTIONS, [{ label: "Default", value: "" }]);
});
