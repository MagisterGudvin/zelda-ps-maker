import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig } from "../helpers/fakeHost.ts";
import { parseLayout } from "../../src/ui/uiLayout.ts";
import { hookStoryRunner } from "../../src/editor/storyHooks.ts";

const settingsLayout = () =>
  parseLayout(
    JSON.stringify({
      v: 1,
      screen: { role: "settings" },
      elements: [
        { id: "music", type: "button", x: -40, y: -40, w: 80, h: 14, anchor: "c", text: "Music {musicVolume}", action: { kind: "music", value: "" } },
        { id: "sound", type: "button", x: -40, y: -24, w: 80, h: 14, anchor: "c", text: "Sound {soundVolume}", action: { kind: "sound", value: "25" } },
        { id: "full", type: "button", x: -40, y: -8, w: 80, h: 14, anchor: "c", text: "{fullscreen.text}", action: { kind: "fullscreen" } },
        { id: "save", type: "button", x: -40, y: 8, w: 80, h: 14, anchor: "c", text: "Save", show: { when: "compare", id: "settings.save", op: "==", value: 1 }, action: { kind: "save" } },
        { id: "exit", type: "button", x: -40, y: 24, w: 80, h: 14, anchor: "c", text: "Exit", action: { kind: "exit" } },
        { id: "bar", type: "bar", x: 50, y: -40, w: 40, h: 6, anchor: "c", value: "musicVolume", max: "100" },
      ],
    }),
  ).layout!;

test("settings screen: volumes change with left/right and Z (PS Maker's own audio settings), fullscreen, save and exit run PS Maker's actions; Escape opens it without a pause menu", () => {
  const r = createRig();
  r.tk.uiScreens.set("settings", settingsLayout());
  r.step();
  r.host.input.tap("menu");
  r.step(2);
  assert.equal(r.session.screens!.current?.name, "settings", "Escape: the settings screen when there is no pause menu");
  r.host.input.tap("left");
  r.step(2);
  assert.equal(r.host.audio.music, 90, "left: music one step (10) down");
  assert.equal(r.session.screens!.current?.focus, "music", "left/right change the volume, they do not move to another button");
  r.host.input.tap("action");
  r.step(2);
  r.host.input.tap("action");
  r.step(2);
  assert.equal(r.host.audio.music, 0, "Z: up a step; past full, silent");
  r.host.input.tap("down");
  r.step(2);
  r.host.input.tap("left");
  r.step(2);
  assert.equal(r.host.audio.sound, 75, "the sound button's own step (25)");
  r.session.hud!.markDirty();
  r.step(2);
  const v = r.host.hud.last!.screen!.values;
  assert.deepEqual([v.musicVolume, v.soundVolume, v["fullscreen.text"], v["settings.save"], v["100"]], [0, 75, "Off", 1, 100]);
  r.session.screens!.press("full");
  r.session.screens!.press("save");
  r.session.screens!.press("exit");
  assert.deepEqual(r.host.builtIns.map((a) => a.type), ["toggleFullscreenAction", "saveGameAction", "exitGameAction"]);
  r.session.hud!.markDirty();
  r.step(2);
  assert.equal(r.host.hud.last!.screen!.values["fullscreen.text"], "On");
});

test("settings screen: PS Maker's \"Open game options menu\" opens it instead of PS Maker's menu, with its save and exit choices; without one PS Maker's menu opens", () => {
  const r = createRig();
  const ran: string[] = [];
  const ended: unknown[] = [];
  const scene = { storyRunner: { dependencies: { getBuiltInAction: (type: string) => ({ execute: () => ran.push(type) }) } } };
  assert.ok(hookStoryRunner(scene, r.tk));
  const options = (save: boolean) => (scene.storyRunner.dependencies.getBuiltInAction("openOptionsMenuAction") as { execute: (a: unknown, c: unknown) => void }).execute({ type: "openOptionsMenuAction", showSaveGameButton: save, showExitGameButton: true }, { endAction: (x: unknown) => ended.push(x) });
  options(true);
  assert.deepEqual(ran, ["openOptionsMenuAction"], "no settings screen: PS Maker's own menu");
  r.tk.uiScreens.set("settings", settingsLayout());
  options(false);
  assert.deepEqual(ran, ["openOptionsMenuAction"]);
  assert.equal(ended.length, 1, "the action ends at once, as PS Maker's");
  assert.equal(r.session.screens!.current?.name, "settings");
  r.session.hud!.markDirty();
  r.step(2);
  assert.equal(r.host.hud.last!.screen!.values["settings.save"], 0, "the title's options menu without saving: no Save button");
  r.session.screens!.press("save");
  assert.deepEqual(r.host.builtIns, [], "and saving is not possible");
});

test("host: the volumes are PS Maker's own player audio settings (music through its music manager, so the music playing follows)", async () => {
  const { createFakeScene } = await import("../helpers/fakePhaser.ts");
  const { PhaserHost } = await import("../../src/host/phaserHost.ts");
  const { createDefaultConfig } = await import("../../src/core/config.ts");
  const { Logger } = await import("../../src/core/logger.ts");
  const f = createFakeScene();
  const calls: string[] = [];
  f.game.audioSettings = { musicVolumePercent: 70, soundVolumePercent: 40, setSoundVolume: (v: number) => calls.push(`sound ${v}`), setMusicVolume: (v: number) => calls.push(`settings music ${v}`) };
  f.game.musicManager = { setPlayerMusicVolume: (v: number) => calls.push(`music ${v}`) };
  const host = new PhaserHost({ game: f.game, scene: f.scene, player: f.player } as any, createDefaultConfig(), new Logger("[t]", { debug() {}, info() {}, warn() {}, error() {} }));
  assert.deepEqual(host.audioVolumes(), { music: 70, sound: 40 });
  assert.ok(host.setAudioVolume("music", 104.6));
  assert.ok(host.setAudioVolume("sound", -3));
  assert.deepEqual(calls, ["music 100", "sound 0"], "clamped to 0–100, music through the music manager");
  delete f.game.audioSettings;
  assert.equal(host.audioVolumes(), null);
  host.dispose();
});
