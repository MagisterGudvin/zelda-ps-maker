import { test } from "node:test";
import assert from "node:assert/strict";
import { createDefaultConfig } from "../../src/core/config.ts";
import { GamepadBridge, gamepadMapping, padButtonLabel, padFamily, type PadSnapshot } from "../../src/host/gamepadBridge.ts";
import { KeyboardInput } from "../../src/host/keyboardInput.ts";
import { createRig } from "../helpers/fakeHost.ts";
import { parseLayout } from "../../src/ui/uiLayout.ts";
import { bindAction, rememberProjectControls, resetPlayerControls, applyPlayerControls } from "../../src/core/playerControls.ts";

const MOVE = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

function bridge(pads: PadSnapshot[], cfg = createDefaultConfig()) {
  const sent: string[] = [];
  const b = new GamepadBridge({ readPads: () => pads, send: (t, c) => sent.push(`${t === "keydown" ? "+" : "-"}${c}`), mapping: () => gamepadMapping(cfg, MOVE), deadzone: () => 0.5 });
  return { b, sent };
}

const pad = (pressed: number[], axes: number[] = [0, 0], id = "Xbox 360 Controller (XInput STANDARD GAMEPAD)"): PadSnapshot => ({ id, buttons: Array.from({ length: 17 }, (_, i) => pressed.includes(i)), axes });

test("gamepad bridge: buttons press the toolkit's keys and PS Maker's movement keys, the stick too; a key is let go when no button holds it", () => {
  const cfg = createDefaultConfig();
  cfg.controls.gamepad.extra = [{ button: 4, key: "KeyF" }, { button: 13, key: "ArrowDown" }];
  const m = gamepadMapping(cfg, MOVE);
  assert.deepEqual(m.get(0), ["KeyX"], "sword on A");
  assert.deepEqual(m.get(3), ["KeyB"], "item 2 on Y");
  assert.deepEqual(m.get(8), ["Escape"], "the pause key on View/Back");
  assert.deepEqual(m.get(4), ["KeyF"], "an extra button presses any key (PS Maker keyboard triggers)");
  const pads = [pad([0])];
  const { b, sent } = bridge(pads, cfg);
  b.poll();
  assert.deepEqual(sent, ["+KeyX"]);
  pads[0] = pad([], [-0.9, 0.2]);
  b.poll();
  assert.deepEqual(sent, ["+KeyX", "+ArrowLeft", "-KeyX"], "the stick leans left; A let go");
  pads[0] = pad([14], [-0.9, 0]);
  b.poll();
  pads[0] = pad([14], [0, 0]);
  b.poll();
  assert.equal(sent.filter((x) => x === "-ArrowLeft").length, 0, "the d-pad still holds Left");
  pads[0] = pad([], [0, 0]);
  b.poll();
  assert.deepEqual(sent.slice(-1), ["-ArrowLeft"]);
  pads[0] = pad([2]);
  b.poll();
  b.releaseAll();
  assert.deepEqual(sent.slice(-2), ["+KeyC", "-KeyC"], "let go when the toolkit stops");
});

test("gamepad bridge: rebinding takes the next new button instead of the game; the pad family names the buttons", () => {
  const pads = [pad([])];
  const { b, sent } = bridge(pads);
  let got = -1;
  b.captureNext((n) => (got = n));
  pads[0] = pad([5]);
  b.poll();
  pads[0] = pad([]);
  b.poll();
  assert.equal(got, 5);
  assert.deepEqual(sent, [], "the captured button pressed no key");
  assert.equal(padFamily("Sony Interactive Entertainment Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)"), "playstation");
  assert.equal(padFamily("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)"), "nintendo");
  assert.equal(padFamily("Steam Deck Controller"), "xbox");
  assert.deepEqual([0, 1, 2, 3].map((i) => padButtonLabel(i, "playstation")), ["Cross", "Circle", "Square", "Triangle"]);
  assert.deepEqual([0, 1].map((i) => padButtonLabel(i, "nintendo")), ["B", "A"]);
});

