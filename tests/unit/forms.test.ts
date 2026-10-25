import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeScene } from "../helpers/fakePhaser.ts";
import { normalizeKey } from "../../src/host/keyboardInput.ts";

type AnyAction = { name: string; parameterDefs: Record<string, { type: string; label?: string; description: string }>; execute(params: Record<string, unknown>, ctx: unknown): void };

async function setup(startParams: Record<string, unknown>) {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  const ctx = { game: f.game, scene: f.scene, player: f.player };
  const actions = plugin.events as unknown as AnyAction[];
  const run = (name: string, params: Record<string, unknown>) => {
    const a = actions.find((e) => e.name === name);
    assert.ok(a, `action ${name} exists`);
    a.execute(params, ctx);
  };
  run("Zelda: Start Toolkit", { mapId: "forms", language: "en", debugHitboxes: false, diagnostics: false, ...startParams });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" }, save: { autoSave: false } });
  return { run, tk, s: tk.session!, actions, done: resetToolkitForTests };
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

test("action names stay stable (PS Maker saves actions under a key derived from the name)", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const names = new Set((plugin.events as unknown as AnyAction[]).map((e) => e.name));
  // As saved in a PS Maker 1.2.1 project: "plugin:zelda-maker-toolkit:zelda-create-enemy".
  const saved = ["Start Toolkit", "Set Controls", "Stop Toolkit", "Pause Combat", "Debug", "Create Enemy", "Enemy From NPC", "Create Object", "Create Chest", "Create Door", "Place Item", "Place Marker", "Change Object", "Remove Target", "Damage Target", "Add Rule", "Run Actions", "Create Switch Sequence", "Create Wave Room", "Add Wave Enemy", "Start Waves", "Enter Dungeon", "Give Item", "Spend Resource", "Remove Item", "Equip Item", "Change Player Stats", "Set Flag", "Set Ability", "Show Message", "Set Respawn Point", "Respawn Player", "Save Progress", "Load Progress", "Reset Progress", "Define Item", "Define Enemy", "Define Sprite Sheet", "Define Animation", "Set Player Sprites", "Preview Sprite Sheet", "Set Sound"];
  for (const n of saved) assert.ok(names.has(`Zelda: ${n}`), `"Zelda: ${n}" was renamed or removed — saved projects would lose it`);
});

test("Start Toolkit: game settings from numbers and checkboxes", async () => {
  const { tk, done } = await setup({ difficulty: 3, hearts: 5, swordDamage: 3, magicBar: false, shieldButton: true, hudBottom: true, autosave: false });
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
  run("Zelda: Define Enemy", { name: "boss_slime", basedOn: "slime", hp: 12 });
  run("Zelda: Create Enemy", { template: "soldier", customTemplate: "boss_slime", id: "bs", position: { x: 90, y: 90 } });
  assert.equal((s.world.get("bs") as unknown as { hp: number }).hp, 12, "custom template wins over the dropdown");
  done();
});

test("Start Toolkit saved by an older version keeps its preset values", async () => {
  const { tk, done } = await setup({ preset: "casual", config: "" });
  assert.equal(tk.config.player.maxHealth, 10, "casual health is not reset by the new Hearts default");
  assert.equal(tk.config.shield.mode, "passive");
  done();
});

test("Set Controls: friendly key names", async () => {
  const { run, tk, done } = await setup({});
  run("Zelda: Set Controls", { sword: "Space, j", useItem: "", shield: "shift", action: "", nextItem: "", prevItem: "", inventory: "Tab" });
  assert.deepEqual(tk.config.controls.sword, ["Space", "j"]);
  assert.deepEqual(tk.config.controls.useItem, ["KeyC"], "empty = keep");
  assert.equal(normalizeKey("j"), "KeyJ");
  assert.equal(normalizeKey("shift"), "Shift");
  assert.equal(normalizeKey("tab"), "Tab");
  assert.equal(normalizeKey("up"), "ArrowUp");
  done();
});

