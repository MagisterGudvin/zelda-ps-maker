import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureProjectFont, fontFaceFamily, forgetRequestedFonts, projectAssetUrl, projectFontUrl } from "../../src/host/projectFonts.ts";

const story: any = {
  characters: [],
  spritesheetAnimations: [],
  mapObjects: [{ id: "OBJ", type: "static", src: "map-object-0.png" }],
  gameUI: { fonts: [{ id: "font-pixel-operator", name: "PixelOperator", key: "PixelOperator.ttf" }] },
};
const textures = (src: string) => ({ exists: (k: string) => k === "OBJ", get: () => ({ getSourceImage: () => ({ src }) }) });
const blobs = textures("blob:http://h/1234");

test("font file URL as PS Maker resolves it: export path, desktop editor bridge, else a picture's URL", async () => {
  // Export: the key already is the packaged path (packagedAssetUrl encodes each segment).
  assert.equal(await projectFontUrl(story, blobs, "game-assets/Pixel Operator.ttf", {}), "game-assets/Pixel%20Operator.ttf");
  // Desktop editor: window.psMakerDesktop.storage.getAssetUrl(folder of /editor/<folder>/..., key).
  const asked: string[] = [];
  const win = {
    location: { pathname: "/editor/My%20Game/maps/field" },
    psMakerDesktop: { storage: { getAssetUrl: async (folder: string, key: string) => (asked.push(`${folder}|${key}`), `ps-maker-asset://file/${encodeURIComponent(`/p/${folder}/assets/${key}`)}`) } },
  };
  assert.equal(await projectFontUrl(story, blobs, "PixelOperator.ttf", win), "ps-maker-asset://file/" + encodeURIComponent("/p/My Game/assets/PixelOperator.ttf"));
  assert.deepEqual(asked, ["My Game|PixelOperator.ttf"]);
  // Neither: a picture loaded from a plain URL (blob: URLs give nothing).
  assert.equal(await projectFontUrl(story, textures("http://h/assets/map-object-0.png"), "PixelOperator.ttf", {}), "http://h/assets/PixelOperator.ttf");
  assert.equal(await projectFontUrl(story, blobs, "PixelOperator.ttf", {}), null);
  assert.equal(projectAssetUrl(story, textures("x://file/" + encodeURIComponent("/a b/assets/map-object-0.png")), "F.ttf"), "x://file/" + encodeURIComponent("/a b/assets/F.ttf"));
});

test("the font is registered under PS Maker's family name once, unless PS Maker already did", async () => {
  forgetRequestedFonts();
  const added: unknown[] = [];
  const made: string[] = [];
  const fonts: any = Object.assign([] as { family: string }[], { add: (f: unknown) => added.push(f) });
  class Face {
    constructor(family: string, source: string) {
      made.push(`${family} ${source}`);
    }
    load() {
      return Promise.resolve(this);
    }
  }
  const exported = { ...story, gameUI: { fonts: [{ id: "font-pixel-operator", name: "PixelOperator", key: "game-assets/PixelOperator.ttf" }] } };
  const [a, b] = await Promise.all([ensureProjectFont(exported, blobs, "font-pixel-operator", { fonts }, Face as any, {}), ensureProjectFont(exported, blobs, "font-pixel-operator", { fonts }, Face as any, {})]);
  assert.deepEqual([a, b], ["ps-maker-font-font-pixel-operator", "ps-maker-font-font-pixel-operator"]);
  assert.deepEqual(made, ['ps-maker-font-font-pixel-operator url("game-assets/PixelOperator.ttf")'], "once");
  assert.equal(added.length, 1);
  forgetRequestedFonts();
  fonts.push({ family: fontFaceFamily("font-pixel-operator") });
  await ensureProjectFont(exported, blobs, "font-pixel-operator", { fonts }, Face as any, {});
  assert.equal(made.length, 1, "PS Maker already registered it");
  assert.equal(await ensureProjectFont(exported, blobs, "no-such-font", { fonts }, Face as any, {}), null);
});
