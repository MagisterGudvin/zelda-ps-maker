/**
 * UI layouts made in the designer (Zelda: UI Layout): elements placed in layout pixels (one per map
 * pixel at scale 0) on the game window, each with its pictures, its value and its visibility. The
 * text form is versioned and every field is checked, so a layout typed or saved by an older
 * toolkit still loads.
 */

export const LAYOUT_VERSION = 1;

export type Anchor = "tl" | "t" | "tr" | "l" | "c" | "r" | "bl" | "b" | "br";
export const ANCHORS: readonly Anchor[] = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];

/** When an element shows: always, while a project variable is on, while the player has an item. */
export interface Visibility {
  when: "always" | "variable" | "item";
  id?: string;
  /** Hidden while a PS Maker dialogue is open. */
  hideInDialogue?: boolean;
}

export type ElementType = "image" | "text" | "bar" | "hearts" | "counter" | "item";
export const ELEMENT_TYPES: readonly ElementType[] = ["image", "text", "bar", "hearts", "counter", "item"];

interface Base {
  id: string;
  type: ElementType;
  /** Top-left corner, from the anchor point of the game window (layout pixels). */
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: Anchor;
  show: Visibility;
}

/** A picture: stretched, 9-slice (corners `slice` pixels) or fitted; a colour where it has none. */
export interface ImageElement extends Base {
  type: "image";
  image: string;
  mode: "stretch" | "nine" | "fit";
  slice: number;
  color: string;
}

/** Text with values in braces: "{rupees}", "{var:<variable id>}", "{t:hud.life}". */
export interface TextElement extends Base {
  type: "text";
  text: string;
  /** Project font id ("" = the layout's font). */
  font: string;
  size: number;
  color: string;
  align: "left" | "center" | "right";
}

/** A meter: the fill over the back, cut towards `dir` as `value` drops from `max`. */
export interface BarElement extends Base {
  type: "bar";
  value: string;
  max: string;
  fill: string;
  back: string;
  dir: "up" | "right" | "down" | "left";
  fillColor: string;
  backColor: string;
}

/** Heart containers in rows: full, half and empty pictures by the player's health. */
export interface HeartsElement extends Base {
  type: "hearts";
  full: string;
  half: string;
  empty: string;
  perRow: number;
  gap: number;
}

/** An icon above a number drawn with a digit strip (ten digits in a row) or the built-in digits. */
export interface CounterElement extends Base {
  type: "counter";
  value: string;
  icon: string;
  digits: string;
  places: number;
}

/** The selected item's icon in a frame. */
export interface ItemElement extends Base {
  type: "item";
  frame: string;
}

export type UiElement = ImageElement | TextElement | BarElement | HeartsElement | CounterElement | ItemElement;

/** Look of things the toolkit draws around the layout (inventory panel, item icons, notes). */
export interface LayoutTheme {
  font: string;
  textColor: string;
  /** Item id → picture for its icon (built-in items; Define Item has its own icon). */
  icons: Record<string, string>;
  panel: string;
  panelSlice: number;
  cursor: string;
}

export interface UiLayout {
  v: number;
  /** Size of a layout pixel on screen: 0 = like the map. */
  scale: number;
  theme: LayoutTheme;
  elements: UiElement[];
}

/** A value an element shows, by its binding ("health", "rupees", "var:<id>"...). */
export type LayoutValues = Record<string, number | string>;

// ---- reading untrusted text ----------------------------------------------------------------

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

function visibility(v: unknown): Visibility {
  const o = isObj(v) ? v : {};
  const when = oneOf(o.when, ["always", "variable", "item"] as const, "always");
  return { when, ...(when !== "always" ? { id: str(o.id) } : {}), ...(o.hideInDialogue === true ? { hideInDialogue: true } : {}) };
}

