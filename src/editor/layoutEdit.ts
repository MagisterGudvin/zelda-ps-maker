import { createDefaultConfig } from "../core/config.ts";
import { layoutScale } from "../host/layoutPainter.ts";
import type { PsStory } from "../host/psmakerAssets.ts";
import { UI_LAYOUT_ACTION, layoutAction, projectUi } from "./projectUi.ts";
import { I18n } from "../ui/i18n.ts";
import { classicLayout, layoutBindings, offsetFrom, parseLayout, readElement, type Anchor, type Box, type ElementType, type LayoutValues, type UiElement, type UiLayout } from "../ui/uiLayout.ts";

/**
 * What the UI designer edits, without Phaser or the page: where the game window sits on the map,
 * the layout of the map's "Zelda: UI Layout" action and the values it shows at the start of the
 * game, and the edits themselves.
 */

export { UI_LAYOUT_ACTION } from "./projectUi.ts";
/** Label of the action's data field (the designer writes the layout there). */
export const LAYOUT_FIELD_LABEL = "Layout data";
/** PS Maker 1.2.1 plugin text fields keep up to 50000 characters (`maxlength`). */
const LAYOUT_MAX_CHARS = 50000;

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
  /** The UI Layout action shown (the designer edits it), or null (the classic HUD is shown). */
  action: { id: string; root: string } | null;
  /** Its screen name ("" = the HUD). */
  screen: string;
  /** Screen names of the map's UI Layout actions (for buttons that open one). */
  screens: string[];
  /** The map's own events (for buttons that run one). */
  mapEvents: { id: string; name: string }[];
  /**
   * How the shown HUD is shared: the classic HUD; this map's own ("thisMap"); the project's shared
   * HUD on this map ("shared") or from another map ("project"); or a second shared HUD that the
   * game does not show ("conflict"). Screens are "shared".
   */
  sharing: "classic" | "thisMap" | "shared" | "project" | "conflict";
  /** The map that holds the project's shared HUD. */
  sharedMap: string;
}

const screenOf = (a: ActionLike) => (typeof a.pluginParams?.name === "string" ? a.pluginParams.name.trim() : "");

/**
 * What the game window frame of a map shows: the UI Layout action open in the editor (`openId`),
 * else the map's HUD (its UI Layout without a screen name, or the classic HUD), at the start of
 * the game. Null when the map shows no HUD and no screen is open.
 */
export function designerSetup(map: MapLike & { storyEvents?: { id?: string; name?: string; hidden?: boolean }[] }, story: (PsStory & Raw) | null, cameraZoom: number, openId = ""): DesignerSetup | null {
  let start: ActionLike | null = null;
  let hud: { action: ActionLike; root: string } | null = null;
  let opened: { action: ActionLike; root: string } | null = null;
  let spawn: { x: number; y: number } | null = null;
  const screens: string[] = [];
  for (const [list, root] of LISTS) {
    for (const a of map[list] ?? []) {
      if (a?.actionName === "Zelda: Start Toolkit" && !start) start = a;
      if (a?.actionName === UI_LAYOUT_ACTION) {
        if (!screenOf(a)) hud = { action: a, root };
        else screens.push(screenOf(a));
        if (openId && a.id === openId) opened = { action: a, root };
      }
      if (a?.type === "movePlayerAction" && a.moveType === "absolute-position" && !spawn && typeof a.position?.x === "number" && typeof a.position?.y === "number") spawn = { x: a.position.x, y: a.position.y };
    }
  }
  const sp = start?.pluginParams ?? {};
  if (!opened && (!start || sp.hud === false)) return null;
  const shared = projectUi(story as Parameters<typeof projectUi>[0]).hud;
  let own = opened ?? hud;
  const screen = own ? screenOf(own.action) : "";
  const mine = own ? layoutAction(own.action) : null;
  const sharing: DesignerSetup["sharing"] = screen
    ? "shared"
    : own
      ? mine!.thisMapOnly
        ? "thisMap"
        : !shared || shared.actionId === own.action.id || shared.raw === mine!.raw
          ? "shared"
          : "conflict"
      : shared
        ? "project"
        : "classic";
  // What the game shows: a second shared HUD gives way to the project's (shown until it is opened).
  let raw = own ? mine!.raw : (shared?.raw ?? "");
  if (sharing === "conflict" && !opened) raw = shared!.raw;
  if (sharing === "project") own = null;
  const parsed = parseLayout(raw);
  const empty = { ...classicLayout(), elements: [] };
  const layout = parsed.layout ?? (screen ? empty : classicLayout({ magic: sp.magicBar !== false, bottom: sp.hudBottom === true }));
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
    screen,
    screens: [...new Set(screens)],
    mapEvents: (map.storyEvents ?? []).filter((e) => e?.id && !e.hidden).map((e) => ({ id: e.id!, name: e.name || e.id! })),
    sharing,
    sharedMap: shared?.mapName ?? "",
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
    else if (key === "message") out[key] = "A message of the toolkit shows here: a sign, an item received.";
    else if (key === "message.ready") out[key] = 1;
    else if (key === "inv.name") out[key] = i18n.has("item.bow.name") ? i18n.t("item.bow.name") : "Bow";
    else if (key === "inv.description") out[key] = i18n.has("item.bow.desc") ? i18n.t("item.bow.desc") : "";
    else if (key === "inv.count") out[key] = 30;
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
  ["message.ready", "Message box: page waits for a key (1/0)"],
  ["message.more", "Message box: more pages follow (1/0)"],
  ["inv.count", "Inventory: ammo of the item under the cursor"],
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
  bar: { w: 48, h: 8, value: "health", max: "maxHealth", dir: "right", shape: "round", fillColor: "#e04050", backColor: "#2a2030e6", border: "#000000" },
  hearts: { w: 80, h: 16 },
  counter: { w: 18, h: 17, value: "rupees", icon: "hud_rupee", places: 3 },
  item: { w: 22, h: 22 },
  icon: { w: 16, h: 16, cellW: 16, cellH: 16 },
  slot: { w: 20, h: 20, index: 1 },
  minimap: { w: 64, h: 64, shape: "circle" },
  button: { w: 72, h: 16, text: "Button", anchor: "c" },
  inventory: { w: 130, h: 42, cols: 6, cell: 20, gap: 2, anchor: "c" },
};

