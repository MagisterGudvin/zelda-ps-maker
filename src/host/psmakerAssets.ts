import type { AnimDef, SheetDef } from "../core/animation.ts";
import type { Facing } from "../core/math.ts";

/**
 * PS Maker's own sprite-sheet animations, read from the project data
 * ("story", format seen in a PS Maker 1.2.1 story.json: `characters`,
 * `spritesheetAnimations`, `player`). The plugin API does not hand this data
 * to plugins, so it is searched for at runtime (Phaser JSON cache, registry,
 * scene/game properties). Everything here is best effort: when the data or
 * the textures are not found the caller falls back to Define Sprite Sheet.
 */

export interface PsAnimRange {
  id: string;
  name?: string;
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

export interface PsSheet {
  id: string;
  name: string;
  src: string;
  frameWidth: number;
  frameHeight: number;
  frameRate?: number;
  ownerRef?: { type: string; id?: string };
  animations: PsAnimRange[];
}

export interface PsAnimationSet {
  id: string;
  animations: Record<string, string | number | undefined>;
  collision?: { enabled?: boolean; box?: { x: number; y: number; width: number; height: number } };
  depthOrigin?: number;
}

export interface PsCharacter {
  id: string;
  name: string;
  key?: string;
  animationSets: PsAnimationSet[];
  defaultAnimationSetId?: string;
}

export interface PsStory {
  characters: PsCharacter[];
  spritesheetAnimations: PsSheet[];
  player?: { animationSets: PsAnimationSet[]; defaultAnimationSetId?: string };
}

export function isStory(v: unknown): v is PsStory {
  const o = v as PsStory | null;
  return !!o && typeof o === "object" && Array.isArray(o.spritesheetAnimations) && Array.isArray(o.characters);
}

/**
 * Breadth-first search for the project data from a few roots. Bounded in depth
 * and node count; DOM nodes, typed arrays and functions are skipped.
 */
export function findStory(roots: { label: string; value: unknown }[], maxDepth = 4, maxNodes = 4000): { story: PsStory; where: string } | null {
  const seen = new Set<unknown>();
  const queue: { v: unknown; path: string; depth: number }[] = roots.map((r) => ({ v: r.value, path: r.label, depth: 0 }));
  let visited = 0;
  while (queue.length > 0 && visited < maxNodes) {
    const { v, path, depth } = queue.shift()!;
    if (!v || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    visited++;
    if (isStory(v)) return { story: v, where: path };
    if (depth >= maxDepth || ArrayBuffer.isView(v) || (typeof (v as { nodeType?: unknown }).nodeType === "number")) continue;
    if (v instanceof Map) {
      for (const [k, child] of v) queue.push({ v: child, path: `${path}.${String(k)}`, depth: depth + 1 });
      continue;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < Math.min(v.length, 50); i++) queue.push({ v: v[i], path: `${path}[${i}]`, depth: depth + 1 });
      continue;
    }
    let keys: string[];
    try {
      keys = Object.keys(v);
    } catch {
      continue;
    }
    for (const k of keys.slice(0, 200)) {
      let child: unknown;
      try {
        child = (v as Record<string, unknown>)[k];
      } catch {
        continue;
      }
      if (child && typeof child === "object") queue.push({ v: child, path: `${path}.${k}`, depth: depth + 1 });
    }
  }
  return null;
}

const norm = (s: string) => s.trim().toLowerCase();

export function findCharacter(story: PsStory, name: string): PsCharacter | null {
  const n = norm(name);
  return story.characters.find((c) => norm(c.name) === n || norm(c.key ?? "") === n || c.id === name) ?? null;
}

function defaultSet(sets: PsAnimationSet[] | undefined, id: string | undefined): PsAnimationSet | null {
  if (!sets || sets.length === 0) return null;
  return sets.find((s) => s.id === id) ?? sets[0];
}

/** Sheets owned by a character ("npc" owner with its id) or by the player. */
export function sheetsOf(story: PsStory, owner: { type: "npc"; id: string } | { type: "player" }): PsSheet[] {
  return story.spritesheetAnimations.filter((s) => s.ownerRef?.type === owner.type && (owner.type === "player" || s.ownerRef?.id === owner.id));
}

/** Columns of a horizontal-frames sheet: the longest row. */
export function sheetColumns(sheet: PsSheet): number {
  return Math.max(1, ...sheet.animations.map((a) => Math.max(a.startCol, a.endCol) + 1));
}

function framesOf(sheet: PsSheet, range: PsAnimRange): number[] {
  const cols = sheetColumns(sheet);
  const out: number[] = [];
  for (let row = range.startRow; row <= range.endRow; row++) {
    const from = row === range.startRow ? range.startCol : 0;
    const to = row === range.endRow ? range.endCol : cols - 1;
    for (let col = from; col <= to; col++) out.push(row * cols + col);
  }
  return out;
}

const FACINGS: Facing[] = ["down", "up", "left", "right"];

/**
 * Which row each direction uses, taken from the character's default animation
 * set (e.g. Mana Seed: down 0, left 1, right 2, up 3). Other sheets of the same
 * character are assumed to share the row order.
 */
export function directionRows(story: PsStory, set: PsAnimationSet | null): Partial<Record<Facing, number>> {
  const rows: Partial<Record<Facing, number>> = {};
  if (!set) return rows;
  for (const f of FACINGS) {
    const id = set.animations[f];
    if (typeof id !== "string") continue;
    for (const sheet of story.spritesheetAnimations) {
      const a = sheet.animations.find((x) => x.id === id);
      if (a) rows[f] = a.startRow;
    }
  }
  return rows;
}

/** Per-direction frames of a sheet using the character's row order. */
export function directionalFrames(sheet: PsSheet, rows: Partial<Record<Facing, number>>): Partial<Record<Facing, number[]>> {
  const out: Partial<Record<Facing, number[]>> = {};
  for (const f of FACINGS) {
    const row = rows[f];
    const range = row === undefined ? undefined : sheet.animations.find((a) => a.startRow === row);
    if (range) out[f] = framesOf(sheet, range);
  }
  if (Object.keys(out).length === 0 && sheet.animations[0]) out.down = framesOf(sheet, sheet.animations[0]);
  return out;
}

/** Frames of the animation set's own direction entries (e.g. walk or idleDown...). */
function setFrames(story: PsStory, set: PsAnimationSet, prefix: "" | "idle"): { sheet: PsSheet; frames: Partial<Record<Facing, number[]>> } | null {
  let sheet: PsSheet | null = null;
  const frames: Partial<Record<Facing, number[]>> = {};
  for (const f of FACINGS) {
    const key = prefix ? `idle${f[0].toUpperCase()}${f.slice(1)}` : f;
    const id = set.animations[key];
    if (typeof id !== "string") continue;
    for (const s of story.spritesheetAnimations) {
      const a = s.animations.find((x) => x.id === id);
      if (a && (!sheet || sheet === s)) {
        sheet = s;
        frames[f] = framesOf(s, a);
      }
    }
  }
  return sheet ? { sheet, frames } : null;
}

export type EnemyAnimState = "idle" | "walk" | "attack" | "hurt" | "death";

const STATE_WORDS: Record<EnemyAnimState, RegExp> = {
  idle: /idle|stand/i,
  walk: /walk|run|move/i,
  attack: /attack|strike|slash/i,
  hurt: /hurt|hit|damage/i,
  death: /death|dead|die/i,
};

/** Picks the sheet whose name names a state ("Slime Run" → walk); plain names win over compound ones. */
export function sheetForState(sheets: PsSheet[], state: EnemyAnimState): PsSheet | null {
  const matches = sheets.filter((s) => STATE_WORDS[state].test(s.name) && (state === "attack" || !STATE_WORDS.attack.test(s.name)));
  if (matches.length === 0) return null;
  // "Sword Attack" before "Sword Walk Attack"; "Walk" before "Run".
  return matches.sort((a, b) => a.name.split(/\s+/).length - b.name.split(/\s+/).length || (/walk/i.test(b.name) ? 1 : 0) - (/walk/i.test(a.name) ? 1 : 0))[0];
}

export interface PsAnimPlan {
  /** Sheets to register: id → PS Maker sheet. */
  sheets: Record<string, PsSheet>;
  /** Animations to register: id → definition (sheet ids refer to `sheets`). */
  animations: Record<string, AnimDef>;
  /** State → animation id. */
  states: Partial<Record<EnemyAnimState, string>>;
  /** Hitbox and picture offset from the character's collision box (frame pixels). */
  hitbox: { width: number; height: number; offsetX: number; offsetY: number } | null;
}

function sheetId(sheet: PsSheet): string {
  return `ps_${sheet.id}`;
}

/** Everything needed to draw a PS Maker character as a toolkit enemy. */
export function characterPlan(story: PsStory, character: PsCharacter): PsAnimPlan {
  const set = defaultSet(character.animationSets, character.defaultAnimationSetId);
  const rows = directionRows(story, set);
  const sheets = sheetsOf(story, { type: "npc", id: character.id });
  const plan: PsAnimPlan = { sheets: {}, animations: {}, states: {}, hitbox: null };
  const add = (state: EnemyAnimState, sheet: PsSheet, frames: Partial<Record<Facing, number[]>>, loop: boolean) => {
    const anim = `ps_${character.id}_${state}`;
    plan.sheets[sheetId(sheet)] = sheet;
    plan.animations[anim] = { sheet: sheetId(sheet), frames, loop, ...(loop ? { fps: sheet.frameRate || 8 } : {}) };
    plan.states[state] = anim;
  };
  for (const state of ["idle", "walk", "attack", "hurt", "death"] as const) {
    const sheet = sheetForState(sheets, state);
    if (sheet) add(state, sheet, directionalFrames(sheet, rows), state === "idle" || state === "walk");
  }
  if (set && !plan.states.walk) {
    const own = setFrames(story, set, "");
    if (own) add("walk", own.sheet, own.frames, true);
  }
  if (set && !plan.states.idle) {
    const own = setFrames(story, set, "idle");
    if (own) add("idle", own.sheet, own.frames, true);
  }
  const box = set?.collision?.enabled !== false ? set?.collision?.box : undefined;
  const any = Object.values(plan.sheets)[0] ?? sheets[0];
  if (box && any) {
    plan.hitbox = {
      width: box.width,
      height: box.height,
      offsetX: Math.round(any.frameWidth / 2 - (box.x + box.width / 2)) || 0,
      offsetY: Math.round(any.frameHeight / 2 - (box.y + box.height / 2)) || 0,
    };
  }
  return plan;
}

/** A player sheet by name (e.g. "Sword Attack") as a directional animation. */
export function playerSheetAnim(story: PsStory, name: string, loop = false): { sheetKey: string; sheet: PsSheet; anim: AnimDef } | null {
  const sheets = sheetsOf(story, { type: "player" });
  const sheet = sheets.find((s) => norm(s.name) === norm(name));
  if (!sheet) return null;
  const set = defaultSet(story.player?.animationSets, story.player?.defaultAnimationSetId);
  return { sheetKey: sheetId(sheet), sheet, anim: { sheet: sheetId(sheet), frames: directionalFrames(sheet, directionRows(story, set)), loop } };
}

/** Names of sheets a character (or the player) owns, for messages. */
export function sheetNames(story: PsStory, owner: { type: "npc"; id: string } | { type: "player" }): string[] {
  return sheetsOf(story, owner).map((s) => s.name);
}

/** Converts a PS Maker sheet to the toolkit's sheet definition once its texture key or URL is known. */
export function toSheetDef(sheet: PsSheet, image: string): SheetDef {
  return { image, frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight };
}

interface TextureManagerLike {
  exists(key: string): boolean;
  getTextureKeys?(): string[];
  get?(key: string): { source?: { image?: { src?: string } }[] } | undefined;
}

/**
 * Texture key PS Maker loaded a sheet under, or a URL to load it from. PS Maker's
 * key naming is not documented: the sheet id, its file name (with or without
 * extension), any key containing either, or a texture whose image URL ends with
 * the file name are accepted. As a last resort the URL is built from the folder
 * of another loaded project image.
 */
export function sheetImage(textures: TextureManagerLike, sheet: PsSheet, story: PsStory): string | null {
  const base = sheet.src.replace(/\.[a-z0-9]+$/i, "");
  for (const k of [sheet.id, sheet.src, base]) if (k && textures.exists(k)) return k;
  const keys = textures.getTextureKeys?.() ?? [];
  const byName = keys.find((k) => k.includes(sheet.id) || k.includes(base));
  if (byName) return byName;
  const srcOf = (k: string) => {
    try {
      return textures.get?.(k)?.source?.[0]?.image?.src ?? "";
    } catch {
      return "";
    }
  };
  const byUrl = keys.find((k) => srcOf(k).endsWith(sheet.src));
  if (byUrl) return byUrl;
  // Folder of any other project image that is loaded.
  const known = story.spritesheetAnimations.map((s) => s.src);
  for (const k of keys) {
    const url = srcOf(k);
    const hit = known.find((src) => src && url.endsWith(src));
    if (hit) return url.slice(0, url.length - hit.length) + sheet.src;
  }
  return null;
}
