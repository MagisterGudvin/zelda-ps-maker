import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig } from "../helpers/fakeHost.ts";
import { CLASSIC_STYLE, styleFromLayout } from "../../src/ui/messageBox.ts";
import { createObject } from "../../src/interactions/spawnObject.ts";

const settings = (over: Record<string, unknown> = {}) => ({ kinds: ["sign", "item"] as any[], typing: true, waitForKey: true, pause: true, position: "bottom" as const, style: { ...CLASSIC_STYLE, typingSpeed: 60 }, ...over });

test("without Message Style every toolkit message is a short HUD note", () => {
  const r = createRig();
  r.tk.bus.emit("zelda:message", { text: "An old sign.", durationMs: 1000, kind: "sign" });
  r.step(2);
  assert.equal(r.host.hud.last?.box, null);
  assert.deepEqual(r.host.hud.last?.messages.map((m) => m.text), ["An old sign."]);
});

test("Message Style: a sign opens the box, typed letter by letter; the action key finishes, then closes; the game waits", () => {
  const r = createRig();
  r.tk.messageBox = settings();
  r.tk.bus.emit("zelda:message", { text: "Beware of the slimes!", durationMs: 1000, kind: "sign" });
  r.tk.bus.emit("zelda:message", { text: "Saved.", durationMs: 1000, kind: "info" });
  r.step(1);
  const hud = () => r.host.hud.last!;
  assert.equal(hud().box?.text, "Beware of the slimes!");
  assert.deepEqual(hud().messages.map((m) => m.text), ["Saved."], "kinds not chosen stay HUD notes");
  assert.ok(r.session.isPaused("message") && r.session.player.isLocked("message"), "enemies and the player wait");
  r.step(10); // 60 letters a second: 10 ticks ≈ 10 letters
  const typed = hud().box!.shown;
  assert.ok(typed >= 8 && typed <= 11, `typed ${typed}`);
  assert.equal(hud().box!.waiting, false);
  r.host.input.tap("action");
  r.step(1);
  assert.equal(hud().box!.shown, "Beware of the slimes!".length, "the key shows the rest");
  assert.equal(hud().box!.waiting, true);
  r.step(30);
  assert.ok(hud().box, "waits for the key");
  r.host.input.tap("action");
  r.step(2);
  assert.equal(hud().box, null);
  assert.ok(!r.session.isPaused("message") && !r.session.player.isLocked("message"));
});

test("Message Style: queued messages one after another; the opening press does not close; no waiting closes by itself", () => {
  const r = createRig();
  r.tk.messageBox = settings({ typing: false });
  // The action press that read the sign is the same tick the box opens.
  r.host.input.tap("action");
  r.tk.bus.emit("zelda:message", { text: "One", durationMs: 1000, kind: "item" });
  r.tk.bus.emit("zelda:message", { text: "Two", durationMs: 1000, kind: "box" });
  r.step(1);
  assert.equal(r.host.hud.last!.box?.text, "One");
  r.step(1);
  assert.equal(r.host.hud.last!.box?.text, "One", "not closed by the press that opened it");
  r.host.input.tap("action");
  r.step(2);
  assert.equal(r.host.hud.last!.box?.text, "Two", "Show Message with In a dialogue box");
  assert.ok(r.session.isPaused("message"), "still paused between queued messages");

  const q = createRig({ ui: { messageMs: 500 } });
  q.tk.messageBox = settings({ waitForKey: false, pause: false });
  q.tk.bus.emit("zelda:message", { text: "Hi", durationMs: 500, kind: "sign" });
  q.step(1);
  assert.ok(q.host.hud.last!.box && !q.session.isPaused("message"), "no pause when switched off");
  q.run(1400);
  assert.equal(q.host.hud.last!.box, null, "closes by itself");
});

