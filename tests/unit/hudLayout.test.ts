import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHudLayout, type Rect } from "../../src/ui/hudLayout.ts";

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const SCREENS = [
  [256, 224],
  [320, 180],
  [320, 240],
  [400, 240],
  [480, 270],
  [640, 360],
  [800, 600],
  [1280, 720],
  [1920, 1080],
  [1980, 1475],
];

for (const [W, H] of SCREENS) {
  for (const hearts of [3, 10, 14, 20]) {
    for (const position of ["top", "bottom"] as const) {
      test(`HUD elements never overlap and stay on screen: ${W}x${H}, ${hearts} hearts, ${position}`, () => {
        const L = computeHudLayout({
          screenW: W,
          screenH: H,
          scale: 0,
          position,
          safeArea: { top: 0, right: 24, bottom: 0, left: 0 },
          showMagic: true,
          showItem: true,
          showHearts: true,
          counters: [3, 2, 2, 1],
          hearts,
        });
        const named: [string, Rect][] = [];
        if (L.magic) named.push(["magic", L.magic]);
        if (L.item) named.push(["item", L.item]);
        L.counters.forEach((c, i) => named.push([`icon${i}`, c.icon], [`digits${i}`, c.digits]));
        if (L.lifeLabel) named.push(["life", L.lifeLabel]);
        L.hearts.forEach((h, i) => named.push([`heart${i}`, h]));
        for (let a = 0; a < named.length; a++) {
          const [na, ra] = named[a];
          assert.ok(ra.x >= 0 && ra.y >= 0 && ra.x + ra.w <= L.viewW - 24 && ra.y + ra.h <= L.viewH, `${na} off screen or in the safe area: ${JSON.stringify(ra)} view ${L.viewW}x${L.viewH}`);
          for (let b = a + 1; b < named.length; b++) {
            const [nb, rb] = named[b];
            assert.ok(!intersects(ra, rb), `${na} overlaps ${nb}`);
          }
          assert.ok(ra.y >= L.bar.y && ra.y + ra.h <= L.bar.y + L.bar.h, `${na} outside the bar`);
        }
        assert.ok(!intersects(L.bar, L.free), "free area must not cover the bar");
        assert.ok(L.free.h > L.viewH / 3, "most of the screen stays free for the game and messages");
      });
    }
  }
}

test("HUD scale is a whole number and grows with the screen", () => {
  const small = computeHudLayout({ screenW: 320, screenH: 240, scale: 0, position: "top", safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, showMagic: true, showItem: true, showHearts: true, counters: [3], hearts: 3 });
  const big = computeHudLayout({ screenW: 1980, screenH: 1475, scale: 0, position: "top", safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, showMagic: true, showItem: true, showHearts: true, counters: [3], hearts: 3 });
  assert.equal(small.k, 1);
  assert.equal(big.k, 6);
});

// Own pictures (Zelda: HUD Style) are bigger than the built-in ones: 16 px hearts, 12 px icons,
// 8x12 digits, a 32 px item box, a 12x40 magic meter.
const BIG = { heart: { w: 16, h: 14 }, icon: { w: 12, h: 12 }, digit: { w: 9, h: 12 }, item: { w: 32, h: 32 }, magic: { w: 12, h: 40 } };
for (const [W, H] of SCREENS.filter(([w]) => w >= 400)) {
  for (const showLifeLabel of [true, false]) {
    test(`HUD with own picture sizes never overlaps: ${W}x${H}, LIFE label ${showLifeLabel ? "on" : "off"}`, () => {
      const L = computeHudLayout({ screenW: W, screenH: H, scale: 0, position: "top", safeArea: { top: 0, right: 24, bottom: 0, left: 0 }, showMagic: true, showItem: true, showHearts: true, counters: [3, 2, 2, 1], hearts: 12, metrics: BIG, showLifeLabel });
      const named: [string, Rect][] = [["magic", L.magic!], ["item", L.item!]];
      L.counters.forEach((c, i) => named.push([`icon${i}`, c.icon], [`digits${i}`, c.digits]));
      if (L.lifeLabel) named.push(["life", L.lifeLabel]);
      L.hearts.forEach((h, i) => named.push([`heart${i}`, h]));
      assert.equal(!!L.lifeLabel, showLifeLabel);
      assert.deepEqual([L.hearts[0].w, L.hearts[0].h, L.item!.w, L.magic!.h, L.counters[0].icon.w, L.counters[0].digits.h], [16, 14, 32, 40, 12, 12]);
      assert.equal(L.counters[0].digits.w, 27, "three 9 px digits");
      for (let a = 0; a < named.length; a++) {
        const [na, ra] = named[a];
        assert.ok(ra.x >= 0 && ra.x + ra.w <= L.viewW - 24 && ra.y + ra.h <= L.bar.y + L.bar.h, `${na} outside: ${JSON.stringify(ra)}`);
        for (let b = a + 1; b < named.length; b++) assert.ok(!intersects(ra, named[b][1]), `${na} overlaps ${named[b][0]}`);
      }
    });
  }
}