/** A new element of a type with its defaults, its top-left at a point of the game window (view size for its anchor). */
export function newElement(layout: UiLayout, type: ElementType, left: number, top: number, viewW = 0, viewH = 0): UiElement {
  const anchor = (NEW[type].anchor as Anchor | undefined) ?? "tl";
  return readElement({ ...NEW[type], ...offsetFrom(anchor, left, top, viewW, viewH), type, id: freeId(layout, type) })!;
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

// ---- selection, snapping, arranging ------------------------------------------------------------

/** The box around several boxes, or null. */
export function boundsOf(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** Ids of the element's group (all members), or just the element. */
export function withGroup(layout: UiLayout, id: string): string[] {
  const g = layout.elements.find((e) => e.id === id)?.group;
  return g ? layout.elements.filter((e) => e.group === g).map((e) => e.id) : [id];
}

export interface Guide {
  axis: "x" | "y";
  /** Position of the line (layout pixels). */
  at: number;
}

/**
 * How far to move a box so its edges or centre land on the grid, on the game window's edges and
 * centre or on other elements' edges and centres (whichever is nearest within `threshold`), and the
 * guide lines that show it.
 */
export function snapMove(box: Box, others: readonly Box[], viewW: number, viewH: number, threshold: number, grid = 0): { dx: number; dy: number; guides: Guide[] } {
  const guides: Guide[] = [];
  const axis = (pos: number, size: number, lines: number[], name: "x" | "y"): number => {
    let best = Infinity;
    let line = 0;
    for (const l of lines)
      for (const p of [pos, pos + size / 2, pos + size]) {
        const d = l - p;
        if (Math.abs(d) < Math.abs(best) && Math.abs(d) <= threshold) (best = d), (line = l);
      }
    if (best !== Infinity) {
      guides.push({ axis: name, at: line });
      return Math.round(best);
    }
    return grid > 1 ? Math.round(pos / grid) * grid - pos : 0;
  };
  const xs = [0, Math.round(viewW / 2), viewW, ...others.flatMap((o) => [o.x, Math.round(o.x + o.w / 2), o.x + o.w])];
  const ys = [0, Math.round(viewH / 2), viewH, ...others.flatMap((o) => [o.y, Math.round(o.y + o.h / 2), o.y + o.h])];
  return { dx: axis(box.x, box.w, xs, "x"), dy: axis(box.y, box.h, ys, "y"), guides };
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** A box resized by dragging one of its handles by (dx, dy); `keepRatio` keeps its proportions (corner handles). */
export function resizeBox(b: Box, handle: Handle, dx: number, dy: number, keepRatio = false): Box {
  let { x, y, w, h } = b;
  if (handle.includes("e")) w = b.w + dx;
  if (handle.includes("w")) (x = b.x + dx), (w = b.w - dx);
  if (handle.includes("s")) h = b.h + dy;
  if (handle.includes("n")) (y = b.y + dy), (h = b.h - dy);
  if (keepRatio && handle.length === 2 && b.w > 0 && b.h > 0) {
    const f = Math.max(w / b.w, h / b.h);
    const nw = b.w * f;
    const nh = b.h * f;
    if (handle.includes("w")) x = b.x + b.w - nw;
    if (handle.includes("n")) y = b.y + b.h - nh;
    (w = nw), (h = nh);
  }
  // Never smaller than a pixel; the opposite edge stays put.
  if (w < 1) {
    if (handle.includes("w")) x = b.x + b.w - 1;
    w = 1;
  }
  if (h < 1) {
    if (handle.includes("n")) y = b.y + b.h - 1;
    h = 1;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Moves elements by (dx, dy) layout pixels. */
export function moveElements(layout: UiLayout, ids: readonly string[], dx: number, dy: number): UiLayout {
  const next = cloneLayout(layout);
  for (const e of next.elements) if (ids.includes(e.id)) (e.x += dx), (e.y += dy);
  return next;
}

export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom" | "spreadX" | "spreadY";

/** Lines up elements by their boxes (the edges or centres of the box around them), or spaces them evenly. */
export function alignElements(layout: UiLayout, ids: readonly string[], boxes: Record<string, Box>, how: Align): UiLayout {
  const list = ids.filter((id) => boxes[id]);
  const all = boundsOf(list.map((id) => boxes[id]));
  if (!all || list.length < 2) return layout;
  const next = cloneLayout(layout);
  const shift = (id: string, dx: number, dy: number) => {
    const e = next.elements.find((x) => x.id === id);
    if (e) (e.x += Math.round(dx)), (e.y += Math.round(dy));
  };
  if (how === "spreadX" || how === "spreadY") {
    const horiz = how === "spreadX";
    const sorted = [...list].sort((a, b) => (horiz ? boxes[a].x - boxes[b].x : boxes[a].y - boxes[b].y));
    const total = sorted.reduce((t, id) => t + (horiz ? boxes[id].w : boxes[id].h), 0);
    const gap = ((horiz ? all.w : all.h) - total) / (sorted.length - 1);
    let at = horiz ? all.x : all.y;
    for (const id of sorted) {
      const b = boxes[id];
      if (horiz) shift(id, at - b.x, 0);
      else shift(id, 0, at - b.y);
      at += (horiz ? b.w : b.h) + gap;
    }
    return next;
  }
  for (const id of list) {
    const b = boxes[id];
    if (how === "left") shift(id, all.x - b.x, 0);
    if (how === "center") shift(id, all.x + all.w / 2 - (b.x + b.w / 2), 0);
    if (how === "right") shift(id, all.x + all.w - (b.x + b.w), 0);
    if (how === "top") shift(id, 0, all.y - b.y);
    if (how === "middle") shift(id, 0, all.y + all.h / 2 - (b.y + b.h / 2));
    if (how === "bottom") shift(id, 0, all.y + all.h - (b.y + b.h));
  }
  return next;
}

/** Changes the drawing order of elements (later = on top), keeping the order among them. */
export function reorderElements(layout: UiLayout, ids: readonly string[], how: "front" | "back" | "forward" | "backward"): UiLayout {
  const next = cloneLayout(layout);
  const picked = next.elements.filter((e) => ids.includes(e.id));
  const rest = next.elements.filter((e) => !ids.includes(e.id));
  if (how === "front") next.elements = [...rest, ...picked];
  else if (how === "back") next.elements = [...picked, ...rest];
  else {
    const list = next.elements;
    const step = how === "forward" ? 1 : -1;
    const order = how === "forward" ? [...list.keys()].reverse() : [...list.keys()];
    for (const i of order) {
      const j = i + step;
      if (!ids.includes(list[i].id) || j < 0 || j >= list.length || ids.includes(list[j].id)) continue;
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  return next;
}

/** Puts elements into one new group (or takes them out of their groups). */
export function groupElements(layout: UiLayout, ids: readonly string[], on: boolean): UiLayout {
  const next = cloneLayout(layout);
  const used = new Set(next.elements.map((e) => e.group).filter(Boolean));
  let g = "g1";
  for (let n = 2; used.has(g); n++) g = `g${n}`;
  for (const e of next.elements) {
    if (!ids.includes(e.id)) continue;
    if (on) e.group = g;
    else delete e.group;
  }
  return next;
}

/** Adds copies of elements with new names (and new groups for copied groups), moved by (dx, dy). The ids of the copies. */
export function pasteElements(layout: UiLayout, copies: readonly UiElement[], dx: number, dy: number): { layout: UiLayout; ids: string[] } {
  const next = cloneLayout(layout);
  const groups = new Map<string, string>();
  const used = new Set(next.elements.map((e) => e.group).filter(Boolean));
  const ids: string[] = [];
  for (const c of copies) {
    const e: UiElement = JSON.parse(JSON.stringify(c));
    e.id = freeId(next, c.id.replace(/\d+$/, "") || c.type);
    e.x += dx;
    e.y += dy;
    delete e.locked;
    if (c.group) {
      if (!groups.has(c.group)) {
        let g = "g1";
        for (let n = 2; used.has(g); n++) g = `g${n}`;
        used.add(g);
        groups.set(c.group, g);
      }
      e.group = groups.get(c.group);
    }
    next.elements.push(e);
    ids.push(e.id);
  }
  return { layout: next, ids };
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
