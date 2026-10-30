import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorPoint, classicLayout, isShown, layoutBindings, layoutBoxes, offsetFrom, parseLayout, pictureKeys, readElement, textWithValues, type Box } from "../../src/ui/uiLayout.ts";
import { layoutScale } from "../../src/host/layoutPainter.ts";
import { History, boardScale, designerSetup, freeId, newElement, sampleValues, savedText, withField, writeFormText } from "../../src/editor/layoutEdit.ts";

const intersects = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("layout text: every field checked and defaulted; unknown types dropped; ids made unique", () => {
  const { layout, error } = parseLayout(JSON.stringify({ v: 1, scale: 2.4, elements: [{ type: "text", id: "a", size: "big", align: "middle" }, { type: "laser" }, { type: "bar", id: "a", w: -5, dir: "up" }, 7] }));
  assert.equal(error, null);
  assert.equal(layout!.scale, 2);
  assert.deepEqual(layout!.elements.map((e) => [e.id, e.type]), [["a", "text"], ["a_2", "bar"]]);
  const text = layout!.elements[0] as any;
  assert.deepEqual([text.size, text.align, text.anchor, text.show], [8, "left", "tl", { when: "always" }]);
  const bar = layout!.elements[1] as any;
  assert.deepEqual([bar.w, bar.dir, bar.value, bar.max], [1, "up", "magic", "maxMagic"]);
  assert.equal(layout!.theme.textColor, "#f8e0a0", "theme defaults");
});

test("layout text: empty = none, broken or newer = a reason", () => {
  assert.deepEqual(parseLayout("  "), { layout: null, error: null });
  assert.match(parseLayout("{oops").error!, /not valid layout data/);
  assert.match(parseLayout("[1]").error!, /must be an object/);
  assert.match(parseLayout('{"v": 99}').error!, /newer than this toolkit/);
});

test("values: bindings of a layout, texts with values, visibility by variable, item and dialogue", () => {
  const layout = parseLayout(
    JSON.stringify({
      elements: [
        { type: "text", text: "{rupees} / {var:gold} {t:hud.life}" },
        { type: "counter", value: "bombs", show: { when: "variable", id: "showBombs" } },
        { type: "item", show: { when: "item", id: "bow", hideInDialogue: true } },
      ],
    }),
  ).layout!;
  const keys = layoutBindings(layout);
  for (const k of ["rupees", "var:gold", "t:hud.life", "bombs", "var:showBombs", "item.icon", "owned:bow", "health"]) assert.ok(keys.has(k), k);
  assert.equal(textWithValues("{rupees} / {var:gold}{nope}", { rupees: 12, "var:gold": "x" }), "12 / x");
  const [, counter, item] = layout.elements;
  assert.equal(isShown(counter, { "var:showBombs": 0 }), false);
  assert.equal(isShown(counter, { "var:showBombs": 1 }), true);
  assert.equal(isShown(item, { "owned:bow": 1 }), true);
  assert.equal(isShown(item, { "owned:bow": 1, dialogue: 1 }), false);
  assert.equal(isShown(item, { "owned:bow": 0 }), false);
});

test("anchors: an element keeps its place from its corner of the game window", () => {
  assert.deepEqual(anchorPoint("tl", 320, 180), { x: 0, y: 0 });
  assert.deepEqual(anchorPoint("br", 320, 180), { x: 320, y: 180 });
  assert.deepEqual(anchorPoint("c", 321, 181), { x: 161, y: 91 });
  assert.deepEqual(anchorPoint("r", 320, 180), { x: 320, y: 90 });
  assert.deepEqual(offsetFrom("br", 300, 170, 320, 180), { x: -20, y: -10 });
});

test("pictures of an element: project images only (built-in sprites are not checked)", () => {
  const e = readElement({ type: "counter", icon: "hud_rupee", digits: "IMG_DIGITS" })!;
  assert.deepEqual(pictureKeys(e), ["IMG_DIGITS"]);
  assert.deepEqual(pictureKeys(readElement({ type: "hearts", full: "H", empty: "icon_x" })!), ["H"]);
});