test("mouse buttons are keys too (MouseLeft / MouseRight, as PS Maker names them); a real key makes the keyboard the device; the next key can be captured", () => {
  const cfg = createDefaultConfig();
  cfg.controls.sword = ["MouseLeft"];
  cfg.controls.useItem = ["MouseRight"];
  const handlers: Record<string, (e: unknown) => void> = {};
  const emitter = (prefix: string) => ({ on: (ev: string, f: (e: unknown) => void) => (handlers[prefix + ev] = f), off() {} });
  const input = new KeyboardInput(cfg, emitter("k:") as never, null, emitter("m:") as never);
  handlers["m:pointerdown"]({ button: 2 });
  input.latch();
  assert.ok(input.pressed("useItem"));
  handlers["m:pointerup"]({ button: 2 });
  handlers["m:pointerdown"]({ button: 0 });
  input.latch();
  assert.ok(input.pressed("sword"));
  input.device = { kind: "gamepad", family: "playstation" };
  handlers["k:keydown"]({ code: "KeyQ", isTrusted: false });
  assert.equal(input.device.kind, "gamepad", "a key the gamepad bridge sent keeps the gamepad");
  input.latch();
  assert.ok(input.pressed("prevItem"), "and it is a press like any other");
  let got = "";
  input.captureNext((c) => (got = c));
  handlers["k:keydown"]({ code: "KeyK", isTrusted: true });
  input.latch();
  assert.equal(got, "KeyK");
  assert.equal(input.device.kind, "keyboard");
  assert.ok(!input.pressed("nextItem") && !input.pressed("prevItem"), "the captured key did nothing else");
});

/** localStorage for these tests. */
function memoryStorage() {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) };
  return m;
}

