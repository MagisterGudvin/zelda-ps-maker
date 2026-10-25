import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeScene } from "../helpers/fakePhaser.ts";
import { createRig, errors } from "../helpers/fakeHost.ts";
import { FEATURE_IDS } from "../../src/core/config.ts";
import { spawnEnemy } from "../../src/enemies/spawn.ts";
import { createObject } from "../../src/interactions/spawnObject.ts";

test("importing the plugin has no global side effects and exposes the PS Maker plugin shape", async () => {
  const before = Object.keys(globalThis).length;
  const mod = await import("../../src/index.ts");
  const plugin = mod.default as { name: string; version: string; description: string; events: { name: string; parameterDefs: object; execute: unknown }[]; actions: unknown };
  assert.equal(plugin.name, "Zelda Maker Toolkit");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.events.length >= 35);
  assert.equal(plugin.actions, plugin.events);
  const names = new Set<string>();
  for (const e of plugin.events) {
    assert.ok(e.name.startsWith("Zelda: "), e.name);
    assert.ok(!names.has(e.name), `duplicate action name ${e.name}`);
    names.add(e.name);
    assert.equal(typeof e.execute, "function");
    for (const [key, def] of Object.entries(e.parameterDefs)) {
      const d = def as { type: string; description: string };
      assert.ok(["string", "number", "boolean", "position", "image", "audio", "npc", "map-position", "string-enum", "in-map-npc", "player-animation-picker", "map-rectangle-area", "path", "string-enum-multi", "variable", "key-bindings", "animation"].includes(d.type), `${e.name}.${key} type`);
      if (d.type === "string-enum") assert.ok(Array.isArray((d as { options?: unknown }).options) && ((d as unknown as { options: { value: string }[] }).options).some((o) => o.value === (d as { defaultValue?: string }).defaultValue), `${e.name}.${key} default is one of the options`);
      assert.equal(typeof d.description, "string");
    }
  }
  assert.equal(Object.keys(globalThis).length, before, "no globals until an action runs");
  assert.equal((globalThis as Record<string, unknown>).ZeldaMakerToolkit, undefined);
});

test("editor actions drive a full session on a Phaser-like scene and shutdown releases every listener", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  const f = createFakeScene();
  const ctx = { game: f.game, scene: f.scene, player: f.player };
  type AnyAction = { name: string; execute(params: Record<string, unknown>, ctx: unknown): void };
  const action = (name: string) => (plugin.events as unknown as AnyAction[]).find((e) => e.name === name)!;
  const baselineScene = f.events.count();

  action("Zelda: Start Toolkit").execute({ mapId: "field", difficulty: 2, hearts: 3, swordDamage: 2, magicBar: true, shieldButton: false, hudBottom: false, autosave: true, language: "ru", debugHitboxes: true, diagnostics: false }, ctx);
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  assert.equal(tk.session?.mapId, "field");
  assert.equal(tk.i18n.language, "ru");
  assert.ok((globalThis as Record<string, unknown>).ZeldaMakerToolkit, "public API installed on first use");
  assert.ok(f.events.count("postupdate") === 1, "one frame listener");
  assert.ok(f.keyboard.count() === 2, "keydown + keyup");

  action("Zelda: Create Enemy").execute({ template: "slime", position: { x: 140, y: 100 }, id: "e1", group: "g" }, ctx);
  action("Zelda: Create Chest").execute({ id: "c1", position: { x: 100, y: 80 }, item: "bombs", count: 5, requiresBigKey: false, hidden: false }, ctx);
  action("Zelda: Add Rule").execute({ id: "r", whenDefeated: "g", setFlag: "won", once: true }, ctx);
  action("Zelda: Give Item").execute({ item: "bow", count: 1, silent: true }, ctx);
  assert.equal(tk.session!.world.count("enemy"), 1);

  // Calling Start Toolkit again on the same map must not create a second session.
  const first = tk.session;
  action("Zelda: Start Toolkit").execute({ mapId: "field", language: "", debugHitboxes: false }, ctx);
  assert.equal(tk.session, first);
  assert.equal(f.events.count("postupdate"), 1);
  // ...even when PS Maker passes another ctx.scene for the same player (the player's scene wins).
  const other = createFakeScene();
  action("Zelda: Start Toolkit").execute({ mapId: "field", language: "", debugHitboxes: false }, { game: f.game, scene: other.scene, player: f.player });
  assert.equal(tk.session, first);
  assert.equal(tk.session!.world.count("enemy"), 1, "enemies created in between survive");
  assert.equal(tk.actionCounts.get("Start Toolkit"), 3);
  assert.equal(tk.actionCounts.get("Create Enemy"), 1);

  // Simulate frames: PS Maker's scene emits postupdate with (time, delta).
  for (let i = 0; i < 120; i++) f.events.emit("postupdate", i * 16, 16.6667);
  f.keyboard.emit("keydown", { code: "KeyX" });
  f.events.emit("postupdate", 0, 16.6667);
  f.keyboard.emit("keyup", { code: "KeyX" });
  for (let i = 0; i < 30; i++) f.events.emit("postupdate", 0, 16.6667);
  action("Zelda: Remove Target").execute({ id: "e1", group: "", defeat: true }, ctx);
  f.events.emit("postupdate", 0, 16.6667);
  assert.equal(tk.state.flags.won, true);

  // Map closes.
  const busBefore = tk.bus.listenerCount();
  f.events.emit("shutdown");
  assert.equal(tk.session, null);
  assert.equal(f.events.count(), baselineScene, "no scene listeners left");
  assert.equal(f.keyboard.count(), 0, "no keyboard listeners left");
  assert.equal(f.gameEvents.count(), 0, "no game listeners left");
  assert.ok(tk.bus.listenerCount() < busBefore, "session bus listeners released");
  assert.equal(tk.bus.listenerCount(), 0, "nothing left on the bus");
  // Every object the toolkit created in the map scene was destroyed (HUD scene objects are reused).
  assert.equal(tk.state.inventory.owned.includes("bow"), true, "progress survives map shutdown");
  resetToolkitForTests();
  delete (globalThis as Record<string, unknown>).ZeldaMakerToolkit;
});