for (const [W, H] of [[256, 224], [320, 180], [400, 240], [640, 360], [1280, 720], [1920, 1080]]) {
  for (const bottom of [false, true]) {
    test(`classic HUD: elements on screen and apart, ${W}x${H}, ${bottom ? "bottom" : "top"}`, () => {
      const L = classicLayout({ bottom });
      const k = layoutScale(0, 0, W, H);
      const viewW = Math.floor(W / k);
      const viewH = Math.floor(H / k);
      const b = layoutBoxes(L, viewW, viewH);
      const list = Object.entries(b);
      for (const [id, r] of list) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= viewW && r.y + r.h <= viewH, `${id} on screen`);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!intersects(list[i][1], list[j][1]), `${list[i][0]} / ${list[j][0]}`);
      assert.ok(b.hearts.x + b.hearts.w <= viewW - 24, "clear of PS Maker's settings gear");
    });
  }
}

test("classic HUD without magic: no meter, the item box moves left", () => {
  const L = classicLayout({ magic: false });
  assert.ok(!L.elements.some((e) => e.id === "magic"));
  assert.equal(L.elements[0].id, "item");
  assert.equal(L.elements[0].x, 6);
});

// ---- the designer's model ----------------------------------------------------------------------

const story = { characters: [], spritesheetAnimations: [], gameConfig: { width: 1280, height: 720, zoom: 4 } };
const start = { id: "s", actionName: "Zelda: Start Toolkit", pluginParams: { hearts: 5, language: "en" } };
const spawn = { type: "movePlayerAction", moveType: "absolute-position", position: { x: 200, y: 100 } };

test("designer setup: the game window around the player's start; no UI Layout = the classic HUD to look at", () => {
  assert.equal(designerSetup({ initialActions: [] }, story as any, 0), null, "no Start Toolkit, no HUD");
  assert.equal(designerSetup({ initialActions: [{ ...start, pluginParams: { hud: false } }] }, story as any, 0), null);
  const st = designerSetup({ initialActions: [start, spawn] }, story as any, 0)!;
  assert.deepEqual(st.frame, { x: 40, y: 10, w: 320, h: 180 });
  assert.equal(st.action, null);
  assert.equal(st.layout.elements.length, 8);
  assert.equal(boardScale(st, st.layout), 1, "one layout pixel per map pixel");
  assert.equal(st.values.maxHealth, 10);
  assert.equal(st.values["t:hud.life"], "- LIFE -");
});

test("designer setup: the map's UI Layout action and its scale; a broken one is shown as classic with the reason", () => {
  const own = { id: "u1", actionName: "Zelda: UI Layout", pluginParams: { layout: JSON.stringify({ v: 1, scale: 2, elements: [{ type: "text", id: "t" }] }) } };
  const st = designerSetup({ setupActions: [start], initialActions: [own] }, story as any, 0)!;
  assert.deepEqual(st.action, { id: "u1", root: "__map_start__" });
  assert.deepEqual(st.layout.elements.map((e) => e.id), ["t"]);
  assert.equal(boardScale(st, st.layout), 0.5, "2 screen pixels per layout pixel at map zoom 4");
  const broken = designerSetup({ initialActions: [start, { ...own, pluginParams: { layout: "{" } }] }, story as any, 0)!;
  assert.equal(broken.layout.elements.length, 8);
  assert.match(broken.error!, /not valid/);
});

test("designer setup: the open UI Layout action is edited (a screen, even on a map without the HUD); screens and events for buttons", () => {
  const hud = { id: "h", actionName: "Zelda: UI Layout", pluginParams: { name: "", layout: "" } };
  const pause = { id: "p", actionName: "Zelda: UI Layout", pluginParams: { name: " pause ", layout: "" } };
  const map = { initialActions: [start, hud, pause], storyEvents: [{ id: "e1", name: "Open chest" }, { id: "e2", name: "secret", hidden: true }] };
  const shown = designerSetup(map, story as any, 0)!;
  assert.deepEqual([shown.action?.id, shown.screen], ["h", ""], "not editing: the HUD");
  const edited = designerSetup(map, story as any, 0, "p")!;
  assert.deepEqual([edited.action?.id, edited.screen, edited.layout.elements.length], ["p", "pause", 0], "an empty screen, not the classic HUD");
  assert.deepEqual(edited.screens, ["pause"]);
  assert.deepEqual(edited.mapEvents, [{ id: "e1", name: "Open chest" }]);
  assert.equal(designerSetup({ initialActions: [pause] }, story as any, 0, "p")!.screen, "pause", "no Start Toolkit here: the screen still opens");
  assert.equal(designerSetup({ initialActions: [pause] }, story as any, 0), null);
});