test("the box looks like a PS Maker dialogue layout (colour or 9-slice picture, font, size, typing speed)", () => {
  const story: any = {
    characters: [],
    spritesheetAnimations: [],
    gameConfig: { width: 1280, height: 720 },
    gameUI: {
      fonts: [{ id: "font-pixel-operator", name: "PixelOperator" }],
      defaultDialogLayoutId: "dl-1",
      dialogLayouts: [
        { id: "dl-1", name: "Plain", bottomGap: 14, typingSpeed: 42, textBox: { width: 896, height: 252, padding: { top: 27, right: 27, bottom: 27, left: 27 }, background: { type: "plain", backgroundOpacity: 100, backgroundColor: "#000000", borderColor: "#FFFFFF", borderWidth: 3, borderRadius: 18 }, textStyles: { fontFamily: "PixelOperator", fontAssetId: "font-pixel-operator", fontSize: 53, lineHeightPercent: 120, color: "#FFFFFF", strokeWidth: 0, strokeColor: "#000000", textAlign: "left" } }, caret: { appearance: { color: "#ffd23a" } } },
        { id: "dl-2", name: "Wood", bottomGap: 20, typingSpeed: 30, textBox: { width: 800, height: 200, padding: { top: 20, right: 30, bottom: 20, left: 30 }, background: { type: "image", imageId: "IMG_PANEL", backgroundOpacity: 90, scalingMode: "nine-slice", borderWidth: 24, slice: { top: 6, right: 6, bottom: 6, left: 6 } }, textStyles: { fontFamily: "serif", fontAssetId: null, fontSize: 40, color: "#3a2a1a", textAlign: "center" } } },
      ],
    },
  };
  const plain = styleFromLayout(story, "");
  assert.deepEqual([plain.width, plain.height, plain.gap, plain.typingSpeed, plain.caretColor], [896, 252, 14, 42, "#ffd23a"]);
  assert.deepEqual(plain.background, { type: "plain", color: "#000000", opacity: 100, borderColor: "#FFFFFF", borderWidth: 3, borderRadius: 18 });
  assert.equal(plain.text.fontFamily, '"ps-maker-font-font-pixel-operator", "PixelOperator", PixelOperator, sans-serif');
  assert.deepEqual([plain.text.size, plain.text.lineHeight], [53, 120]);
  const wood = styleFromLayout(story, "dl-2");
  assert.deepEqual(wood.background, { type: "image", imageId: "IMG_PANEL", opacity: 90, mode: "nine-slice", slice: { top: 6, right: 6, bottom: 6, left: 6 }, borderWidth: 24 });
  assert.deepEqual([wood.text.fontFamily, wood.text.align, wood.text.color], ["serif", "center", "#3a2a1a"]);
  assert.deepEqual(styleFromLayout(null, ""), CLASSIC_STYLE, "no project data: the classic toolkit box");
});

test("the press that closes a sign's box does not read the sign again (real sign, action key)", () => {
  const r = createRig();
  r.tk.messageBox = settings({ typing: false });
  r.step();
  r.host.walk(0, -1); // face up
  r.step();
  const p = r.host.player!;
  createObject(r.session, "sign", p.x, p.y - 16, { id: "s1", overrides: { message: "Welcome" } });
  r.host.input.tap("action");
  r.step(2);
  assert.equal(r.host.hud.last!.box?.text, "Welcome", "read");
  r.host.input.tap("action");
  r.step(3);
  assert.equal(r.host.hud.last!.box, null, "closed and not opened again by the same press");
  assert.equal(r.session.isPaused("message"), false);
});

test("a pause caught mid-blink (after a hit) shows the player", () => {
  const r = createRig();
  r.tk.messageBox = settings();
  r.host.blinkVisible = false; // as the invulnerability blink leaves it
  (r.session.player as any).blinkHidden = true;
  r.tk.bus.emit("zelda:message", { text: "Hi", durationMs: 1000, kind: "sign" });
  r.step(1);
  assert.equal(r.host.blinkVisible, true);
});

test("Show with PS Maker Dialogue: the message is played as a Dialogue action; the game waits until it closes", async () => {
  const r = createRig();
  const played: string[] = [];
  let close: () => void = () => {};
  (r.host as any).playDialogue = (source: string) => {
    played.push(source);
    return new Promise<void>((ok) => (close = ok));
  };
  r.tk.messageBox = settings({ display: "dialogue", layoutId: "zelda-dialogue-layout" });
  r.tk.bus.emit("zelda:message", { text: "Arrows: move", durationMs: 1000, kind: "sign" });
  r.step(2);
  assert.deepEqual(played, ["@dialogue_layout zelda-dialogue-layout\n\\Arrows: move"]);
  assert.equal(r.host.hud.last!.box, null, "the toolkit draws no box");
  assert.ok(r.session.isPaused("message"));
  r.host.input.tap("action");
  r.step(3);
  assert.ok(r.session.isPaused("message"), "keys belong to the dialogue");
  close();
  await new Promise((ok) => setTimeout(ok, 0));
  r.step(1);
  assert.ok(!r.session.isPaused("message"));
});

test("dialogue source: PS Maker syntax in the text is escaped", async () => {
  const { dialogueSourceOf } = await import("../../src/ui/messageBox.ts");
  assert.equal(dialogueSourceOf("Hello"), "Hello");
  assert.equal(dialogueSourceOf("Z: open"), "\\Z: open", "not a speaker name");
  assert.equal(dialogueSourceOf("@wait 100"), "\\@wait 100", "not a command");
  assert.equal(dialogueSourceOf("a *b* _c_ {d} \\e"), "a \\*b\\* \\_c\\_ \\{d\\} \\\\e", "no markup");
  assert.equal(dialogueSourceOf("one\n\ntwo", "L"), "@dialogue_layout L\none\n\ntwo", "a blank line is a new page");
});
