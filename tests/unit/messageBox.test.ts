import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig } from "../helpers/fakeHost.ts";
import { dialogueSourceOf } from "../../src/ui/messageBox.ts";
import { parseLayout } from "../../src/ui/uiLayout.ts";
import { createObject } from "../../src/interactions/spawnObject.ts";

type Rig = ReturnType<typeof createRig>;

/** PS Maker's Dialogue as the host plays it: every source played, and a way to close the open one. */
function dialogues(r: Rig) {
  const played: string[] = [];
  let close: () => void = () => {};
  (r.host as any).playDialogue = (source: string) => {
    played.push(source);
    return new Promise<void>((ok) => (close = ok));
  };
  return {
    played,
    close: async () => {
      close();
      await new Promise((ok) => setTimeout(ok, 0));
    },
  };
}

/** The project's message screen (UI Designer, role Message) showing these kinds. */
function messageScreen(r: Rig, screen: Record<string, unknown> = {}) {
  r.tk.uiScreens.set("message", parseLayout(JSON.stringify({ v: 1, screen: { role: "message", kinds: ["sign", "item"], typing: 0, ...screen }, elements: [{ id: "t", type: "text", text: "{message}", wrap: true }] })).layout!);
}

/** What the message screen shows now (its {message} value), "" when it is closed. */
const shown = (r: Rig) => (r.host.hud.last?.screen?.name === "message" ? String(r.host.hud.last.screen.values.message) : "");

/** Lets the promise of a closed message settle, then runs a tick. */
async function settle(r: Rig, n = 2) {
  await new Promise((ok) => setTimeout(ok, 0));
  r.step(n);
}

test("without a message screen every toolkit message is a short HUD note", () => {
  const r = createRig();
  const d = dialogues(r);
  r.tk.bus.emit("zelda:message", { text: "An old sign.", durationMs: 1000, kind: "sign" });
  r.step(2);
  assert.deepEqual(d.played, []);
  assert.deepEqual(r.host.hud.last?.messages.map((m) => m.text), ["An old sign."]);
});

test("message screen: its kinds show in it, one at a time, page by page; the game waits; other kinds stay notes", async () => {
  const r = createRig();
  const d = dialogues(r);
  messageScreen(r);
  r.tk.bus.emit("zelda:message", { text: "Arrows: move\n\nX: sword", durationMs: 1000, kind: "sign" });
  r.tk.bus.emit("zelda:message", { text: "You got a bow!", durationMs: 1000, kind: "item" });
  r.tk.bus.emit("zelda:message", { text: "Saved", durationMs: 1000, kind: "info" });
  r.step(2);
  assert.deepEqual(d.played, [], "not PS Maker's dialogue");
  assert.equal(shown(r), "Arrows: move");
  assert.deepEqual(r.host.hud.last!.messages.map((m) => m.text), ["Saved"], "other kinds stay notes");
  assert.ok(r.session.isPaused("message"));
  assert.equal(r.host.locked, true);
  assert.equal(r.session.screens!.messageView().more, true);
  r.host.input.tap("action");
  r.step();
  assert.equal(shown(r), "X: sword", "the next page");
  assert.equal(r.session.screens!.messageView().more, false);
  r.host.input.tap("action");
  r.step();
  await settle(r);
  assert.equal(shown(r), "You got a bow!", "the next message");
  r.host.input.tap("sword");
  r.step();
  await settle(r);
  assert.equal(shown(r), "");
  assert.ok(!r.session.isPaused());
  assert.equal(r.host.locked, false);
});

test("message screen: the text types out; a key shows the whole page first", () => {
  const r = createRig();
  messageScreen(r, { typing: 30 });
  r.tk.bus.emit("zelda:message", { text: "A long message for the box.", durationMs: 1000, kind: "sign" });
  r.step(2);
  const early = shown(r);
  assert.ok(early.length < "A long message for the box.".length, `typing: "${early}"`);
  assert.equal(r.session.screens!.messageView().ready, false);
  r.run(200);
  assert.ok(shown(r).length > early.length, "more letters later");
  r.host.input.tap("action");
  r.step();
  assert.equal(shown(r), "A long message for the box.", "whole page, still open");
  assert.equal(r.session.screens!.messageView().ready, true);
});

test("Show Message in a box: the message screen when there is one, else PS Maker's dialogue, else a HUD note", () => {
  const r = createRig();
  const d = dialogues(r);
  r.tk.bus.emit("zelda:message", { text: "Hello", durationMs: 1000, kind: "box" });
  r.step(2);
  assert.deepEqual(d.played, ["Hello"]);
  const withScreen = createRig();
  messageScreen(withScreen, { kinds: [] });
  withScreen.tk.bus.emit("zelda:message", { text: "Hello", durationMs: 1000, kind: "box" });
  withScreen.step(2);
  assert.equal(shown(withScreen), "Hello", "a box always waits for a key, whatever the kinds");
  const plain = createRig();
  plain.tk.bus.emit("zelda:message", { text: "Hello", durationMs: 1000, kind: "box" });
  plain.step(2);
  assert.deepEqual(plain.host.hud.last?.messages.map((m) => m.text), ["Hello"]);
  assert.ok(!plain.session.isPaused("message"));
});

