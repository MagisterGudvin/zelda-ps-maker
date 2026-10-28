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

/** An object of the PS Maker map object library (static picture or animated sheet). */
export interface PsMapObject {
  id: string;
  name: string;
  type?: string;
  collision?: { enabled?: boolean; box?: { x: number; y: number; width: number; height: number } };
  animationConfig?: { frameWidth?: number; frameHeight?: number };
}

export interface PsFont {
  id: string;
  name: string;
}

export interface PsStory {
  characters: PsCharacter[];
  spritesheetAnimations: PsSheet[];
  mapObjects?: PsMapObject[];
  gameUI?: { fonts?: PsFont[]; dialogLayouts?: unknown[]; defaultDialogLayoutId?: string | null };
  player?: { animationSets: PsAnimationSet[]; defaultAnimationSetId?: string };
}

export function isStory(v: unknown): v is PsStory {
  const o = v as PsStory | null;
  return !!o && typeof o === "object" && Array.isArray(o.spritesheetAnimations) && Array.isArray(o.characters);
}

/**
 * The project data of a map scene: GameMap.init keeps it as `scene.story` (also in the scene's
 * settings data), in the game and in the editor alike (docs/ENGINE_AUDIT.md, section 11).
 */
export function storyOfScene(scene: any): PsStory | null {
  for (const v of [scene?.story, scene?.sys?.settings?.data?.story]) if (isStory(v)) return v;
  return null;
}

/** The character picked in an `npc` field: PS Maker saves its id in the library. */
export function characterFromParam(story: PsStory, value: unknown): PsCharacter | null {
  return typeof value === "string" && value ? (story.characters.find((c) => c.id === value) ?? null) : null;
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

/**
 * Columns of the loaded texture, when known. PS Maker numbers frames by the image
 * width (row * floor(width / frameWidth) + col), which can exceed the longest row.
 */
export type ColumnsOf = (sheet: PsSheet) => number | null;

function framesOf(sheet: PsSheet, range: PsAnimRange, columnsOf?: ColumnsOf): number[] {
  const cols = columnsOf?.(sheet) || sheetColumns(sheet);
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
export function directionalFrames(sheet: PsSheet, rows: Partial<Record<Facing, number>>, columnsOf?: ColumnsOf): Partial<Record<Facing, number[]>> {
  const out: Partial<Record<Facing, number[]>> = {};
  for (const f of FACINGS) {
    const row = rows[f];
    const range = row === undefined ? undefined : sheet.animations.find((a) => a.startRow === row);
    if (range) out[f] = framesOf(sheet, range, columnsOf);
  }
  if (Object.keys(out).length === 0 && sheet.animations[0]) out.down = framesOf(sheet, sheet.animations[0], columnsOf);
  return out;
}

/** Frames of the animation set's own direction entries (e.g. walk or idleDown...). */
function setFrames(story: PsStory, set: PsAnimationSet, prefix: "" | "idle", columnsOf?: ColumnsOf): { sheet: PsSheet; frames: Partial<Record<Facing, number[]>> } | null {
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
        frames[f] = framesOf(s, a, columnsOf);
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
export function characterPlan(story: PsStory, character: PsCharacter, columnsOf?: ColumnsOf): PsAnimPlan {
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
    if (sheet) add(state, sheet, directionalFrames(sheet, rows, columnsOf), state === "idle" || state === "walk");
  }
  if (set && !plan.states.walk) {
    const own = setFrames(story, set, "", columnsOf);
    if (own) add("walk", own.sheet, own.frames, true);
  }
  if (set && !plan.states.idle) {
    const own = setFrames(story, set, "idle", columnsOf);
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

/**
 * Any picked PS Maker animation ("animation" / "player-animation-picker" fields) as a
 * directional animation over its whole sheet, with the row order of the sheet's owner
 * (the player's or the character's default animation set).
 */
export function animFromPick(story: PsStory, animationId: unknown, loop: boolean, columnsOf?: ColumnsOf): { sheetKey: string; sheet: PsSheet; anim: AnimDef } | null {
  if (typeof animationId !== "string" || !animationId) return null;
  const sheet = story.spritesheetAnimations.find((s) => s.animations.some((a) => a.id === animationId));
  if (!sheet) return null;
  const owner = sheet.ownerRef?.type === "npc" ? story.characters.find((c) => c.id === sheet.ownerRef?.id) : undefined;
  const set = owner ? defaultSet(owner.animationSets, owner.defaultAnimationSetId) : defaultSet(story.player?.animationSets, story.player?.defaultAnimationSetId);
  const anim: AnimDef = { sheet: sheetId(sheet), frames: directionalFrames(sheet, directionRows(story, set), columnsOf), loop };
  if (loop) anim.fps = sheet.frameRate || 8;
  return { sheetKey: sheetId(sheet), sheet, anim };
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
 * Texture key of a PS Maker sheet: PS Maker 1.2.1 loads every animation (one row of a sheet) of the
 * project as a whole-sheet texture "<animationId>frames" before the first map
 * (StoryAnimations/loadAnimations.ts).
 */
export function sheetImage(textures: TextureManagerLike, sheet: PsSheet): string | null {
  for (const a of sheet.animations) if (textures.exists(`${a.id}frames`)) return `${a.id}frames`;
  return null;
}

/**
 * A map object picked as an object's look. PS Maker loads every library map object as a texture
 * under its id (animated ones as a sheet "<id>_frames"; LoadingScene in PS Maker 1.2.1). The sprite
 * is "<texture>#<frame>" for sheets: the toolkit shows their first frame.
 */
export function mapObjectLook(story: PsStory, value: unknown): { sprite: string; box: { x: number; y: number; width: number; height: number } | null; frame: { w: number; h: number } | null } | null {
  const v = typeof value === "string" ? value : "";
  if (!v) return null;
  const mo = story.mapObjects?.find((m) => m.id === v) ?? story.mapObjects?.find((m) => m.name === v);
  if (!mo) return null;
  const animated = mo.type === "animated";
  const box = mo.collision?.enabled && mo.collision.box ? mo.collision.box : null;
  const frame = animated && mo.animationConfig?.frameWidth && mo.animationConfig.frameHeight ? { w: mo.animationConfig.frameWidth, h: mo.animationConfig.frameHeight } : null;
  return { sprite: animated ? `${mo.id}_frames#0` : mo.id, box, frame };
}

/**
 * CSS font family of a project font, as PS Maker registers it when it first shows one of its
 * windows (fontAssets.ts: FontFace "ps-maker-font-<id>"), then its name and a fallback.
 */
export function fontFamilyCss(story: PsStory | null, fontId: string, fallback = "monospace"): string {
  if (!fontId) return fallback;
  const font = story?.gameUI?.fonts?.find((f) => f.id === fontId);
  const safe = fontId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  // End on a generic family: a font name alone would fall back to the browser's serif default.
  const generic = /(^|,)\s*(serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*$/.test(fallback) ? fallback : `${fallback}, sans-serif`;
  return [quote(`ps-maker-font-${safe}`), ...(font?.name ? [quote(font.name)] : []), generic].join(", ");
}