/** One element with every field checked and defaulted; null for an unknown type. */
export function readElement(v: unknown, index = 0): UiElement | null {
  if (!isObj(v)) return null;
  const type = v.type as ElementType;
  if (!ELEMENT_TYPES.includes(type)) return null;
  const base = {
    id: str(v.id) || `${type}${index + 1}`,
    x: Math.round(num(v.x, 0)),
    y: Math.round(num(v.y, 0)),
    w: Math.max(1, Math.round(num(v.w, 16))),
    h: Math.max(1, Math.round(num(v.h, 16))),
    anchor: oneOf(v.anchor, ANCHORS, "tl"),
    show: visibility(v.show),
  };
  switch (type) {
    case "image":
      return { ...base, type, image: str(v.image), mode: oneOf(v.mode, ["stretch", "nine", "fit"] as const, "stretch"), slice: Math.max(0, Math.round(num(v.slice, 4))), color: str(v.color) };
    case "text":
      return { ...base, type, text: str(v.text), font: str(v.font), size: Math.max(1, num(v.size, 8)), color: str(v.color), align: oneOf(v.align, ["left", "center", "right"] as const, "left") };
    case "bar":
      return { ...base, type, value: str(v.value, "magic"), max: str(v.max, "maxMagic"), fill: str(v.fill), back: str(v.back), dir: oneOf(v.dir, ["up", "right", "down", "left"] as const, "right"), fillColor: str(v.fillColor, "#3ad16b"), backColor: str(v.backColor, "#000000d9") };
    case "hearts":
      return { ...base, type, full: str(v.full), half: str(v.half), empty: str(v.empty), perRow: Math.max(1, Math.round(num(v.perRow, 10))), gap: Math.max(0, Math.round(num(v.gap, 1))) };
    case "counter":
      return { ...base, type, value: str(v.value, "rupees"), icon: str(v.icon), digits: str(v.digits), places: Math.min(6, Math.max(1, Math.round(num(v.places, 2)))) };
    case "item":
      return { ...base, type, frame: str(v.frame) };
  }
}

export function defaultTheme(): LayoutTheme {
  return { font: "", textColor: "#f8e0a0", icons: {}, panel: "", panelSlice: 4, cursor: "" };
}

function readTheme(v: unknown): LayoutTheme {
  const o = isObj(v) ? v : {};
  const icons: Record<string, string> = {};
  if (isObj(o.icons)) for (const [k, x] of Object.entries(o.icons)) if (typeof x === "string" && x) icons[k] = x;
  const d = defaultTheme();
  return { font: str(o.font), textColor: str(o.textColor, d.textColor), icons, panel: str(o.panel), panelSlice: Math.max(0, Math.round(num(o.panelSlice, d.panelSlice))), cursor: str(o.cursor) };
}

/** A layout from its text (the designer's saved field); null with a reason when unusable. */
export function parseLayout(text: string): { layout: UiLayout | null; error: string | null } {
  if (!text.trim()) return { layout: null, error: null };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { layout: null, error: `not valid layout data (${(err as Error).message})` };
  }
  if (!isObj(data)) return { layout: null, error: "layout data must be an object" };
  const v = num(data.v, 1);
  if (v > LAYOUT_VERSION) return { layout: null, error: `layout version ${v} is newer than this toolkit (${LAYOUT_VERSION})` };
  const elements = (Array.isArray(data.elements) ? data.elements : []).map(readElement).filter((e): e is UiElement => e !== null);
  // Ids are how the designer finds an element: make them unique.
  const seen = new Set<string>();
  for (const e of elements) {
    let id = e.id;
    for (let n = 2; seen.has(id); n++) id = `${e.id}_${n}`;
    e.id = id;
    seen.add(id);
  }
  return { layout: { v: LAYOUT_VERSION, scale: Math.max(0, Math.round(num(data.scale, 0))), theme: readTheme(data.theme), elements }, error: null };
}

export function layoutText(layout: UiLayout): string {
  return JSON.stringify(layout);
}

// ---- values ----------------------------------------------------------------------------------

const BRACES = /\{([^{}]+)\}/g;

/** Every value the layout shows (for the HUD to compute). */
export function layoutBindings(layout: UiLayout): Set<string> {
  const out = new Set<string>(["health", "maxHealth", "heartValue", "dialogue"]);
  for (const e of layout.elements) {
    if (e.type === "bar") (out.add(e.value), out.add(e.max));
    if (e.type === "counter") out.add(e.value);
    if (e.type === "item") (out.add("item.icon"), out.add("item.count"));
    if (e.type === "text") for (const m of e.text.matchAll(BRACES)) out.add(m[1]);
    if (e.show.when === "variable" && e.show.id) out.add(`var:${e.show.id}`);
    if (e.show.when === "item" && e.show.id) out.add(`owned:${e.show.id}`);
  }
  return out;
}

