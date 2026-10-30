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
