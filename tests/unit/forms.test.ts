import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeScene } from "../helpers/fakePhaser.ts";
import { normalizeKey } from "../../src/host/keyboardInput.ts";
import { areaOf } from "../../src/editor/fields.ts";

type AnyAction = { name: string; parameterDefs: Record<string, { type: string; label?: string; description: string }>; execute(params: Record<string, unknown>, ctx: unknown): void };

async function setup(startParams: Record<string, unknown>) {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  // PS Maker project variables (game.variables: get(id) → { type, value }, set(id, value)).
  const vars = new Map<string, { id: string; type: string; value: unknown }>([
    ["var_gate", { id: "var_gate", type: "boolean", value: false }],
    ["var_rupees", { id: "var_rupees", type: "number", value: 0 }],
  ]);
  f.game.variables = { get: (id: string) => vars.get(id), set: (id: string, v: unknown) => (vars.get(id)!.value = v) };
  const ctx = { game: f.game, scene: f.scene, player: f.player };
  const actions = plugin.events as unknown as AnyAction[];
  const run = (name: string, params: Record<string, unknown>) => {
    const a = actions.find((e) => e.name === name);
    assert.ok(a, `action ${name} exists`);
    a.execute(params, ctx);
  };
  run("Zelda: Start Toolkit", { mapId: "forms", language: "en", debugHitboxes: false, diagnostics: false, ...startParams });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  return { run, tk, s: tk.session!, actions, vars, done: resetToolkitForTests };
}

test("no editor field asks for JSON", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  for (const e of plugin.events as unknown as AnyAction[]) {
    for (const [key, def] of Object.entries(e.parameterDefs)) {
      const d = def;
      assert.ok(!/json/i.test(`${d.label ?? ""} ${d.description}`), `${e.name}.${key} mentions JSON`);
      assert.ok(!/[{[]"/.test(d.description), `${e.name}.${key} shows a JSON example`);
    }
  }
});

test("constructor: text is asked only for content (sign text, messages, item names)", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  for (const e of plugin.events as unknown as AnyAction[]) {
    for (const [key, def] of Object.entries(e.parameterDefs)) {
      // "layout" is the UI designer's data, written by the designer on the map, not typed.
      if (def.type === "string") assert.ok(["text", "message", "name", "layout"].includes(key), `${e.name}.${key} is a text field`);
      if (def.type === "number") assert.ok(def.description.length > 12, `${e.name}.${key}: a number needs an explanation`);
    }
  }
});

test("action names stay stable (PS Maker saves actions under a key derived from the name)", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const names = new Set((plugin.events as unknown as AnyAction[]).map((e) => e.name));
  // As saved in a PS Maker 1.2.1 project: "plugin:zelda-maker-toolkit:zelda-create-enemy".
  const saved = ["Start Toolkit", "Set Controls", "Stop Toolkit", "Pause Combat", "Debug", "Create Enemy", "Enemy From NPC", "Create Object", "Create Chest", "Create Door", "Place Item", "Change Object", "Remove Target", "Damage Target", "Add Rule", "Run Actions", "Create Switch Sequence", "Create Wave Room", "Add Wave Enemy", "Enter Dungeon", "Give Item", "Spend Resource", "Remove Item", "Equip Item", "Change Player Stats", "Show Stat In Variable", "Set Ability", "Show Message", "Set Respawn Point", "Respawn Player", "Define Item", "Define Enemy", "Set Player Sprites", "Set Sound"];
  // Removed in 0.7.0 (PS Maker does it itself): Place Marker, Start Waves, Set Flag, Define Sprite Sheet, Define Animation, Preview Sprite Sheet.
  // Removed in 0.22.0 (PS Maker saves and the progress variable do it): Save Progress, Load Progress, Reset Progress; HUD Variables.
  for (const n of saved) assert.ok(names.has(`Zelda: ${n}`), `"Zelda: ${n}" was renamed or removed — saved projects would lose it`);
});