export function textWithValues(text: string, values: LayoutValues): string {
  return text.replace(BRACES, (_m, key: string) => {
    const v = values[key];
    return v === undefined ? "" : String(v);
  });
}

export function isShown(e: UiElement, values: LayoutValues): boolean {
  if (e.show.hideInDialogue && values.dialogue) return false;
  if (e.show.when === "variable") return !!e.show.id && !!values[`var:${e.show.id}`] && values[`var:${e.show.id}`] !== "0";
  if (e.show.when === "item") return !!e.show.id && !!values[`owned:${e.show.id}`];
  return true;
}

/** The pictures an element uses (built-in sprites like "hud_rupee" included). */
export function pictureKeys(e: UiElement): string[] {
  const keys = e.type === "image" ? [e.image] : e.type === "bar" ? [e.fill, e.back] : e.type === "hearts" ? [e.full, e.half, e.empty] : e.type === "counter" ? [e.icon, e.digits] : e.type === "item" ? [e.frame] : [];
  return keys.filter((k) => k && !k.startsWith("hud_") && !k.startsWith("icon_"));
}

// ---- geometry ----------------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The anchor point of the game window (layout pixels). */
export function anchorPoint(anchor: Anchor, viewW: number, viewH: number): { x: number; y: number } {
  const x = anchor.endsWith("l") ? 0 : anchor.endsWith("r") ? viewW : viewW / 2;
  const y = anchor.startsWith("t") ? 0 : anchor.startsWith("b") ? viewH : viewH / 2;
  if (anchor === "l") return { x: 0, y: viewH / 2 };
  if (anchor === "r") return { x: viewW, y: viewH / 2 };
  return { x: Math.round(x), y: Math.round(y) };
}

/** The element's top-left from a point on the game window (the inverse of placing it). */
export function offsetFrom(anchor: Anchor, left: number, top: number, viewW: number, viewH: number): { x: number; y: number } {
  const p = anchorPoint(anchor, viewW, viewH);
  return { x: Math.round(left - p.x), y: Math.round(top - p.y) };
}

// ---- the classic HUD ----------------------------------------------------------------------------

/**
 * The classic Zelda HUD as a layout (built-in pictures): magic meter and item box on the left,
 * rupee, bomb, arrow and key counters, "- LIFE -" and the hearts on the right (clear of PS Maker's
 * settings gear). It is the HUD while a map has no UI Layout, and the designer's starting template.
 */
export function classicLayout(options: { magic?: boolean; bottom?: boolean } = {}): UiLayout {
  const magic = options.magic !== false;
  const bottom = options.bottom === true;
  const top = (y: number, h: number) => (bottom ? -(y + h) : y);
  const a = (side: "l" | "r"): Anchor => ((bottom ? "b" : "t") + side) as Anchor;
  const show: Visibility = { when: "always" };
  const elements: UiElement[] = [];
  let x = 6;
  if (magic) {
    elements.push({ id: "magic", type: "bar", x, y: top(4, 30), w: 8, h: 30, anchor: a("l"), show, value: "magic", max: "maxMagic", fill: "", back: "", dir: "up", fillColor: "#3ad16b", backColor: "#000000d9" });
    x += 12;
  }
  elements.push({ id: "item", type: "item", x, y: top(6, 22), w: 22, h: 22, anchor: a("l"), show, frame: "" });
  x += 30;
  for (const [id, places] of [["rupees", 3], ["bombs", 2], ["arrows", 2], ["key", 1]] as const) {
    const w = Math.max(8, places * 6);
    elements.push({ id, type: "counter", x, y: top(6, 17), w, h: 17, anchor: a("l"), show, value: id, icon: `hud_${id === "key" ? "key" : id.replace(/s$/, "")}`, digits: "", places });
    x += w + 8;
  }
  // Ten hearts a row, 8 pixels apart, right-aligned 30 pixels in (the gear sits in the corner).
  elements.push({ id: "life", type: "text", x: -110, y: top(3, 8), w: 80, h: 8, anchor: a("r"), show, text: "{t:hud.life}", font: "", size: 7, color: "", align: "center" });
  elements.push({ id: "hearts", type: "hearts", x: -110, y: top(13, 16), w: 80, h: 16, anchor: a("r"), show, full: "", half: "", empty: "", perRow: 10, gap: 1 });
  return { v: LAYOUT_VERSION, scale: 0, theme: defaultTheme(), elements };
}
