import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig } from "../helpers/fakeHost.ts";
import { nextButton, parseLayout, readElement, type UiLayout } from "../../src/ui/uiLayout.ts";

const button = (id: string, x: number, y: number, action: Record<string, string> = {}) => ({ id, type: "button", x, y, w: 60, h: 14, text: id, action });

/** A pause menu: Continue / Items / Quit in a column, a Back button to the right of Items. */
function pauseMenu(extra: Record<string, unknown> = {}): UiLayout {
  return parseLayout(
    JSON.stringify({
      v: 1,
      screen: { menuKey: true, ...extra },
      elements: [
        { id: "title", type: "text", x: 10, y: 4, text: "Paused" },
        button("continue", 100, 40, { kind: "close" }),
        button("items", 100, 60, { kind: "open", id: "items" }),
        button("quit", 100, 80, { kind: "event", id: "ev-quit" }),
        button("light", 180, 60, { kind: "variable", id: "lamp", value: "1" }),
      ],
    }),
  ).layout!;
}

test("a button: its action and looks are read like every element; defaults for the rest", () => {
  const b = readElement({ type: "button", action: { kind: "event", id: "e1" } }) as any;
  assert.deepEqual(b.action, { kind: "event", id: "e1", value: "" });
  assert.deepEqual([b.slice, b.size, b.color], [4, 8, "#1f1a24e6"]);
  assert.equal((readElement({ type: "button", action: { kind: "explode" } }) as any).action.kind, "none");
  const L = parseLayout('{"elements": []}').layout!;
  assert.deepEqual(L.screen, { input: true, pause: true, dim: "#00000080", menuKey: false, soundMove: "", soundPress: "", soundOpen: "", soundClose: "" }, "screen defaults");
});

test("selection moves to the nearest button that way, and stays at the edge", () => {
  const boxes = { a: { x: 0, y: 0, w: 10, h: 10 }, b: { x: 0, y: 20, w: 10, h: 10 }, c: { x: 30, y: 22, w: 10, h: 10 }, d: { x: 0, y: 40, w: 10, h: 10 } };
  const ids = ["a", "b", "c", "d"];
  assert.equal(nextButton(boxes, ids, "a", "down"), "b");
  assert.equal(nextButton(boxes, ids, "b", "down"), "d", "straight down beats the one off to the side");
  assert.equal(nextButton(boxes, ids, "b", "right"), "c");
  assert.equal(nextButton(boxes, ids, "a", "up"), "a", "nothing above");
});

test("Menu key opens the menu screen: the game pauses and the player stands still; back closes it", () => {
  const r = createRig();
  r.tk.uiScreens.set("pause", pauseMenu());
  r.host.input.tap("menu");
  r.step();
  assert.equal(r.session.screens!.current?.name, "pause");
  assert.ok(r.session.isPaused("screen"));
  assert.equal(r.host.locked, true);
  const m = r.host.hud.last!;
  assert.equal(m.screen?.name, "pause");
  assert.equal(m.screen?.focus, "continue", "the first button is selected");
  r.host.input.tap("sword");
  r.step();
  assert.equal(r.session.screens!.current, null);
  assert.ok(!r.session.isPaused("screen"));
  assert.equal(r.host.locked, false);
  assert.equal(r.host.hud.last!.screen, null);
});

test("arrows move the selection, the action key presses: event, variable, open (back returns), close", () => {
  const r = createRig();
  const items = parseLayout(JSON.stringify({ v: 1, elements: [button("back", 10, 10, { kind: "close" })] })).layout!;
  r.tk.uiScreens.set("pause", pauseMenu());
  r.tk.uiScreens.set("items", items);
  r.host.variables.set("lamp", 0);
  const pressed: string[] = [];
  r.tk.bus.on("zelda:ui:button", (e) => pressed.push(`${e.screen}/${e.id}`));
  r.session.screens!.open("pause");
  const go = (a: "up" | "down" | "left" | "right" | "action" | "sword") => {
    r.host.input.tap(a);
    r.step();
  };
  go("down");
  go("down");
  assert.equal(r.session.screens!.current?.focus, "quit");
  go("action");
  assert.deepEqual(r.host.events, ["ev-quit"], "a PS Maker event by id");
  go("up");
  go("right");
  assert.equal(r.session.screens!.current?.focus, "light");
  go("action");
  assert.equal(r.host.variables.get("lamp"), "1", "the variable is set (the host converts to its type)");
  go("left");
  go("action");
  assert.equal(r.session.screens!.current?.name, "items", "a screen opened from the menu");
  go("action");
  assert.equal(r.session.screens!.current?.name, "pause", "its Back goes back to the menu");
  assert.ok(r.session.isPaused("screen"));
  go("up");
  go("action");
  assert.equal(r.session.screens!.current, null, "Continue closes the menu");
  assert.deepEqual(pressed, ["pause/quit", "pause/light", "pause/items", "items/back", "pause/continue"]);
});