test("the player's own keys: a key already used swaps; kept in the browser and laid over the project's controls (Set Controls too); Reset goes back", () => {
  const store = memoryStorage();
  const r = createRig();
  r.tk.projectKey = "demo";
  rememberProjectControls(r.tk);
  bindAction(r.tk, "sword", { key: "KeyC" });
  assert.deepEqual([r.tk.config.controls.sword[0], r.tk.config.controls.useItem[0]], ["KeyC", "KeyX"], "C was the item key: they swap");
  bindAction(r.tk, "shield", { button: 0 });
  assert.deepEqual([r.tk.config.controls.gamepad.shield, r.tk.config.controls.gamepad.sword], [0, 5], "A was the sword button: they swap");
  assert.ok(store.get("zelda-maker-toolkit:controls:demo"), "kept for the project");
  // A new map: the project's controls again, then the player's on top.
  r.tk.configure({ controls: r.tk.projectControls! });
  applyPlayerControls(r.tk);
  assert.equal(r.tk.config.controls.sword[0], "KeyC");
  resetPlayerControls(r.tk);
  assert.deepEqual([r.tk.config.controls.sword[0], r.tk.config.controls.gamepad.shield], ["KeyX", 5]);
  assert.equal(store.size, 0);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("key bindings screen: arrows pick an action and a column, Z waits for the new key (or pad button), Escape cancels; Reset button; key prompts follow the device", () => {
  memoryStorage();
  const r = createRig();
  rememberProjectControls(r.tk);
  r.tk.uiScreens.set(
    "controls",
    parseLayout(
      JSON.stringify({
        v: 1,
        elements: [
          { id: "keys", type: "keybinds", x: 10, y: 10, w: 160, h: 99 },
          { id: "reset", type: "button", x: 10, y: 120, w: 60, h: 14, text: "Reset", action: { kind: "resetControls" } },
          { id: "prompt", type: "text", x: 10, y: 140, text: "{key:sword} swings" },
        ],
      }),
    ).layout!,
  );
  r.session.screens!.open("controls");
  r.step();
  const view = () => r.session.screens!.keybindsView()!;
  assert.deepEqual(view().rows.map((x) => x.label).slice(0, 5), ["Move up", "Move down", "Move left", "Move right", "Sword"], "walking first, then the toolkit's actions");
  assert.equal(view().rows[0].pad, "Up", "walking keeps the d-pad");
  assert.deepEqual(view().rows.slice(4, 6).map((x) => [x.label, x.key, x.pad]), [["Sword", "X", "A"], ["Item 1", "C", "X"]]);
  for (let i = 0; i < 4; i++) {
    r.host.input.tap("down");
    r.step();
  }
  r.host.input.tap("action");
  r.step();
  assert.ok(view().waiting && r.host.input.capture, "waiting for the new key");
  r.host.input.captured("KeyJ");
  r.step();
  assert.equal(r.tk.config.controls.sword[0], "KeyJ");
  assert.equal(r.host.hud.last!.screen!.values["key:sword"], "J", "the prompt shows the new key");
  // The gamepad column of the next row.
  r.host.input.tap("down");
  r.step();
  r.host.input.tap("right");
  r.step();
  r.host.input.tap("action");
  r.step();
  assert.ok(r.host.padCapture);
  r.host.padCaptured(4);
  r.step();
  assert.equal(r.tk.config.controls.gamepad.useItem, 4);
  r.host.input.device = { kind: "gamepad", family: "playstation" };
  r.step();
  assert.equal(r.host.hud.last!.screen!.values["key:sword"], "Cross", "with a PlayStation pad: its name");
  // Escape while waiting for a key: cancelled.
  r.host.input.tap("left");
  r.step();
  r.host.input.tap("action");
  r.step();
  r.host.input.captured("Escape");
  r.step();
  assert.equal(r.tk.config.controls.useItem[0], "KeyC");
  // Down past the last row: the Reset button.
  for (let i = 0; i < 9; i++) {
    r.host.input.tap("down");
    r.step();
  }
  assert.equal(r.session.screens!.current!.focus, "reset");
  r.host.input.tap("action");
  r.step();
  assert.deepEqual([r.tk.config.controls.sword[0], r.tk.config.controls.gamepad.useItem], ["KeyX", 2]);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test("walking keys: the player gives Move up a key of their own; keys swap between rows; PS Maker is handed its own key for it (walking and Interact); the gamepad keeps the d-pad", () => {
  memoryStorage();
  const r = createRig();
  rememberProjectControls(r.tk);
  bindAction(r.tk, "up", { key: "KeyK" });
  assert.deepEqual(r.tk.config.controls.move.up, ["KeyK", "KeyW"], "the main key changes, the second stays");
  assert.deepEqual(r.host.gameKeys?.moveUp, ["KeyK", "KeyW"], "PS Maker's Move up gets the player's keys");
  // A key of another row moves over: its main key gets this row's old one.
  bindAction(r.tk, "sword", { key: "ArrowDown" });
  assert.deepEqual(r.tk.config.controls.sword, ["ArrowDown"]);
  assert.deepEqual(r.tk.config.controls.move.down, ["KeyX", "KeyS"], "Move down got the sword's old key");
  // A second key of another row is just dropped there.
  bindAction(r.tk, "action", { key: "KeyW" });
  assert.deepEqual(r.tk.config.controls.move.up, ["KeyK"]);
  assert.deepEqual(r.host.gameKeys?.interact, ["KeyW"], "the Action row is PS Maker's Interact too");
  bindAction(r.tk, "left", { button: 3 });
  assert.equal(r.tk.config.controls.gamepad.useItem2, 3, "no pad button for walking: nothing changes");
  resetPlayerControls(r.tk);
  assert.deepEqual(r.tk.config.controls.move.up, ["ArrowUp", "KeyW"]);
  assert.deepEqual(r.host.gameKeys, {}, "PS Maker's own keys again");
  delete (globalThis as { localStorage?: unknown }).localStorage;
});