test("Start Toolkit: game settings from numbers and checkboxes", async () => {
  const { tk, done } = await setup({ difficulty: 3, hearts: 5, swordDamage: 3, magicBar: false, shieldButton: true, hudBottom: true });
  assert.equal(tk.config.player.invulnerableMs, 600, "difficulty 3 = hard");
  assert.equal(tk.config.player.maxHealth, 10);
  assert.equal(tk.state.player.maxHp, 10, "new game starts with 5 hearts");
  assert.equal(tk.config.sword.damage, 3);
  assert.equal(tk.config.ui.showMagic, false);
  assert.equal(tk.config.shield.mode, "hold");
  assert.equal(tk.config.ui.position, "bottom");
  done();
});

test("dropdowns: difficulty, door lock; Position is a map picker", async () => {
  const { tk, run, s, actions, done } = await setup({ difficulty: "hardcore" });
  assert.equal(tk.config.player.invulnerableMs, 600, "Hard");
  run("Zelda: Create Door", { id: "bd", position: { x: 40, y: 40 }, lock: "big_key", startOpen: false });
  assert.equal((s.world.get("bd") as unknown as { cfg: { lock: string } }).cfg.lock, "big_key");
  const enemy = actions.find((a) => a.name === "Zelda: Create Enemy")!;
  assert.equal(enemy.parameterDefs.position.type, "map-position");
  assert.equal(enemy.parameterDefs.template.type, "string-enum");
  run("Zelda: Define Enemy", { slot: "custom_enemy_2", basedOn: "slime", hp: 12 });
  run("Zelda: Create Enemy", { template: "custom_enemy_2", position: { x: 90, y: 90 } });
  const e = s.world.get("custom_enemy_2@90,90") as unknown as { hp: number };
  assert.equal(e.hp, 12, "custom enemy slot from Define Enemy, id made from the position");
  done();
});

test("Start Toolkit saved by 0.5 (Difficulty as a number, no Hearts) keeps its preset values", async () => {
  const { tk, done } = await setup({ difficulty: 1 });
  assert.equal(tk.config.player.maxHealth, 10, "casual health is not reset by the new Hearts default");
  assert.equal(tk.config.shield.mode, "passive");
  done();
});

test("Set Controls: PS Maker key picker", async () => {
  const { run, tk, done } = await setup({});
  run("Zelda: Set Controls", { sword: [{ type: "key", key: "Space" }, { type: "key", key: "KeyJ" }], useItem: [], inventory: [{ type: "key", key: "Tab" }] });
  assert.deepEqual(tk.config.controls.sword, ["Space", "KeyJ"]);
  assert.deepEqual(tk.config.controls.inventory, ["Tab"]);
  assert.deepEqual(tk.config.controls.useItem, ["KeyC"], "empty = keep");
  assert.equal(normalizeKey("j"), "KeyJ");
  assert.equal(normalizeKey("shift"), "Shift");
  assert.equal(normalizeKey("tab"), "Tab");
  assert.equal(normalizeKey("up"), "ArrowUp");
  done();
});