test("doors, objects and rules without JSON", async () => {
  const { run, s, done } = await setup({});
  const obj = (id: string) => s.world.get(id) as unknown as { objState: string; isActive: boolean; visible: boolean; cfg: Record<string, unknown>; setState(v: string): void };
  run("Zelda: Create Door", { id: "boss_door", position: { x: 40, y: 40 }, smallKey: true, bigKey: true, bySwitch: false, startOpen: false, width: 0, height: 0 });
  run("Zelda: Create Door", { id: "plain", position: { x: 70, y: 40 }, smallKey: false, bigKey: false, bySwitch: false, startOpen: false, width: 0, height: 0 });
  run("Zelda: Create Door", { id: "gate", position: { x: 100, y: 40 }, smallKey: true, bigKey: false, bySwitch: true, startOpen: false, width: 0, height: 32 });
  assert.equal(obj("boss_door").cfg.lock, "big_key");
  assert.equal(obj("plain").cfg.lock, "none");
  assert.equal(obj("gate").cfg.lock, "switch", "switch wins over the key boxes");
  assert.equal(obj("gate").cfg.height, 32);

  run("Zelda: Create Object", { type: "pressure_plate", position: { x: 40, y: 90 }, id: "plate", hidden: false, staysOn: true, width: 0, height: 0, text: "", reactsTo: "", setFlag: "", openDoors: "", reveal: "" });
  run("Zelda: Create Object", { type: "reactive", position: { x: 80, y: 90 }, id: "eye", hidden: false, staysOn: false, width: 24, height: 0, text: "", reactsTo: "arrow, fire", setFlag: "eye_hit", openDoors: "plain", reveal: "secret" });
  run("Zelda: Create Object", { type: "sign", position: { x: 120, y: 90 }, id: "sign", text: "Hello" });
  run("Zelda: Create Chest", { id: "secret", position: { x: 160, y: 90 }, item: "rupees", count: 5, requiresBigKey: false, hidden: true });
  assert.equal(obj("plate").cfg.plateMode, "latch");
  assert.deepEqual(obj("eye").cfg.tools, ["arrow", "fire"]);
  assert.equal(obj("eye").cfg.width, 24);
  assert.equal(obj("eye").cfg.setFlag, "eye_hit");
  assert.deepEqual(obj("eye").cfg.onActivate, [{ openDoor: ["plain"] }, { reveal: ["secret"] }]);
  assert.equal(obj("sign").cfg.message, "Hello");

  run("Zelda: Add Rule", { id: "r1", whenDefeated: "", whenActive: "plate", whenFlag: "", whenItem: "", whenBoss: false, openDoors: "gate", reveal: "", setFlag: "gate_open", giveItem: "bombs", giveCount: 3, message: "Open!", spawnEnemy: "", spawnAt: "", once: true });
  run("Zelda: Add Rule", { id: "empty", openDoors: "gate" });
  assert.match(s.logger.history.at(-1)!.text, /no condition/);
  obj("plate").setState("on");
  s.update(50);
  assert.equal(obj("gate").objState, "opened");
  assert.equal(s.state.flags.gate_open, true);
  assert.equal(s.toolkit.inventory.count("bombs"), 3);

  // Run Actions: a condition that does not hold does nothing.
  run("Zelda: Run Actions", { whenItem: "bow", giveItem: "arrows", giveCount: 10 });
  assert.equal(s.toolkit.inventory.count("arrows"), 0);
  run("Zelda: Run Actions", { whenFlag: "gate_open", setFlag: "ran" });
  assert.equal(s.state.flags.ran, true);

  // Spawning from an action field at a marker.
  run("Zelda: Place Marker", { id: "spot", position: { x: 200, y: 200 } });
  run("Zelda: Run Actions", { spawnEnemy: "ogre", spawnAt: "spot" });
  const ogre = s.world.list("enemy").find((e) => (e as unknown as { cfg: { template: string } }).cfg.template === "ogre");
  assert.ok(ogre && Math.round(ogre.x) === 200 && Math.round(ogre.y) === 200, "ogre at the marker");
  done();
});

