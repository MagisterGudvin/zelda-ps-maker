import { test } from "node:test";
import assert from "node:assert/strict";
import { barFillPolygon, clipPolygon, effectAt, isShown, layoutBindings, parseLayout, readElement, shapePolygon, type Box, type Point, type UiLayout } from "../../src/ui/uiLayout.ts";
import { alignElements, groupElements, pasteElements, reorderElements, resizeBox, snapMove, withGroup } from "../../src/editor/layoutEdit.ts";
import { createRig } from "../helpers/fakeHost.ts";

const area = (pts: readonly Point[]) => Math.abs(pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0)) / 2;
const inside = (pts: readonly Point[], b: Box) => pts.every((p) => p.x >= b.x - 1e-6 && p.x <= b.x + b.w + 1e-6 && p.y >= b.y - 1e-6 && p.y <= b.y + b.h + 1e-6);
const layout = (elements: unknown[]): UiLayout => parseLayout(JSON.stringify({ v: 1, elements })).layout!;

test("bar shapes stay in their box; the level cuts them by area", () => {
  const b = { x: 10, y: 20, w: 40, h: 30 };
  for (const shape of ["rect", "round", "circle", "diamond", "triangle", "star", "heart"] as const) {
    const poly = shapePolygon(shape, b);
    assert.ok(poly.length >= 3 && inside(poly, b), shape);
    const full = area(poly);
    const half = area(barFillPolygon(shape, b, "right", 0.5));
    assert.ok(half > 0 && half < full, `${shape}: half filled is part of it`);
    assert.equal(barFillPolygon(shape, b, "up", 0).length, 0, `${shape}: empty`);
    assert.ok(Math.abs(area(barFillPolygon(shape, b, "up", 1)) - full) < 1e-6, `${shape}: full`);
  }
  // A rectangle filled to 25 % upwards is its bottom quarter.
  const q = barFillPolygon("rect", { x: 0, y: 0, w: 10, h: 20 }, "up", 0.25);
  assert.ok(Math.abs(area(q) - 50) < 1e-6);
  assert.ok(q.every((p) => p.y >= 15 - 1e-6));
});

test("clipping a polygon by a convex one (the minimap's circle)", () => {
  const square = shapePolygon("rect", { x: 0, y: 0, w: 10, h: 10 });
  assert.ok(Math.abs(area(clipPolygon(square, shapePolygon("rect", { x: 5, y: 5, w: 10, h: 10 }))) - 25) < 1e-6);
  assert.equal(clipPolygon(square, shapePolygon("rect", { x: 20, y: 20, w: 5, h: 5 })).length, 0, "apart");
  const ring = shapePolygon("circle", { x: 0, y: 0, w: 10, h: 10 });
  assert.ok(area(clipPolygon(square, ring)) < 100 && area(clipPolygon(square, ring)) > 70, "the square's corners are cut off");
});

test("element fields: rotation, opacity, effect, group, lock are read and checked; new element types", () => {
  const e = readElement({ type: "image", rotation: -90, alpha: 3, effect: "wiggle", group: "g1", locked: true })!;
  assert.deepEqual([e.rotation, e.alpha, e.effect, e.group, e.locked], [270, 1, "none", "g1", true]);
  const plain = readElement({ type: "text" })!;
  assert.ok(!("group" in plain) && !("locked" in plain), "only when set");
  assert.deepEqual([(plain as any).stroke, (plain as any).strokeWidth], ["", 1]);
  const bar = readElement({ type: "bar", shape: "hexagon" }) as any;
  assert.deepEqual([bar.shape, bar.border, bar.size], ["rect", "#f0f0e0", 6]);
  const slot = readElement({ type: "slot", index: 12 }) as any;
  assert.deepEqual([slot.index, slot.keyLabel], [9, true]);
  const mm = readElement({ type: "minimap", range: 2 }) as any;
  assert.deepEqual([mm.shape, mm.range], ["circle", 16]);
  const icon = readElement({ type: "icon", image: "SHEET", index: 5 }) as any;
  assert.deepEqual([icon.cellW, icon.cellH, icon.index], [16, 16, 5]);
});

test("effects move or fade the drawing over time; compare visibility", () => {
  assert.deepEqual(effectAt("none", 1234), { dx: 0, dy: 0, alpha: 1 });
  assert.deepEqual([effectAt("blink", 0).alpha, effectAt("blink", 250).alpha], [1, 0]);
  assert.ok(effectAt("pulse", 500).alpha < effectAt("pulse", 0).alpha);
  assert.notEqual(effectAt("bob", 250).dy, 0);
  const low = readElement({ type: "text", show: { when: "compare", id: "health", op: "<=", value: 2 } })!;
  assert.deepEqual(low.show, { when: "compare", id: "health", op: "<=", value: 2 });
  assert.equal(isShown(low, { health: 2 }), true);
  assert.equal(isShown(low, { health: 3 }), false);
  assert.ok(layoutBindings(layout([low])).has("health"));
  assert.equal((readElement({ type: "text", show: { when: "compare", op: "~" } })!.show as any).op, "<", "unknown operator");
});