test("objects are picked on the map: doors, rules, variables, automatic ids", async () => {
  const { run, s, vars, done } = await setup({});
  const obj = (id: string) => s.world.get(id) as unknown as { objState: string; isActive: boolean; visible: boolean; cfg: Record<string, unknown>; setState(v: string): void };
  run("Zelda: Create Door", { position: { x: 100, y: 40 }, lock: "switch", startOpen: false, height: 32 });
  run("Zelda: Create Door", { position: { x: 160, y: 40 }, lock: "none" });
  assert.equal(obj("door@100,40").cfg.lock, "switch");
  assert.equal(obj("door@100,40").cfg.height, 32);
  run("Zelda: Create Object", { type: "pressure_plate", position: { x: 40, y: 90 }, staysOn: true });
  run("Zelda: Create Object", { type: "reactive", position: { x: 80, y: 90 }, reactsTo: ["arrow", "fire"], turnOnVariable: "var_gate", openDoorAt: { x: 161, y: 41 }, revealAt: { x: 200, y: 90 } });
  run("Zelda: Create Chest", { position: { x: 200, y: 90 }, item: "rupees", count: 5, hidden: true });
  assert.equal(obj("pressure_plate@40,90").cfg.plateMode, "latch");
  assert.deepEqual(obj("reactive@80,90").cfg.tools, ["arrow", "fire"]);
  assert.deepEqual(obj("reactive@80,90").cfg.onActivate, [{ openDoorAt: { x: 161, y: 41 } }, { revealAt: { x: 200, y: 90 } }, { setVariable: { id: "var_gate", value: true } }]);

  // Rule: the plate (picked on the map) opens the gate (picked on the map) and turns on a project variable.
  run("Zelda: Add Rule", { whenObjectAt: { x: 42, y: 88 }, openDoorAt: { x: 100, y: 45 }, giveItem: "bombs", giveCount: 3, message: "Open!", once: true });
  run("Zelda: Add Rule", { openDoorAt: { x: 100, y: 45 } });
  assert.match(s.logger.history.at(-1)!.text, /no condition/);
  obj("pressure_plate@40,90").setState("on");
  s.update(50);
  assert.equal(obj("door@100,40").objState, "opened");
  assert.equal(s.toolkit.inventory.count("bombs"), 3);

  // Activating the eye opens the other door, reveals the chest and sets the variable.
  obj("reactive@80,90").setState("on");
  s.update(50);
  assert.equal(obj("door@160,40").objState, "opened");
  assert.equal(obj("chest@200,90").visible, true);
  assert.equal(vars.get("var_gate")!.value, true);

  // Conditions on project variables (PS Maker can set them too).
  run("Zelda: Run Actions", { whenVariable: "var_gate", giveItem: "arrows", giveCount: 10 });
  assert.equal(s.toolkit.inventory.count("arrows"), 10);
  vars.get("var_gate")!.value = false;
  run("Zelda: Run Actions", { whenVariable: "var_gate", giveItem: "arrows", giveCount: 10 });
  assert.equal(s.toolkit.inventory.count("arrows"), 10, "variable off: nothing");

  // A block pushed onto a plate stands on the same point: the plate still counts.
  run("Zelda: Create Object", { type: "pressure_plate", position: { x: 300, y: 300 }, staysOn: true });
  run("Zelda: Create Door", { position: { x: 340, y: 300 }, lock: "switch" });
  run("Zelda: Create Object", { type: "block", position: { x: 300, y: 300 } });
  run("Zelda: Add Rule", { whenObjectAt: { x: 300, y: 300 }, openDoorAt: { x: 340, y: 300 } });
  obj("pressure_plate@300,300").setState("on");
  s.update(50);
  assert.equal(obj("door@340,300").objState, "opened", "plate under a block");

  // Spawning at a picked point; Change Object / Damage Target by point.
  run("Zelda: Run Actions", { spawnEnemy: "ogre", spawnAt: { x: 220, y: 200 } });
  assert.ok(s.world.list("enemy").some((e) => Math.round(e.x) === 220 && Math.round(e.y) === 200), "ogre at the point");
  run("Zelda: Change Object", { objectAt: { x: 100, y: 40 }, operation: "close" });
  assert.equal(obj("door@100,40").objState, "closed");
  done();
});