test("player stats, items, enemy types and animations without JSON", async () => {
  const { run, tk, s, done } = await setup({ hearts: 3 });
  run("Zelda: Change Player Stats", { health: 0, maxHealth: 2, magic: 0, set: false });
  assert.equal(tk.state.player.maxHp, 8);
  run("Zelda: Change Player Stats", { health: 3, maxHealth: 0, magic: 5, set: true });
  assert.equal(tk.state.player.hp, 3);
  assert.equal(tk.state.player.magic, 5);

  run("Zelda: Define Item", { id: "ice_rod", name: "Ice Rod", icon: "", resource: "magic", cost: 4, damage: 3, damageType: "ice", area: false, stunMs: 1000, heal: 0, give: true });
  run("Zelda: Define Item", { id: "herb", name: "Herb", icon: "", resource: "", cost: 0, damage: 0, damageType: "", area: false, stunMs: 0, heal: 4, give: false });
  assert.equal(tk.items.get("ice_rod")?.resource, "magic");
  assert.equal(tk.items.get("ice_rod")?.cost, 4);
  assert.equal(typeof tk.items.get("ice_rod")?.use, "function");
  assert.equal(typeof tk.items.get("herb")?.use, "function");
  assert.ok(tk.inventory.has("ice_rod"));

  run("Zelda: Define Enemy", { name: "tough_slime", basedOn: "slime", hp: 9, damage: 2, speed: 30, detectRange: 0, boss: true, immuneTo: "arrow" });
  run("Zelda: Create Enemy", { template: "tough_slime", position: { x: 120, y: 120 }, id: "ts", group: "", hp: 0, damage: 0, speed: 0, walkAnimation: "", attackAnimation: "", hurtAnimation: "", deathAnimation: "", patrol: "" });
  const e = s.world.get("ts") as unknown as { hp: number; cfg: { damage: number; speed: number; boss: boolean; resistances: Record<string, number>; animations: Record<string, string> } };
  assert.equal(e.hp, 9);
  assert.equal(e.cfg.damage, 2);
  assert.equal(e.cfg.speed, 30);
  assert.equal(e.cfg.boss, true);
  assert.equal(e.cfg.resistances.arrow, 0);
  run("Zelda: Create Enemy", { template: "slime", position: { x: 150, y: 120 }, id: "fast", hp: 5, speed: 90, walkAnimation: "w", attackAnimation: "a", spriteOffsetY: -16, spriteScale: 2 });
  const fast = s.world.get("fast") as unknown as typeof e;
  assert.equal(fast.hp, 5);
  assert.equal(fast.cfg.speed, 90);
  assert.equal(fast.cfg.animations.walk, "w");
  assert.equal(fast.cfg.animations.attack, "a");
  assert.equal((fast.cfg as unknown as { spriteOffsetY: number }).spriteOffsetY, -16);
  assert.equal((fast.cfg as unknown as { spriteScale: number }).spriteScale, 2);

  run("Zelda: Define Sprite Sheet", { id: "hero", image: "", imageKey: "", frameWidth: 16, frameHeight: 16, margin: 0, spacing: 0 });
  run("Zelda: Define Animation", { id: "walk4", sheet: "hero", frames: "0, 1", framesUp: "2 3", framesLeft: "", framesRight: "4,5", fps: 8, loop: true });
  assert.deepEqual(tk.config.sprites.animations.walk4?.frames, { down: [0, 1], up: [2, 3], right: [4, 5] });
  run("Zelda: Set Player Sprites", { attack: "walk4", behindUp: true, behindDown: false, behindLeft: true, behindRight: false, pivotY: 4 });
  assert.equal(tk.config.sword.pivotOffsetY, 4);
  assert.deepEqual(tk.config.player.sprites.weaponBehind, ["up", "left"]);
  done();
});
