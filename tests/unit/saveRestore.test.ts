import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeProgress } from "../../src/save/save.ts";
import { createFakeScene } from "../helpers/fakePhaser.ts";
import { isRestoredMap, mapBuildingActions, startRestoreWatcher } from "../../src/editor/saveRestore.ts";

type AnyAction = { name: string; execute(params: Record<string, unknown>, ctx: unknown): void };

async function setup() {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  // PS Maker project variables (game.variables: get(id) → { type, value }, set(id, value)).
  const vars = new Map<string, { id: string; type: string; value: unknown }>([["var_progress", { id: "var_progress", type: "string", value: "" }]]);
  f.game.variables = { get: (id: string) => vars.get(id), set: (id: string, v: unknown) => (vars.get(id)!.value = v) };
  const actions = plugin.events as unknown as AnyAction[];
  const run = (name: string, params: Record<string, unknown>, scene = f.scene) => actions.find((e) => e.name === name)!.execute(params, { game: f.game, scene, player: f.player });
  return { f, vars, actions, run, getToolkit, done: resetToolkitForTests };
}
const step = (s: { update(ms: number): void }, n = 20) => {
  for (let i = 0; i < n; i++) s.update(17);
};

test("progress variable: holds the toolkit's progress; a loaded save restores it, an emptied one starts over", async () => {
  const { vars, run, getToolkit, done } = await setup();
  run("Zelda: Start Toolkit", { language: "en", progressVariable: "var_progress" });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  tk.inventory.give("rupees", 30, { silent: true });
  step(tk.session!);
  const saved = vars.get("var_progress")!.value as string;
  assert.equal(JSON.parse(saved).state.inventory.counts.rupees, 30, "written into the variable");

  tk.inventory.give("rupees", 20, { silent: true });
  step(tk.session!);
  assert.equal(JSON.parse(vars.get("var_progress")!.value as string).state.inventory.counts.rupees, 50, "kept up to date");

  vars.get("var_progress")!.value = saved; // PS Maker loads a save: restoreGlobalState sets the variable
  step(tk.session!);
  assert.equal(tk.inventory.count("rupees"), 30, "progress from the save");
  assert.equal(vars.get("var_progress")!.value, saved, "the restored value is not rewritten");

  vars.get("var_progress")!.value = ""; // a new game: variables back to their defaults
  step(tk.session!);
  assert.equal(tk.inventory.count("rupees"), 0, "starts over");
  assert.notEqual(vars.get("var_progress")!.value, "", "and writes the fresh progress");
  done();
});

test("a map restored from a PS Maker save: its Zelda map actions run (no effects), not on a normal start", async () => {
  const { f, actions, getToolkit, done } = await setup();
  const map = {
    id: "field",
    setupActions: [],
    initialActions: [
      { type: "plugin:zelda-maker-toolkit:zelda-start-toolkit", actionName: "Zelda: Start Toolkit", pluginName: "Zelda Maker Toolkit", pluginParams: { language: "en" } },
      { type: "dialogueAction", dialogueSource: "Hi" },
      { type: "plugin:zelda-maker-toolkit:zelda-create-chest", actionName: "Zelda: Create Chest", pluginName: "Zelda Maker Toolkit", pluginParams: { item: "bombs", count: 5, position: { x: 80, y: 80 } } },
      { type: "plugin:zelda-maker-toolkit:zelda-give-item", actionName: "Zelda: Give Item", pluginName: "Zelda Maker Toolkit", pluginParams: { item: "boomerang", count: 1 } },
    ],
  };
  assert.deepEqual(mapBuildingActions(map).map((a) => a.actionName), ["Zelda: Start Toolkit", "Zelda: Create Chest"]);
  assert.equal(isRestoredMap({ mapStartSnapshot: { executions: [] }, hasSavedMapStartup: false }), true);
  assert.equal(isRestoredMap({ mapStartSnapshot: { executions: [{}] }, hasSavedMapStartup: true }), false, "PS Maker resumes a startup that was running");
  assert.equal(isRestoredMap({ mapStartSnapshot: null }), false);
  assert.equal(isRestoredMap({ mapStartSnapshot: {}, mapStartup: { needsStart: true, hasSavedStartup: false } }), false, "PS Maker will run Map start");
  assert.equal(isRestoredMap({ mapStartSnapshot: null, mapStartup: { needsStart: false, hasSavedStartup: false } }), true);

  const fresh = Object.assign(createFakeScene().scene, { map, sceneCreated: true, mapStartSnapshot: null });
  const restored = Object.assign(f.scene, { map, sceneCreated: true, mapStartSnapshot: { executions: [] }, hasSavedMapStartup: false, player: f.player });
  let tick = () => {};
  const win: any = { document: {}, setInterval: (fn: () => void) => ((tick = fn), 1), clearInterval: () => {}, game: f.game };
  f.game.scene.getScenes = () => [fresh];
  startRestoreWatcher(actions, win);
  tick();
  assert.equal(getToolkit().session, null, "a normal map start is left to PS Maker");
  f.game.scene.getScenes = () => [restored];
  tick();
  const s = getToolkit().session!;
  assert.ok(s, "started");
  assert.ok(s.world.list("object").some((o) => (o as any).type === "chest"), "the chest is back");
  assert.equal(getToolkit().inventory.has("boomerang"), false, "effects are not repeated");
  tick();
  assert.equal(getToolkit().session, s, "once per scene");
  startRestoreWatcher(actions, {});
  done();
});

test("progress variable: already filled when the toolkit starts (a save loaded on a fresh page) is restored", async () => {
  const { vars, run, getToolkit, done } = await setup();
  run("Zelda: Start Toolkit", { language: "en", progressVariable: "var_progress" });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  tk.inventory.give("rupees", 77, { silent: true });
  const saved = serializeProgress(tk.state);
  done();
  const again = await setup();
  again.vars.get("var_progress")!.value = saved;
  again.run("Zelda: Start Toolkit", { language: "en", progressVariable: "var_progress" });
  step(again.getToolkit().session!);
  assert.equal(again.getToolkit().inventory.count("rupees"), 77);
  assert.equal(again.vars.get("var_progress")!.value, saved);
  void vars;
  again.done();
});
