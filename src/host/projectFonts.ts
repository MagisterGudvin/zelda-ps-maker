import type { PsStory } from "./psmakerAssets.ts";

/**
 * Project fonts (Game UI → Fonts). PS Maker registers a font as FontFace "ps-maker-font-<id>" only
 * the first time it shows one of its own texts with it (a dialogue, a menu, Add UI text;
 * fontAssets.ts). A playtest started on a game map may never do that before the toolkit draws a
 * message, and the text would fall back to a browser font. So the toolkit registers the same
 * FontFace itself, from the font file next to the project's other assets.
 *
 * The file's URL, as PS Maker resolves it (fontAssets.ts resolveFontUrl): in an export the key is
 * already the packaged path "game-assets/<file>" (packagedAssetUrl); in the desktop editor the
 * desktop bridge gives it (window.psMakerDesktop.storage.getAssetUrl(project folder, key), the
 * folder being the editor route's /editor/<folder>/). Failing both, it is read off a picture PS
 * Maker loaded from a plain URL (Phaser usually loads them as blob: URLs, which give nothing).
 */

export interface FontDoc {
  fonts: Iterable<{ family: string; status?: string }> & { add(face: unknown): void };
}
type FaceCtor = new (family: string, source: string, descriptors?: Record<string, string>) => { load(): Promise<unknown> };

interface TextureSource {
  exists(key: string): boolean;
  get(key: string): { getSourceImage?(): { src?: string } | null } | null;
}

type Raw = Record<string, any>;

export function fontFaceFamily(fontId: string): string {
  return `ps-maker-font-${fontId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

const SEGMENTS = (key: string) => key.split("/").map(encodeURIComponent).join("/");
const WHOLE = (key: string) => encodeURIComponent(key);

/** URL of a project asset file, from the URL of a loaded picture; null when none matches. */
export function projectAssetUrl(story: (PsStory & Raw) | null, textures: TextureSource, key: string): string | null {
  if (!key) return null;
  if (/^(https?:|data:|blob:|\/)/.test(key)) return key;
  const known: [string, string][] = [];
  for (const o of (story?.mapObjects ?? []) as Raw[]) if (o?.type !== "animated" && typeof o?.src === "string") known.push([o.id, o.src]);
  for (const i of (story?.images ?? []) as Raw[]) if (typeof i?.url === "string") known.push([i.id, i.url]);
  for (const t of (story?.terrains ?? []) as Raw[]) if (typeof t?.autoTilesetSrc === "string") known.push([t.id, t.autoTilesetSrc]);
  for (const [id, assetKey] of known) {
    if (!id || !assetKey || !textures.exists(id)) continue;
    const src = textures.get(id)?.getSourceImage?.()?.src;
    if (typeof src !== "string" || !src) continue;
    for (const enc of [SEGMENTS, WHOLE]) {
      const tail = enc(assetKey);
      if (src.endsWith(tail)) return src.slice(0, src.length - tail.length) + enc(key);
    }
  }
  return null;
}

interface DesktopWindow {
  location?: { pathname?: string };
  psMakerDesktop?: { storage?: { getAssetUrl?(folderName: string, assetKey: string): Promise<string | null> } };
}

/** URL of a project font file, or null. */
export async function projectFontUrl(story: (PsStory & Raw) | null, textures: TextureSource, key: string, win: DesktopWindow | undefined = globalThis as unknown as DesktopWindow): Promise<string | null> {
  if (!key) return null;
  if (/^(https?:|data:|blob:|\/)/.test(key)) return key;
  if (key.startsWith("game-assets/")) return SEGMENTS(key);
  const folder = /\/editor\/([^/]+)/.exec(win?.location?.pathname ?? "")?.[1];
  const getAssetUrl = win?.psMakerDesktop?.storage?.getAssetUrl;
  if (folder && typeof getAssetUrl === "function") {
    try {
      const url = await getAssetUrl.call(win!.psMakerDesktop!.storage, decodeURIComponent(folder), key);
      if (url) return url;
    } catch {
      /* not this project: try the pictures */
    }
  }
  return projectAssetUrl(story, textures, key);
}

const requested = new Set<string>();

/**
 * Registers a project font unless PS Maker (or an earlier call) already did. Returns the family
 * name, or null when the font or its file URL is unknown.
 */
export async function ensureProjectFont(story: (PsStory & Raw) | null, textures: TextureSource, fontId: string, doc: FontDoc | undefined = (globalThis as unknown as { document?: FontDoc }).document, Face: FaceCtor | undefined = (globalThis as unknown as { FontFace?: FaceCtor }).FontFace, win?: DesktopWindow): Promise<string | null> {
  if (!fontId || !doc?.fonts || typeof Face !== "function") return null;
  const font = (story?.gameUI?.fonts ?? []).find((f) => f.id === fontId) as (Raw & { key?: string }) | undefined;
  const family = fontFaceFamily(fontId);
  for (const f of doc.fonts) if (f.family.replace(/["']/g, "") === family) return family;
  if (requested.has(family)) return family;
  if (!font?.key) return null;
  requested.add(family);
  const url = await projectFontUrl(story, textures, font.key, win);
  if (!url) {
    requested.delete(family);
    return null;
  }
  try {
    const face = new Face(family, `url("${url.replace(/"/g, '\\"')}")`, { style: "normal", weight: "400", display: "swap" });
    doc.fonts.add(await face.load());
    return family;
  } catch {
    requested.delete(family);
    return null;
  }
}

/** For tests. */
export function forgetRequestedFonts(): void {
  requested.clear();
}