test("the press that closes a sign's message does not read the sign again (real sign, action key)", async () => {
  const r = createRig();
  messageScreen(r, { kinds: ["sign"] });
  r.step();
  r.host.walk(0, -1); // face up
  r.step();
  const p = r.host.player!;
  let read = 0;
  r.tk.bus.on("zelda:message", () => read++);
  createObject(r.session, "sign", p.x, p.y - 16, { id: "s1", overrides: { message: "Welcome" } });
  r.host.input.tap("action");
  r.step(2);
  assert.equal(shown(r), "Welcome", "read");
  r.host.input.tap("action");
  r.step();
  await settle(r, 3);
  assert.equal(read, 1, "closed and not opened again by the same press");
  assert.equal(r.session.isPaused("message"), false);
});

test("the press that closes PS Maker's dialogue (Show Message in a box) does not act again", async () => {
  const r = createRig();
  const d = dialogues(r);
  r.tk.bus.emit("zelda:message", { text: "Hi", durationMs: 1000, kind: "box" });
  r.step(2);
  assert.ok(r.session.isPaused("message"));
  r.host.input.tap("action");
  await d.close();
  r.step(2);
  assert.ok(!r.session.isPaused("message"));
  assert.equal(r.host.input.pressed("action"), false);
});

test("a pause caught mid-blink (after a hit) shows the player", () => {
  const r = createRig();
  messageScreen(r);
  r.host.blinkVisible = false; // as the invulnerability blink leaves it
  (r.session.player as any).blinkHidden = true;
  r.tk.bus.emit("zelda:message", { text: "Hi", durationMs: 1000, kind: "sign" });
  r.step(1);
  assert.equal(r.host.blinkVisible, true);
});

test("dialogue source: PS Maker syntax in the text is escaped", () => {
  assert.equal(dialogueSourceOf("Hello"), "Hello");
  assert.equal(dialogueSourceOf("Z: open"), "\\Z: open", "not a speaker name");
  assert.equal(dialogueSourceOf("@wait 100"), "\\@wait 100", "not a command");
  assert.equal(dialogueSourceOf("a *b* _c_ {d} \\e"), "a \\*b\\* \\_c\\_ \\{d\\} \\\\e", "no markup");
  assert.equal(dialogueSourceOf("one\n\ntwo"), "one\n\ntwo", "a blank line is a new page");
});

/** Runs a plugin action on a fresh toolkit (fake Phaser scene); returns how often it ended. */
async function pluginRig() {
  const { default: plugin } = await import("../../src/index.ts");
  const { getToolkit, resetToolkitForTests } = await import("../../src/editor/runtime.ts");
  const { createFakeScene } = await import("../helpers/fakePhaser.ts");
  resetToolkitForTests();
  const f = createFakeScene();
  const ends: Record<string, number> = {};
  const run = (name: string, params: Record<string, unknown>) => (plugin.events as any[]).find((e) => e.name === name)!.execute(params, { game: f.game, scene: f.scene, player: f.player, endAction: () => (ends[name] = (ends[name] ?? 0) + 1) });
  run("Zelda: Start Toolkit", { language: "en" });
  const tk = getToolkit();
  tk.configure({ debug: { logLevel: "silent" } });
  const screen = (name: string, role: string, list = false) =>
    tk.uiScreens.set(name, parseLayout(JSON.stringify({ v: 1, screen: { role, typing: 0 }, elements: [{ id: "who", type: "text", text: "{speaker}" }, { id: "t", type: "text", text: "{message}" }, { id: "face", type: "image", image: "{portrait}" }, ...(list ? [{ id: "answers", type: "choices", x: 10, y: 100, w: 80, h: 40, rowHeight: 12, gap: 2 }] : [])] })).layout!);
  // PS Maker's story runner and project variables, as the toolkit uses them.
  const played: unknown[] = [];
  const vars = new Map<string, { type: string; value: unknown }>([["ans", { type: "number", value: 0 }], ["answerText", { type: "string", value: "" }]]);
  (f.scene as any).storyRunner = { playActions: (a: unknown[]) => (played.push(...a), Promise.resolve()) };
  (f.game as any).variables = { get: (id: string) => vars.get(id), set: (id: string, v: unknown) => (vars.get(id)!.value = v) };
  const key = async (code: string) => {
    const input = tk.session!.host.input as any;
    input.onDown({ code });
    tk.session!.step(17);
    input.onUp({ code });
    tk.session!.step(17);
    await new Promise((ok) => setTimeout(ok, 0));
    tk.session!.step(17);
    await new Promise((ok) => setTimeout(ok, 0));
  };
  return { tk, run, ends, screen, played, vars, key, done: resetToolkitForTests, step: (n = 2) => { for (let i = 0; i < n; i++) tk.session!.step(17); } };
}

