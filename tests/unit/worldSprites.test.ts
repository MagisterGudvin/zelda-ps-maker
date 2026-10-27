import { test } from "node:test";
import assert from "node:assert/strict";
import { WORLD_PALETTE, WORLD_SPRITES } from "../../src/host/worldSprites.ts";
import { builtinSpriteIds } from "../../src/host/textures.ts";

/** Sizes the game relies on (hitboxes and layout were made for them). */
const SIZES: Record<string, string> = { obj_chest: "16x14", obj_chest_open: "16x14", obj_torch: "12x16", obj_post: "12x16", pickup_rupee: "8x12", pickup_key: "8x14", pickup_bigkey: "12x16", sword: "16x6", arrow: "14x4", enemy_slime: "14x14", obj_bush: "16x16", obj_door: "16x16" };

test("world sprites: even rows, palette colors only, the sizes the game expects", () => {
  for (const [id, rows] of Object.entries(WORLD_SPRITES)) {
    assert.ok(rows.every((r) => r.length === rows[0].length), `${id}: rows of different length`);
    for (const ch of rows.join("")) assert.ok(ch === "." || ch in WORLD_PALETTE, `${id}: color "${ch}" not in the palette`);
    if (SIZES[id]) assert.equal(`${rows[0].length}x${rows.length}`, SIZES[id], id);
    assert.ok(builtinSpriteIds().includes(id), `${id} replaces a built-in sprite`);
  }
  for (const color of Object.values(WORLD_PALETTE)) assert.match(color, /^#[0-9a-f]{6}$/);
});

test("built-in sprites fill bigger objects only by whole multiples", async () => {
  const { wholeScale } = await import("../../src/host/phaserHost.ts");
  assert.deepEqual(wholeScale(16, 16, 16, 32), [1, 2], "two-tile gate");
  assert.deepEqual(wholeScale(16, 16, 32, 16), [2, 1]);
  assert.deepEqual(wholeScale(16, 14, 16, 16), [1, 1], "a 16x14 chest is not stretched to 16");
  assert.deepEqual(wholeScale(16, 16, 8, 8), [1, 1], "never shrunk");
});
