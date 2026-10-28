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
