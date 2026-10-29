import { createDefaultConfig } from "../core/config.ts";
import { layoutScale } from "../host/layoutPainter.ts";
import type { PsStory } from "../host/psmakerAssets.ts";
import { I18n } from "../ui/i18n.ts";
import { classicLayout, layoutBindings, parseLayout, readElement, type Box, type ElementType, type LayoutValues, type UiElement, type UiLayout } from "../ui/uiLayout.ts";

/**
 * What the UI designer edits, without Phaser or the page: where the game window sits on the map,
 * the layout of the map's "Zelda: UI Layout" action and the values it shows at the start of the
 * game, and the edits themselves.
 */

export const UI_LAYOUT_ACTION = "Zelda: UI Layout";
/** Label of the action's data field (the designer writes the layout there). */
export const LAYOUT_FIELD_LABEL = "Layout data";
/** PS Maker 1.2.1 plugin text fields keep up to 50000 characters (`maxlength`). */
export const LAYOUT_MAX_CHARS = 50000;

interface ActionLike {
  id?: string;
  type?: string;
  actionName?: string;
  pluginParams?: Record<string, unknown>;
  moveType?: string;
  position?: { x?: number; y?: number };
}
export interface MapLike {
  id?: string;
  setupActions?: ActionLike[];
  initialActions?: ActionLike[];
  enterActions?: ActionLike[];
}
type Raw = Record<string, any>;

const LISTS = [
  ["setupActions", "__map_setup__"],
  ["initialActions", "__map_start__"],
  ["enterActions", "__map_enter__"],
] as const;

export interface DesignerSetup {
  /** The game window on the map (world pixels) at the player's start. */
  frame: Box;
  /** The game's map zoom and screen size (logical pixels). */
  zoom: number;
  gameW: number;
  gameH: number;
  /** Start Toolkit's settings (hearts, language...). */
  start: Record<string, unknown>;
  layout: UiLayout;
  /** The action's saved text ("" = none or empty). */
  raw: string;
  error: string | null;
  values: LayoutValues;
  /** The map's UI Layout action (the designer edits it), or null (the classic HUD is shown). */
  action: { id: string; root: string } | null;
}

/** The HUD a map shows at the start of the game, from its Start Toolkit and UI Layout actions. */
export function designerSetup(map: MapLike, story: (PsStory & Raw) | null, cameraZoom: number): DesignerSetup | null {
  let start: ActionLike | null = null;
  let own: { action: ActionLike; root: string } | null = null;
  let spawn: { x: number; y: number } | null = null;
  for (const [list, root] of LISTS) {
    for (const a of map[list] ?? []) {
      if (a?.actionName === "Zelda: Start Toolkit" && !start) start = a;
      if (a?.actionName === UI_LAYOUT_ACTION) own = { action: a, root };
      if (a?.type === "movePlayerAction" && a.moveType === "absolute-position" && !spawn && typeof a.position?.x === "number" && typeof a.position?.y === "number") spawn = { x: a.position.x, y: a.position.y };
    }
  }
  const sp = start?.pluginParams ?? {};
  if (!start || sp.hud === false) return null;
  const raw = typeof own?.action.pluginParams?.layout === "string" ? (own.action.pluginParams.layout as string) : "";
  const parsed = parseLayout(raw);
  const layout = parsed.layout ?? classicLayout({ magic: sp.magicBar !== false, bottom: sp.hudBottom === true });
  const zoom = cameraZoom > 0 ? cameraZoom : Number(story?.gameConfig?.zoom) || 1;
  const gw = Number(story?.gameConfig?.width) || 1280;
  const gh = Number(story?.gameConfig?.height) || 720;
  const w = gw / zoom;
  const h = gh / zoom;
  const c = spawn ?? { x: w / 2, y: h / 2 };
  return {
    frame: { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h },
    zoom,
    gameW: gw,
    gameH: gh,
    start: sp,
    layout,
    raw,
    error: parsed.error,
    values: sampleValues(layout, sp),
    action: own?.action.id ? { id: own.action.id, root: own.root } : null,
  };
}

/** World pixels per layout pixel: the layout's scale against the map's zoom, as in the game. */
export function boardScale(setup: DesignerSetup, layout: UiLayout): number {
  return layoutScale(layout.scale, setup.zoom, setup.gameW, setup.gameH) / setup.zoom;
}

/**
 * The values at the start of the game (full health and magic, empty counters, no item), with
 * every element shown: the designer edits the ones hidden by a variable or an item too.
 */
export function sampleValues(layout: UiLayout, startParams: Record<string, unknown>): LayoutValues {
  const cfg = createDefaultConfig();
  const i18n = new I18n();
  i18n.setLanguage(typeof startParams.language === "string" && startParams.language ? startParams.language : "auto");
  const heart = cfg.player.heartValue;
  const hearts = Math.max(1, Math.round(Number(startParams.hearts) || 3));
  const out: LayoutValues = {};
  for (const key of layoutBindings(layout)) {
    if (key.startsWith("t:")) out[key] = i18n.t(key.slice(2));
    else if (key.startsWith("var:") || key.startsWith("owned:")) out[key] = 1;
    else if (key === "health" || key === "maxHealth") out[key] = hearts * heart;
    else if (key === "heartValue") out[key] = heart;
    else if (key === "hearts" || key === "maxHearts" || key === "fullHearts") out[key] = hearts;
    else if (key === "magic" || key === "maxMagic") out[key] = 1;
    else if (key === "magicPercent") out[key] = 100;
    else if (key === "item.icon" || key === "itemName") out[key] = "";
    else out[key] = 0;
  }
  out.dialogue = 0;
  return out;
}

// ---- edits -------------------------------------------------------------------------------------