test("HUD layout without own pictures is unchanged (built-in sizes)", () => {
  const L = computeHudLayout({ screenW: 1280, screenH: 720, scale: 0, position: "top", safeArea: { top: 0, right: 24, bottom: 0, left: 0 }, showMagic: true, showItem: true, showHearts: true, counters: [3], hearts: 3 });
  assert.deepEqual([L.magic, L.item, L.counters[0], L.lifeLabel, L.hearts[1]], [
    { x: 6, y: 4, w: 8, h: 30 },
    { x: 18, y: 6, w: 22, h: 22 },
    { icon: { x: 53, y: 6, w: 8, h: 8 }, digits: { x: 48, y: 16, w: 18, h: 8 } },
    { x: L.viewW - 24 - 6 - 80, y: 4, w: 80, h: 7 },
    { x: L.viewW - 24 - 6 - 80 + 8, y: 13, w: 7, h: 7 },
  ]);
});

test("parts placed by the author move as a whole, stay on screen, each on its own background panel", () => {
  const base = { screenW: 1280, screenH: 720, scale: 4, position: "top" as const, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, showMagic: true, showItem: true, showHearts: true, counters: [3, 2], hearts: 3 };
  const classic = computeHudLayout(base);
  const L = computeHudLayout({ ...base, places: { hearts: { x: 10, y: 150 }, item: { x: 300, y: 2 }, magic: { x: -1, y: -1 } } });
  assert.equal(L.k, 4, "HUD pixel = map pixel at zoom 4");
  assert.deepEqual([L.parts.hearts!.x, L.parts.hearts!.y], [10, 150]);
  assert.equal(L.hearts[1].x - L.hearts[0].x, classic.hearts[1].x - classic.hearts[0].x, "hearts keep their spacing");
  assert.equal(L.lifeLabel!.y, 150, "the LIFE label moves with the hearts");
  // 300 is beyond the 320-pixel-wide view minus the box: kept on screen.
  assert.ok(L.item!.x + L.item!.w <= L.viewW && L.item!.y === 2);
  assert.deepEqual(L.magic, classic.magic, "-1 = the classic place");
  const inside = (r: { x: number; y: number; w: number; h: number }, o: { x: number; y: number; w: number; h: number }) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;
  const parts = [L.parts.hearts!, L.parts.item!, L.parts.counters!, L.parts.magic!];
  assert.equal(L.panels.length, 4, "one panel per part");
  for (const r of parts) assert.ok(L.panels.some((p) => inside(r, p) && p.w <= r.w + 6 && p.h <= r.h + 6), `a snug panel around ${JSON.stringify(r)}`);
  for (const r of parts) assert.ok(inside(r, L.bar), "the bar (where the HUD is) holds every part");
  const none = computeHudLayout({ ...base, places: {} });
  assert.deepEqual([none.bar, none.panels], [classic.bar, [classic.bar]], "nothing placed: the classic band");
});