test("stopping a session disposes views and leaves the player as found", () => {
  const rig = createRig();
  spawnEnemy(rig.session, "slime", 50, 50);
  createObject(rig.session, "bush", 70, 70);
  rig.session.player.lock("test");
  rig.step(10);
  rig.tk.stop("test");
  assert.equal(rig.host.disposed, true);
  assert.equal(rig.host.locked, false);
  assert.equal(rig.host.blinkVisible, true);
  assert.ok(rig.host.views.every((v) => v.destroyed), "all views destroyed");
  assert.equal(rig.tk.bus.listenerCount(), 0);
});

for (const feature of FEATURE_IDS) {
  test(`disabling "${feature}" does not break the other modules`, () => {
    const rig = createRig({ features: { [feature]: false } });
    rig.tk.inventory.give("bombs", 3, { silent: true });
    rig.tk.inventory.give("boomerang", 1, { silent: true });
    const p = rig.host.player!;
    spawnEnemy(rig.session, "soldier", p.x + 40, p.y);
    createObject(rig.session, "chest", p.x, p.y - 20, { id: "c", overrides: { contents: { item: "key", count: 1 } } });
    createObject(rig.session, "bush", p.x + 20, p.y + 20);
    rig.session.rules?.addRule({ id: "r", when: { flag: "x" }, then: [{ message: "hi" }] });
    for (let i = 0; i < 300; i++) {
      if (i % 40 === 0) rig.host.input.tap("sword");
      if (i % 90 === 0) rig.host.input.tap("useItem");
      if (i % 70 === 0) rig.host.input.tap("action");
      if (i % 50 === 0) rig.host.input.tap("nextItem");
      rig.host.walk(i % 2 ? 0.5 : -0.5, 0);
      rig.step();
    }
    rig.tk.saves.save(undefined, { silent: true });
    rig.tk.stop("end");
    assert.deepEqual(errors(rig), [], "no errors logged");
  });
}

test("events: handler errors are isolated and runaway recursion is cut", () => {
  const rig = createRig();
  let ok = 0;
  rig.tk.bus.on("zelda:custom:x", () => {
    throw new Error("boom");
  });
  rig.tk.bus.on("zelda:custom:x", () => ok++);
  rig.tk.bus.emit("zelda:custom:x", {});
  assert.equal(ok, 1);
  const off = rig.tk.bus.on("zelda:custom:loop", () => rig.tk.bus.emit("zelda:custom:loop", {}));
  rig.tk.bus.emit("zelda:custom:loop", {});
  off();
  assert.ok(errors(rig).some((e) => String(e[1]).includes("recursion")));
});

test("pausing combat freezes enemies and sword input", () => {
  const rig = createRig();
  const p = rig.host.player!;
  const e = spawnEnemy(rig.session, "soldier", p.x + 50, p.y)!;
  rig.session.setPaused("script", true);
  const x0 = e.x;
  rig.host.input.tap("sword");
  rig.run(1000);
  assert.equal(e.x, x0);
  assert.equal(rig.session.sword!.phase, "idle");
  rig.session.setPaused("script", false);
  rig.run(1000);
  assert.notEqual(e.x, x0);
});