test("the pointer selects the button under it and a click presses it (layout pixels)", () => {
  const r = createRig();
  r.tk.uiScreens.set("pause", pauseMenu());
  r.session.screens!.open("pause");
  r.host.hud.pointer!("move", 110, 85);
  assert.equal(r.session.screens!.current?.focus, "quit");
  r.host.hud.pointer!("move", 5, 5);
  assert.equal(r.session.screens!.current?.focus, "quit", "off the buttons: unchanged");
  r.host.hud.pointer!("down", 110, 45);
  assert.equal(r.session.screens!.current, null, "Continue clicked");
});

test("while a screen is open the inventory key goes back instead of opening the inventory; a screen can leave the game running", () => {
  const r = createRig();
  r.tk.uiScreens.set("pause", pauseMenu());
  r.tk.uiScreens.set("map", pauseMenu({ pause: false, menuKey: false }));
  r.session.screens!.open("pause");
  r.host.input.tap("inventory");
  r.step();
  assert.equal(r.session.inventoryUi!.open, false);
  assert.equal(r.session.screens!.current, null);
  r.session.screens!.open("map");
  r.step();
  assert.ok(!r.session.isPaused(), "the game runs under this screen");
  assert.equal(r.host.locked, false);
});

test("Open UI Screen and Close UI Screen actions; an unknown screen is reported once", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  const { createFakeScene } = await import("../helpers/fakePhaser.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as any[]).find((e) => e.name === name)!.execute(params, { game: f.game, scene: f.scene, player: f.player });
  run("Zelda: Start Toolkit", { language: "en" });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  run("Zelda: UI Layout", { name: "pause", layout: JSON.stringify(pauseMenu()) });
  assert.ok(tk.uiScreens.has("pause"));
  assert.equal(tk.hudLayout, null, "a screen does not replace the HUD");
  run("Zelda: Open UI Screen", { name: "pause" });
  assert.equal(tk.session!.screens!.current?.name, "pause");
  run("Zelda: Open UI Screen", { name: "nope" });
  assert.equal(tk.session!.screens!.current?.name, "pause", "unknown: nothing changes");
  run("Zelda: Close UI Screen", {});
  assert.equal(tk.session!.screens!.current, null);
  // Another map: its own HUD (classic until its UI Layout runs); the screens stay known.
  run("Zelda: UI Layout", { layout: JSON.stringify({ v: 1, elements: [{ id: "x", type: "text" }] }) });
  assert.ok(tk.hudLayout);
  tk.start(tk.session!.host, "other_map");
  assert.equal(tk.hudLayout, null);
  assert.ok(tk.uiScreens.has("pause"));
  resetToolkitForTests();
});

/** The open screen's name (a call, so a test can check it again after an earlier check narrowed it). */
const topScreen = (r: ReturnType<typeof createRig>) => r.session.screens!.current?.name ?? null;

test("a screen that does not take the keys is a layer: the game plays on, keys go to the game, closed by name", () => {
  const r = createRig();
  r.tk.uiScreens.set("boss", parseLayout(JSON.stringify({ v: 1, screen: { input: false }, elements: [{ id: "hp", type: "bar" }] })).layout!);
  r.tk.uiScreens.set("pause", pauseMenu());
  r.session.screens!.open("boss");
  r.step();
  assert.ok(!r.session.isPaused());
  assert.equal(r.session.screens!.current, null, "not the open screen");
  assert.deepEqual(r.host.hud.last!.layers.map((l) => l.name), ["boss"]);
  r.host.input.tap("menu");
  r.step();
  assert.equal(topScreen(r), "pause", "the menu opens over the layer");
  r.session.screens!.close();
  r.session.screens!.close(false, "pause");
  assert.deepEqual(r.session.screens!.layers.map((l) => l.name), ["boss"], "closing the top screen leaves the layer");
  r.session.screens!.close(false, "boss");
  r.step();
  assert.deepEqual(r.host.hud.last!.layers, []);
});

test("screen sounds: opens, selection moves, button pressed, closes", () => {
  const r = createRig();
  r.tk.uiScreens.set("pause", pauseMenu({ soundOpen: "s-open", soundMove: "s-move", soundPress: "s-press", soundClose: "s-close" }));
  r.session.screens!.open("pause");
  r.host.input.tap("down");
  r.step();
  r.host.input.tap("up");
  r.step();
  r.host.input.tap("action");
  r.step();
  assert.deepEqual(r.host.sounds.map((s) => s.src), ["s-open", "s-move", "s-move", "s-press", "s-close"]);
});
