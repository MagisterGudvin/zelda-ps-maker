import { test } from "node:test";
import assert from "node:assert/strict";
import { isBuiltinSprite, resolveTexture, setSpriteImage, spriteImages } from "../../src/host/textures.ts";
import { ITEM_SPRITE_SLOTS } from "../../src/editor/fields.ts";

test("Set Item Sprites: a project image is drawn in place of a built-in item picture; not loaded or cleared = the built-in one", () => {
  const loaded = new Set(["my_arrow"]);
  const textures = { exists: (k: string) => loaded.has(k), createCanvas: () => null };
  for (const [id] of ITEM_SPRITE_SLOTS) assert.ok(isBuiltinSprite(id), `"${id}" is a built-in sprite`);
  setSpriteImage("arrow", "my_arrow");
  setSpriteImage("bomb", "not_loaded");
  assert.equal(resolveTexture(textures, "arrow"), "my_arrow");
  assert.equal(resolveTexture(textures, "bomb"), null, "not loaded: the built-in picture (no canvas in this test)");
  setSpriteImage("arrow", "");
  setSpriteImage("bomb", "");
  assert.equal(spriteImages().size, 0);
  assert.equal(resolveTexture(textures, "arrow"), null);
});