test("switch order is a path on the map; wave rooms are areas", async () => {
  const { run, s, done } = await setup({});
  for (const x of [40, 80, 120]) run("Zelda: Create Object", { type: "button", position: { x, y: 60 } });
  run("Zelda: Create Door", { position: { x: 160, y: 60 }, lock: "switch" });
  run("Zelda: Create Switch Sequence", { order: [{ x: 80, y: 60 }, { x: 40, y: 60 }, { x: 120, y: 60 }], resetOnWrong: true, openDoorAt: { x: 160, y: 60 } });
  for (const x of [80, 40, 120]) (s.world.get(`button@${x},60`) as unknown as { setState(v: string): void }).setState("on");
  s.update(50);
  assert.equal((s.world.get("door@160,60") as unknown as { objState: string }).objState, "opened");

  // Wave room: an area (PS Maker saves its centre); a door inside locks; enemies inside belong to it; walking in starts it.
  run("Zelda: Create Door", { position: { x: 400, y: 300 }, lock: "none", startOpen: true });
  run("Zelda: Add Wave Enemy", { wave: 1, template: "slime", position: { x: 450, y: 320 } });
  run("Zelda: Create Wave Room", { area: { x: 460, y: 340, width: 160, height: 120 }, delayMs: 100, giveItem: "rupees", giveCount: 20 });
  s.update(50);
  assert.equal(s.world.count("enemy"), 0, "not started before the player walks in");
  s.host.setPlayerPosition(460, 340);
  (s.host as unknown as { walk?(dx: number, dy: number): void }).walk?.(0, 0);
  for (let i = 0; i < 5; i++) s.update(20);
  assert.equal(s.world.count("enemy"), 1, "walking in starts the waves");
  assert.equal((s.world.get("door@400,300") as unknown as { objState: string }).objState, "closed", "door inside the area locks");
  done();
});

test("items and enemy types by slot; stats into project variables; animations picked in PS Maker", async () => {
  const { run, tk, s, vars, done } = await setup({ hearts: 3 });
  run("Zelda: Change Player Stats", { health: 0, maxHealth: 2, magic: 0, set: false });
  assert.equal(tk.state.player.maxHp, 8);
  run("Zelda: Define Item", { slot: "custom_item_1", name: "Ice Rod", resource: "magic", cost: 4, damage: 3, damageType: "ice", stunMs: 1000, give: true });
  run("Zelda: Define Item", { slot: "custom_item_2", name: "Herb", resource: "", heal: 4 });
  assert.equal(tk.items.get("custom_item_1")?.resource, "magic");
  assert.equal(typeof tk.items.get("custom_item_2")?.use, "function");
  assert.ok(tk.inventory.has("custom_item_1"));
  run("Zelda: Give Item", { item: "custom_item_2", count: 1, silent: true });
  assert.ok(tk.inventory.has("custom_item_2"));

  run("Zelda: Define Enemy", { slot: "custom_enemy_1", basedOn: "slime", hp: 9, damage: 2, speed: 30, boss: true, immuneTo: ["arrow"] });
  run("Zelda: Create Enemy", { template: "custom_enemy_1", position: { x: 120, y: 120 }, group: "3", patrol: [{ x: 120, y: 120 }, { x: 160, y: 120 }] });
  const e = s.world.get("custom_enemy_1@120,120") as unknown as { hp: number; group: string; cfg: { boss: boolean; resistances: Record<string, number>; patrol: { mode: string; points: unknown[] } } };
  assert.equal(e.hp, 9);
  assert.equal(e.group, "3");
  assert.equal(e.cfg.boss, true);
  assert.equal(e.cfg.resistances.arrow, 0);
  assert.equal(e.cfg.patrol.mode, "path");
  assert.deepEqual(e.cfg.patrol.points, [{ x: 120, y: 120 }, { x: 160, y: 120 }]);

  run("Zelda: Show Stat In Variable", { stat: "rupees", variableId: "var_rupees" });
  tk.inventory.give("rupees", 42, { silent: true });
  for (let i = 0; i < 8; i++) s.update(17);
  assert.equal(vars.get("var_rupees")!.value, 42);
  done();
});

test("a drawn area is read from its centre, as the PS Maker area editor saves it", () => {
  assert.deepEqual(areaOf({ x: 100, y: 100, width: 40, height: 20 }), { x: 80, y: 90, width: 40, height: 20 });
  assert.deepEqual(areaOf({ x: 100, y: 100, width: -40, height: 20 }), { x: 80, y: 90, width: 40, height: 20 }, "drawn backwards");
  assert.equal(areaOf({ x: 1, y: 1, width: 0, height: 5 }), null);
  assert.equal(areaOf(undefined), null);
});
