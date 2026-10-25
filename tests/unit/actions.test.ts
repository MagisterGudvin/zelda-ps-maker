import { test } from "node:test";
import assert from "node:assert/strict";
import { chainable, createFakeScene } from "../helpers/fakePhaser.ts";

type AnyAction = { name: string; execute(params: Record<string, unknown>, ctx: unknown): void };

test("consolidated editor actions work end to end", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  const f = createFakeScene();
  const ctx = { game: f.game, scene: f.scene, player: f.player };
  const run = (name: string, params: Record<string, unknown>) => {
    const a = (plugin.events as unknown as AnyAction[]).find((e) => e.name === name);
    assert.ok(a, `action ${name} exists`);
    a.execute(params, ctx);
  };
  run("Zelda: Start Toolkit", { mapId: "m", preset: "", config: '{"debug":{"logLevel":"silent"},"save":{"autoSave":false}}', language: "en", debugHitboxes: false, diagnostics: false });
  const tk = getToolkit();
  const s = tk.session!;

  run("Zelda: Create Door", { id: "d1", position: { x: 50, y: 50 }, lock: "switch", startOpen: false });
  run("Zelda: Change Object", { id: "d1", operation: "open", state: "" });
  assert.equal((s.world.get("d1") as unknown as { objState: string }).objState, "opened");
  run("Zelda: Change Object", { id: "d1", operation: "close", state: "" });
  assert.equal((s.world.get("d1") as unknown as { objState: string }).objState, "closed");
  run("Zelda: Create Object", { type: "lever", position: { x: 80, y: 50 }, id: "lv", config: "" });
  run("Zelda: Change Object", { id: "lv", operation: "toggle", state: "" });
  assert.equal((s.world.get("lv") as unknown as { objState: string }).objState, "on");

  const diag = s.debug!.diagnosticsLines().join("\n");
  assert.match(diag, /enemies 0, objects 2/);
  assert.match(diag, /actions run: Start Toolkit, Create Door, Change Object x3, Create Object/);

  // Errors PS Maker reports outside the plugin reach the diagnostics history (console still prints).
  const realWrite = process.stderr.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    console.error("Event runner failed:", new TypeError("Cannot read properties of undefined (reading 'id')"));
  } finally {
    process.stderr.write = realWrite;
  }
  assert.match(tk.logger.history.at(-1)!.text, /^console\.error: Event runner failed: TypeError: Cannot read properties/);
  assert.equal(tk.logger.history.at(-1)!.level, "error");

  run("Zelda: Run Actions", { when: '{"hasItem":"bow"}', then: '[{"setFlag":"yes"}]', else: '[{"setFlag":"no"}]' });
  assert.equal(tk.state.flags.no, true);
  run("Zelda: Run Actions", { when: "", then: '[{"giveItem":{"item":"bow","silent":true}}]', else: "" });
  assert.ok(tk.inventory.owns("bow"));

  run("Zelda: Enter Dungeon", { dungeonId: "d1", completeOnBoss: true });
  assert.equal(tk.state.currentDungeon, "d1");
  run("Zelda: Enter Dungeon", { dungeonId: "", completeOnBoss: true });
  assert.equal(tk.state.currentDungeon, null);

  run("Zelda: Change Player Stats", { stat: "max health", mode: "add", amount: 2 });
  assert.equal(tk.state.player.maxHp, 8);
  run("Zelda: Change Player Stats", { stat: "health", mode: "set", amount: 3 });
  assert.equal(tk.state.player.hp, 3);
  run("Zelda: Change Player Stats", { stat: "magic", mode: "set", amount: 5 });
  assert.equal(tk.state.player.magic, 5);

  // An NPC placed by PS Maker becomes an enemy (separate action, so an empty NPC field never blocks Create Enemy).
  const guard = chainable({ name: "guard", x: 300, y: 320, body: { enable: true } });
  f.scene.children.list.push(guard);
  run("Zelda: Enemy From NPC", { npc: "guard", template: "soldier", id: "npc_enemy", group: "", overrides: '{"detectRange":0}' });
  const adopted = s.world.get("npc_enemy") as unknown as { x: number; y: number };
  assert.ok(adopted, "NPC adopted as enemy");
  assert.deepEqual([adopted.x, adopted.y], [300, 320]);
  assert.equal(guard.body.enable, false, "NPC body handed over to the toolkit");
  run("Zelda: Enemy From NPC", { npc: "nobody", template: "", id: "", group: "", overrides: "" });
  assert.match(tk.logger.history.at(-1)!.text, /NPC "nobody" was not found/);
  run("Zelda: Remove Target", { id: "npc_enemy", group: "", defeat: false });

  run("Zelda: Create Enemy", { template: "slime", position: { x: 200, y: 200 }, id: "", group: "g", animations: "", patrol: "", overrides: '{"detectRange":0}' });
  run("Zelda: Create Enemy", { template: "slime", position: { x: 220, y: 200 }, id: "", group: "g", animations: "", patrol: "", overrides: '{"detectRange":0}' });
  let defeated = 0;
  tk.bus.on("zelda:enemy:defeated", () => defeated++);
  run("Zelda: Remove Target", { id: "", group: "g", defeat: true });
  assert.equal(defeated, 2);
  run("Zelda: Remove Target", { id: "lv", group: "", defeat: true });
  s.world.flush();
  assert.equal(s.world.has("lv"), false, "objects are removed");

  run("Zelda: Debug", { hitboxes: true, diagnostics: true });
  assert.equal(s.debug!.isEnabled, true);
  assert.equal(s.debug!.diagnosticsOn, true);
  resetToolkitForTests();
  delete (globalThis as Record<string, unknown>).ZeldaMakerToolkit;
});

test("sounds play for toolkit moments once configured", async () => {
  const { createRig } = await import("../helpers/fakeHost.ts");
  const { spawnEnemy } = await import("../../src/enemies/spawn.ts");
  const rig = createRig({ audio: { volume: 0.5, sounds: { swordSwing: { src: "swing.ogg", volume: 0.8 }, enemyDefeated: { src: "poof", volume: 1 } } } });
  rig.host.input.tap("sword");
  rig.step();
  spawnEnemy(rig.session, "slime", 300, 300)!.die();
  assert.deepEqual(rig.host.sounds, [
    { src: "swing.ogg", volume: 0.4 },
    { src: "poof", volume: 0.5 },
  ]);
  rig.tk.configure({ audio: { enabled: false } });
  rig.host.input.tap("sword");
  rig.run(600);
  assert.equal(rig.host.sounds.length, 2, "muted");
});