/** Values an element can show (bars, counters, "{...}" in texts), for the designer's lists. */
export const BINDING_OPTIONS = [
  ["health", "Health"],
  ["maxHealth", "Max health"],
  ["hearts", "Hearts"],
  ["maxHearts", "Max hearts"],
  ["magic", "Magic"],
  ["maxMagic", "Max magic"],
  ["magicPercent", "Magic %"],
  ["rupees", "Rupees"],
  ["bombs", "Bombs"],
  ["arrows", "Arrows"],
  ["key", "Small keys"],
  ["itemCount", "Selected item's count"],
  ["itemName", "Selected item's name"],
  ["enemies", "Enemies left"],
] as const;

/** Built-in pictures offered next to the project's images. */
export const BUILT_IN_PICTURES = ["hud_rupee", "hud_bomb", "hud_arrow", "hud_key", "hud_magic", "hud_heart8_full", "hud_heart8_half", "hud_heart8_empty", "hud_heart_full", "hud_heart_half", "hud_heart_empty", "hud_slot"] as const;

/** An id not used by the layout yet: "text", "text2"... */
export function freeId(layout: UiLayout, base: string): string {
  const used = new Set(layout.elements.map((e) => e.id));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

const NEW: Record<ElementType, Raw> = {
  image: { w: 48, h: 16, color: "#000000aa", mode: "stretch" },
  text: { w: 64, h: 10, text: "Text", size: 8 },
  bar: { w: 40, h: 6, value: "health", max: "maxHealth", dir: "right" },
  hearts: { w: 80, h: 16 },
  counter: { w: 18, h: 17, value: "rupees", icon: "hud_rupee", places: 3 },
  item: { w: 22, h: 22 },
};

/** A new element of a type with its defaults, its top-left at a point of the game window. */
export function newElement(layout: UiLayout, type: ElementType, x: number, y: number): UiElement {
  return readElement({ ...NEW[type], type, id: freeId(layout, type), x: Math.round(x), y: Math.round(y) })!;
}

/** A copy of the layout (the designer never changes a layout it has handed out). */
export function cloneLayout(layout: UiLayout): UiLayout {
  return JSON.parse(JSON.stringify(layout)) as UiLayout;
}

/** Reads a field of an element by path ("x", "show.when"). */
export function getField(e: UiElement, path: string): unknown {
  return path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), e);
}

/**
 * The element with one field changed, checked again like a saved one (numbers rounded, choices
 * kept to their lists); null when the change makes no element (it never does for known fields).
 */
export function withField(e: UiElement, path: string, value: unknown): UiElement {
  const copy: Raw = JSON.parse(JSON.stringify(e));
  const keys = path.split(".");
  let o = copy;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)!] = value;
  return readElement(copy) ?? e;
}

/** The layout's text, or why it cannot be saved in the action's field. */
export function savedText(layout: UiLayout): { text: string; error: string | null } {
  const text = JSON.stringify(layout);
  return { text, error: text.length > LAYOUT_MAX_CHARS ? `the layout is ${text.length} characters, the field keeps ${LAYOUT_MAX_CHARS}` : null };
}

/** Undo and redo of whole layouts. */
export class History {
  private readonly back: string[] = [];
  private readonly ahead: string[] = [];
  private readonly limit: number;
  constructor(limit = 100) {
    this.limit = limit;
  }
  /** Remembers the layout before a change. */
  push(layout: UiLayout): void {
    const text = JSON.stringify(layout);
    this.ahead.length = 0;
    if (this.back.at(-1) === text) return;
    this.back.push(text);
    if (this.back.length > this.limit) this.back.shift();
  }
  undo(current: UiLayout): UiLayout | null {
    const text = this.back.pop();
    if (text === undefined) return null;
    this.ahead.push(JSON.stringify(current));
    return JSON.parse(text) as UiLayout;
  }
  redo(current: UiLayout): UiLayout | null {
    const text = this.ahead.pop();
    if (text === undefined) return null;
    this.back.push(JSON.stringify(current));
    return JSON.parse(text) as UiLayout;
  }
  get canUndo(): boolean {
    return this.back.length > 0;
  }
  get canRedo(): boolean {
    return this.ahead.length > 0;
  }
}

// ---- the action form ----------------------------------------------------------------------------

/** The open action settings panel if it shows the given action. */
export function openPanel(doc: any, title: string): any {
  const panel = doc?.querySelector?.('[data-map-editor-action-config-panel="true"]');
  if (!panel) return null;
  const crumbs = [...panel.querySelectorAll('nav[aria-label="Breadcrumb"] li')];
  const last = (crumbs.at(-1) as any)?.textContent?.trim();
  return last === title ? panel : null;
}

/**
 * Writes a text into a field of the open action form, found by its label, the way typing does
 * (the input's value through the native setter, then "input", "change" and "blur"). Collapsed
 * sections are opened first. False when the form or the field is not there.
 */
export function writeFormText(doc: any, title: string, label: string, value: string): boolean {
  const panel = openPanel(doc, title);
  if (!panel) return false;
  for (const d of panel.querySelectorAll("details")) if (!d.open) d.open = true;
  const el = [...panel.querySelectorAll(".label")].find((l: any) => (l.firstChild?.textContent ?? l.textContent ?? "").trim() === label) as any;
  const input = el?.parentElement?.querySelector?.("input, textarea");
  if (!input) return false;
  const view = doc.defaultView ?? globalThis;
  const proto = input.tagName === "TEXTAREA" ? view.HTMLTextAreaElement?.prototype : view.HTMLInputElement?.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto ?? {}, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  for (const type of ["input", "change", "blur"]) input.dispatchEvent(new view.Event(type, { bubbles: true }));
  return true;
}