test("Zelda: Dialogue: the NPC's words in the dialogue box with {speaker} and {portrait}; the PS Maker event waits until it is closed", async () => {
  const r = await pluginRig();
  r.screen("talk", "dialogue");
  r.screen("message", "message");
  r.run("Zelda: Dialogue", { name: "Villager", text: "Hello!\\n\\nTake care.", portrait: "face-villager", wait: true });
  r.step();
  const sc = r.tk.session!.screens!;
  assert.equal(sc.current?.name, "talk", "the dialogue box, not the message box");
  const values = r.tk.session!.hud!.values(sc.current!.layout);
  assert.deepEqual([values.speaker, values.message, values.portrait], ["Villager", "Hello!", "face-villager"]);
  assert.equal(r.ends["Zelda: Dialogue"], undefined, "the event waits");
  assert.ok(r.tk.session!.isPaused("message"));
  const input = r.tk.session!.host.input as any;
  const press = async () => {
    input.onDown({ code: "KeyZ" });
    r.step(1);
    input.onUp({ code: "KeyZ" });
    r.step(1);
    await new Promise((ok) => setTimeout(ok, 0));
    r.step(1);
  };
  await press();
  assert.equal(r.tk.session!.hud!.values(sc.current!.layout).message, "Take care.", "the second page");
  await press();
  assert.equal(sc.current, null);
  assert.equal(r.ends["Zelda: Dialogue"], 1, "ended once it was closed");
  r.run("Zelda: Dialogue", { name: "", text: "Bye", wait: false });
  assert.equal(r.ends["Zelda: Dialogue"], 2, "Wait until closed off: the event goes on at once");
  r.done();
});

test("Zelda: Dialogue without a dialogue box: the message box; without either, PS Maker's dialogue with the speaker's @name", async () => {
  const r = await pluginRig();
  r.screen("message", "message");
  r.run("Zelda: Dialogue", { name: "Guard", text: "Halt." });
  r.step();
  assert.equal(r.tk.session!.screens!.current?.name, "message");
  r.done();
  assert.equal(dialogueSourceOf("Halt.", "Guard"), '@name "Guard"\nHalt.');
});

test("notification screen: every short note is drawn with it ({note}), stacked; the HUD's own note box stays empty", () => {
  const r = createRig();
  r.tk.uiScreens.set("toast", parseLayout(JSON.stringify({ v: 1, screen: { role: "notification" }, elements: [{ id: "t", type: "text", y: 30, h: 10, text: "{note}" }] })).layout!);
  r.tk.bus.emit("zelda:message", { text: "Saved", durationMs: 1000, kind: "info" });
  r.tk.bus.emit("zelda:message", { text: "You got 5 bombs!", durationMs: 1000, kind: "info" });
  r.step(2);
  const m = r.host.hud.last!;
  assert.deepEqual(m.messages, []);
  assert.deepEqual(m.layers.map((l) => [l.name, l.values.note, l.stack]), [["toast", "Saved", 0], ["toast", "You got 5 bombs!", 1]]);
  assert.ok(!r.session.isPaused(), "the game plays on");
  r.run(1200);
  assert.deepEqual(r.host.hud.last!.layers, [], "gone when the notes end");
});

test("Zelda: Dialogue answers: shown in the Choice list after the last page; arrows and Z pick one; its event runs, the variable gets it, then the PS Maker event goes on", async () => {
  const r = await pluginRig();
  r.screen("talk", "dialogue", true);
  r.run("Zelda: Dialogue", { name: "Villager", text: "Need a hint?", choice1: "Yes", event1: "ev-hint", choice2: "", choice3: "No thanks", event3: "ev-bye", answer: "ans" });
  r.step();
  const view = () => r.tk.session!.screens!.messageView();
  assert.deepEqual([view().choices, view().choice], [["Yes", "No thanks"], 0], "answers keep their order; empty ones are left out");
  assert.equal(view().text, "Need a hint?", "a layout with a Choice list keeps them out of the text");
  await r.key("KeyX");
  assert.equal(r.tk.session!.screens!.current?.name, "talk", "back keys do not skip the question");
  await r.key("ArrowDown");
  assert.equal(view().choice, 1);
  assert.equal(r.ends["Zelda: Dialogue"], undefined);
  await r.key("KeyZ");
  assert.equal(r.tk.session!.screens!.current, null);
  assert.equal(r.vars.get("ans")!.value, 3, "answer 3 (its slot), in a Number variable");
  assert.deepEqual(r.played.map((a: any) => [a.type, a.storyEventId]), [["runStoryEventAction", "ev-bye"]]);
  assert.equal(r.ends["Zelda: Dialogue"], 1, "ended after the answer's event");
  r.done();
});

test("Zelda: Dialogue answers in a Text variable; a box without a Choice list shows them under the text", async () => {
  const r = await pluginRig();
  r.screen("talk", "dialogue");
  r.run("Zelda: Dialogue", { text: "Left or right?", choice1: "Left", choice2: "Right", answer: "answerText" });
  r.step();
  assert.equal(r.tk.session!.screens!.messageView().text, "Left or right?\n> Left\n  Right");
  await r.key("ArrowDown");
  await r.key("KeyZ");
  assert.equal(r.vars.get("answerText")!.value, "Right");
  assert.deepEqual(r.played, [], "no event for that answer");
  assert.equal(r.ends["Zelda: Dialogue"], 1);
  r.done();
});