test("snapping: to the game window's centre, to another element's edge, else to the grid; guides tell which", () => {
  const box = { x: 147, y: 50, w: 20, h: 10 };
  const centre = snapMove(box, [], 320, 180, 6);
  assert.deepEqual([centre.dx, centre.guides], [3, [{ axis: "x", at: 160 }]], "its centre on the window's centre (160)");
  const edge = snapMove({ x: 72, y: 100, w: 10, h: 10 }, [{ x: 20, y: 0, w: 50, h: 10 }], 320, 180, 3);
  assert.equal(edge.dx, -2, "its left edge on the other's right edge (70)");
  const grid = snapMove({ x: 33, y: 41, w: 10, h: 10 }, [], 1000, 1000, 0, 8);
  assert.deepEqual([grid.dx, grid.dy, grid.guides.length], [-1, -1, 0]);
});

test("resizing by a handle: the opposite edge stays; Shift keeps proportions; never under a pixel", () => {
  const b = { x: 10, y: 10, w: 40, h: 20 };
  assert.deepEqual(resizeBox(b, "e", 10, 99), { x: 10, y: 10, w: 50, h: 20 });
  assert.deepEqual(resizeBox(b, "nw", 5, 5), { x: 15, y: 15, w: 35, h: 15 });
  assert.deepEqual(resizeBox(b, "se", 40, 0, true), { x: 10, y: 10, w: 80, h: 40 });
  assert.deepEqual(resizeBox(b, "w", 100, 0), { x: 49, y: 10, w: 1, h: 20 });
});

test("align, space evenly, order, group and paste work on the selection", () => {
  const L = layout([
    { id: "a", type: "image", x: 10, y: 5, w: 10, h: 10 },
    { id: "b", type: "image", x: 40, y: 30, w: 20, h: 10 },
    { id: "c", type: "image", x: 100, y: 60, w: 10, h: 10 },
  ]);
  const boxes = { a: { x: 10, y: 5, w: 10, h: 10 }, b: { x: 40, y: 30, w: 20, h: 10 }, c: { x: 100, y: 60, w: 10, h: 10 } };
  const left = alignElements(L, ["a", "b", "c"], boxes, "left");
  assert.deepEqual(left.elements.map((e) => e.x), [10, 10, 10]);
  const spread = alignElements(L, ["a", "b", "c"], boxes, "spreadX");
  assert.deepEqual(spread.elements.map((e) => e.x), [10, 50, 100], "equal gaps (20) between them");
  assert.deepEqual(reorderElements(L, ["a"], "front").elements.map((e) => e.id), ["b", "c", "a"]);
  assert.deepEqual(reorderElements(L, ["c"], "backward").elements.map((e) => e.id), ["a", "c", "b"]);
  const grouped = groupElements(L, ["a", "b"], true);
  assert.deepEqual(withGroup(grouped, "a").sort(), ["a", "b"]);
  assert.deepEqual(withGroup(grouped, "c"), ["c"]);
  const { layout: pasted, ids } = pasteElements(grouped, grouped.elements.slice(0, 2), 8, 8);
  assert.deepEqual(ids, ["a2", "b2"]);
  const copies = pasted.elements.filter((e) => ids.includes(e.id));
  assert.ok(copies.every((e) => e.group === copies[0].group && e.group !== "g1"), "the copies form a group of their own");
  assert.deepEqual([copies[0].x, copies[0].y], [18, 13]);
});

test("quick slots: the n-th quick-use item, its key selects it, the selected slot is marked", () => {
  const r = createRig();
  r.tk.hudLayout = layout([{ id: "s1", type: "slot", index: 1 }, { id: "s2", type: "slot", index: 2 }]);
  r.tk.inventory.give("boomerang", 1, { silent: true });
  r.tk.inventory.give("bow", 1, { silent: true });
  const [first, second] = r.tk.inventory.quickItems();
  r.host.input.tap("slot2");
  r.step();
  assert.equal(r.tk.state.inventory.activeItem, second);
  const v = r.host.hud.last!.values;
  assert.equal(v["slot.2.sel"], 1);
  assert.equal(v["slot.1.sel"], 0);
  assert.equal(v["slot.1.icon"], `icon_${first}`);
  r.host.input.tap("slot9");
  r.step();
  assert.equal(r.tk.state.inventory.activeItem, second, "a slot the HUD does not show does nothing");
});

test("a minimap in the HUD gets the player, the walls and the enemies", () => {
  const r = createRig();
  r.tk.hudLayout = layout([{ id: "m", type: "minimap" }]);
  (r.host as any).mapWalls = () => [{ x: 50, y: 60, hw: 8, hh: 8 }];
  r.step();
  const m = r.host.hud.last!.minimap!;
  assert.deepEqual([m.x, m.y], [r.session.player.box.x, r.session.player.box.y]);
  assert.deepEqual(m.walls, [{ x: 50, y: 60, hw: 8, hh: 8 }]);
  assert.ok(Array.isArray(m.dots));
  r.tk.hudLayout = layout([{ id: "t", type: "text" }]);
  r.tk.bus.emit("zelda:custom:refresh", {});
  r.step();
  assert.equal(r.host.hud.last!.minimap, null, "no minimap: no world data");
});
