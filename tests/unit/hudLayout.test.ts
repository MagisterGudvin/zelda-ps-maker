import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHudLayout, intersects, type Rect } from "../../src/ui/hudLayout.ts";

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
