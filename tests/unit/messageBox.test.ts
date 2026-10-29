import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig } from "../helpers/fakeHost.ts";
import { dialogueSourceOf } from "../../src/ui/messageBox.ts";
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

test("without Message Style every toolkit message is a short HUD note", () => {
  const r = createRig();
  const d = dialogues(r);
  r.tk.bus.emit("zelda:message", { text: "An old sign.", durationMs: 1000, kind: "sign" });
  r.step(2);
  assert.deepEqual(d.played, []);
  assert.deepEqual(r.host.hud.last?.messages.map((m) => m.text), ["An old sign."]);
});

test("Message Style: the message is a PS Maker Dialogue in the chosen layout; queued; the game waits until it closes", async () => {
  const r = createRig();
  const d = dialogues(r);
  r.tk.messageBox = { layoutId: "zelda-dialogue-layout", kinds: ["sign", "item"] };
  r.tk.bus.emit("zelda:message", { text: "Arrows: move", durationMs: 1000, kind: "sign" });
  r.tk.bus.emit("zelda:message", { text: "You got a bow!", durationMs: 1000, kind: "item" });
  r.tk.bus.emit("zelda:message", { text: "Saved", durationMs: 1000, kind: "info" });
  r.step(2);
  assert.deepEqual(d.played, ["@dialogue_layout zelda-dialogue-layout\n\\Arrows: move"]);
  assert.deepEqual(r.host.hud.last!.messages.map((m) => m.text), ["Saved"], "other kinds stay notes");
  assert.ok(r.session.isPaused("message"));
  r.host.input.tap("action");
  r.step(3);
  assert.equal(d.played.length, 1, "keys belong to the dialogue");
  await d.close();
  r.step(2);
  assert.deepEqual(d.played.at(-1), "@dialogue_layout zelda-dialogue-layout\nYou got a bow!", "the next one opens");
  assert.ok(r.session.isPaused("message"));
  await d.close();
  r.step(2);
  assert.ok(!r.session.isPaused("message"));
});

test("Show Message as a dialogue goes to PS Maker even without Message Style; no dialogue in the engine = a HUD note", () => {
  const r = createRig();
  const d = dialogues(r);
  r.tk.bus.emit("zelda:message", { text: "Hello", durationMs: 1000, kind: "box" });
  r.step(2);
  assert.deepEqual(d.played, ["Hello"]);
  const plain = createRig();
  plain.tk.bus.emit("zelda:message", { text: "Hello", durationMs: 1000, kind: "box" });
  plain.step(2);
  assert.deepEqual(plain.host.hud.last?.messages.map((m) => m.text), ["Hello"]);
  assert.ok(!plain.session.isPaused("message"));
});

test("the press that closes a sign's dialogue does not read the sign again (real sign, action key)", async () => {
  const r = createRig();
  const d = dialogues(r);
  r.tk.messageBox = { layoutId: "", kinds: ["sign"] };
  r.step();
  r.host.walk(0, -1); // face up
  r.step();
  const p = r.host.player!;
  createObject(r.session, "sign", p.x, p.y - 16, { id: "s1", overrides: { message: "Welcome" } });
  r.host.input.tap("action");
  r.step(2);
  assert.deepEqual(d.played, ["Welcome"], "read");
  r.host.input.tap("action");
  await d.close();
  r.step(3);
  assert.equal(d.played.length, 1, "closed and not opened again by the same press");
  assert.equal(r.session.isPaused("message"), false);
});

test("a pause caught mid-blink (after a hit) shows the player", () => {
  const r = createRig();
  dialogues(r);
  r.tk.messageBox = { layoutId: "", kinds: ["sign"] };
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
  assert.equal(dialogueSourceOf("one\n\ntwo", "L"), "@dialogue_layout L\none\n\ntwo", "a blank line is a new page");
});