test("designer values: every element shown (variables and items count as on), the start of the game", () => {
  const L = parseLayout(JSON.stringify({ elements: [{ type: "counter", value: "rupees", show: { when: "variable", id: "v" } }, { type: "item", show: { when: "item", id: "bow" } }] })).layout!;
  const v = sampleValues(L, { hearts: 3 });
  assert.ok(L.elements.every((e) => isShown(e, v)));
  assert.deepEqual([v.rupees, v.health, v["item.icon"]], [0, 6, ""]);
});

test("designer edits: new elements get free names; fields are checked like saved ones", () => {
  const L = classicLayout();
  assert.equal(freeId(L, "item"), "item2");
  assert.equal(freeId(L, "picture"), "picture");
  const e = newElement(L, "counter", 10.6, 20.2);
  assert.deepEqual([e.id, e.x, e.y, (e as any).icon], ["counter", 11, 20, "hud_rupee"]);
  const moved = withField(e, "x", 12.7);
  assert.equal(moved.x, 13);
  assert.equal(withField(e, "anchor", "nowhere").anchor, "tl", "not a choice: default");
  assert.deepEqual(withField(e, "show.when", "variable").show, { when: "variable", id: "" });
  assert.equal(e.x, 11, "the original is not changed");
});

test("designer history: undo and redo whole layouts", () => {
  const h = new History();
  const a = classicLayout();
  const b = { ...a, scale: 2 };
  const c = { ...a, scale: 3 };
  h.push(a);
  h.push(b);
  assert.equal(h.undo(c)!.scale, 2);
  assert.equal(h.undo(b)!.scale, 0);
  assert.equal(h.undo(a), null);
  assert.equal(h.redo(a)!.scale, 2);
  assert.ok(h.canRedo);
  h.push(a);
  assert.ok(!h.canRedo, "a new change drops the redo steps");
});

test("designer saving: the layout as text, refused over the field's 50000 characters", () => {
  assert.equal(savedText(classicLayout()).error, null);
  const big = classicLayout();
  big.elements = Array.from({ length: 400 }, (_, i) => newElement(big, "text", i, i)).map((e, i) => ({ ...e, id: `t${i}` }));
  assert.match(savedText(big).error!, /50000/);
});

test("designer saving: the text goes into the open action's field like typing (native setter, input, change, blur)", () => {
  const events: string[] = [];
  let value = "";
  class FakeInput {
    tagName = "INPUT";
    get value() {
      return value;
    }
    set value(_v: string) {
      throw new Error("must use the native setter");
    }
    dispatchEvent(e: { type: string }) {
      events.push(e.type);
    }
  }
  Object.defineProperty(FakeInput.prototype, "value", { set: (v: string) => (value = v), get: () => value, configurable: true });
  const input = new FakeInput();
  const label = { firstChild: { textContent: "Layout data" }, parentElement: { querySelector: () => input } };
  const details = { open: false };
  const panel = {
    querySelectorAll: (q: string) => (q.includes("Breadcrumb") ? [{ textContent: "Map" }, { textContent: " Zelda: UI Layout " }] : q === "details" ? [details] : q === ".label" ? [label] : []),
  };
  const doc = {
    querySelector: () => panel,
    defaultView: { HTMLInputElement: FakeInput, Event: class { type: string; constructor(t: string) { this.type = t; } } },
  };
  assert.equal(writeFormText(doc, "Zelda: UI Layout", "Layout data", '{"v":1}'), true);
  assert.equal(value, '{"v":1}');
  assert.deepEqual(events, ["input", "change", "blur"]);
  assert.equal(details.open, true, "a folded group is opened");
  assert.equal(writeFormText(doc, "Zelda: Show Message", "Layout data", "x"), false, "another action's form");
});

test("notifications stack one height (and a gap) apart, away from the screen edge they are near; a {portrait} picture is a value, not a project picture", async () => {
  const { stackOffset } = await import("../../src/host/phaserHud.ts");
  const top = parseLayout(JSON.stringify({ elements: [{ id: "a", type: "text", y: 10, h: 12 }] })).layout!;
  const bottom = parseLayout(JSON.stringify({ elements: [{ id: "a", type: "text", anchor: "bl", y: -20, h: 12 }] })).layout!;
  assert.equal(stackOffset(top, 2, 320, 180), 28);
  assert.equal(stackOffset(bottom, 1, 320, 180), -14);
  const face = parseLayout(JSON.stringify({ elements: [{ id: "f", type: "image", image: "{portrait}" }] })).layout!;
  assert.deepEqual(pictureKeys(face.elements[0]), []);
  assert.ok(layoutBindings(face).has("portrait"));
});
