/**
 * UI layouts made in the designer (Zelda: UI Layout): elements placed in layout pixels (one per map
 * pixel at scale 0) on the game window, each with its pictures, its value and its visibility. The
 * text form is versioned and every field is checked, so a layout typed or saved by an older
 * toolkit still loads.
 */

export const LAYOUT_VERSION = 1;

export type Anchor = "tl" | "t" | "tr" | "l" | "c" | "r" | "bl" | "b" | "br";
export const ANCHORS: readonly Anchor[] = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];

export const COMPARE_OPS = ["<", "<=", ">", ">=", "==", "!="] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

/**
 * When an element shows: always, while a project variable is on, while the player has an item, or
 * while a value compares to a number ("health" < 3).
 */
export interface Visibility {
  when: "always" | "variable" | "item" | "compare";
  /** Variable id, item id or the compared value's binding. */
  id?: string;
  op?: CompareOp;
  value?: number;
  /** Hidden while a PS Maker dialogue is open. */
  hideInDialogue?: boolean;
}

export type ElementType = "image" | "text" | "bar" | "hearts" | "counter" | "item" | "icon" | "slot" | "minimap" | "button" | "inventory" | "choices" | "keybinds";
export const ELEMENT_TYPES: readonly ElementType[] = ["image", "text", "bar", "hearts", "counter", "item", "icon", "slot", "minimap", "button", "inventory", "choices", "keybinds"];

/** A looping effect on an element while it shows. */
export type Effect = "none" | "blink" | "pulse" | "bob" | "shake";
export const EFFECTS: readonly Effect[] = ["none", "blink", "pulse", "bob", "shake"];

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
  /** Degrees, around the centre (pictures, texts and icons). */
  rotation: number;
  /** Opacity 0…1. */
  alpha: number;
  effect: Effect;
  /** Elements with the same group are selected and moved together in the designer. */
  group?: string;
  /** Not picked by clicks on the map in the designer (the list still selects it). */
  locked?: boolean;
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
  /** Outline colour ("" = a soft shadow instead) and its width in layout pixels. */
  stroke: string;
  strokeWidth: number;
  /** Long text breaks into lines at the element's width (a message box). */
  wrap: boolean;
}

export type BarShape = "rect" | "round" | "circle" | "diamond" | "triangle" | "star" | "heart";
export const BAR_SHAPES: readonly BarShape[] = ["rect", "round", "circle", "diamond", "triangle", "star", "heart"];

/**
 * A meter: the fill over the back, cut towards `dir` as `value` drops from `max`. Without pictures
 * it is a shape (rectangle, pill, circle, diamond, triangle, star, heart) in colours with a border.
 */
export interface BarElement extends Base {
  type: "bar";
  value: string;
  max: string;
  fill: string;
  back: string;
  dir: "up" | "right" | "down" | "left";
  fillColor: string;
  backColor: string;
  shape: BarShape;
  /** Border colour ("" = none) and width (layout pixels). */
  border: string;
  borderWidth: number;
  /** A label over the bar ("HP", "{health}/{maxHealth}"). */
  text: string;
  size: number;
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
  /** Which item button it shows: 1 = the first (useItem, C), 2 = the second (useItem2, B). */
  slot: 1 | 2;
}

/** One icon of an icon sheet (cells of `cellW` × `cellH` pixels, numbered row by row from 0). */
export interface IconElement extends Base {
  type: "icon";
  image: string;
  cellW: number;
  cellH: number;
  index: number;
}

/**
 * A quick-use slot: the `index`-th item the player can use from the item key (1 = first). Its key
 * (1–9 by default) selects that item; the selected slot shows its own frame.
 */
export interface SlotElement extends Base {
  type: "slot";
  index: number;
  frame: string;
  selected: string;
  /** Shows the slot's key in its corner. */
  keyLabel: boolean;
}

/** A simplified map around the player: walls, enemies, objects. */
export interface MinimapElement extends Base {
  type: "minimap";
  shape: "rect" | "circle";
  /** Map pixels from the player to the edge. */
  range: number;
  backColor: string;
  border: string;
  borderWidth: number;
  wallColor: string;
  playerColor: string;
  enemyColor: string;
  objectColor: string;
}

/** What a button does: run a PS Maker event, open or close a screen, set a project variable. */
export interface ButtonAction {
  kind: "none" | "event" | "open" | "close" | "variable" | "resetControls";
  /** Event id, screen name or variable id. */
  id: string;
  /** The variable's new value. */
  value: string;
}
export const BUTTON_ACTIONS: readonly ButtonAction["kind"][] = ["none", "event", "open", "close", "variable", "resetControls"];

/**
 * A button of a screen: a picture (another one while it is selected) or a colour, and a text.
 * Arrow keys move the selection between buttons, the action key or a click presses it.
 */
export interface ButtonElement extends Base {
  type: "button";
  image: string;
  hover: string;
  slice: number;
  color: string;
  hoverColor: string;
  text: string;
  font: string;
  size: number;
  textColor: string;
  action: ButtonAction;
}

/**
 * The items the player owns, in a grid (an inventory screen). Arrow keys move the cursor, the
 * action key takes the item in hand; texts show it with {inv.name}, {inv.description}, {inv.count}.
 */
export interface InventoryElement extends Base {
  type: "inventory";
  cols: number;
  cell: number;
  gap: number;
  frame: string;
  cursor: string;
  /** Shows the count of items that use ammunition (bombs, arrows). */
  counts: boolean;
}

/**
 * The answers of a Zelda: Dialogue with choices, one row each, shown once the last page is typed
 * out: arrows move the selection, the action key or a click picks one.
 */
export interface ChoicesElement extends Base {
  type: "choices";
  /** Project font id ("" = the layout's font). */
  font: string;
  size: number;
  color: string;
  /** Text colour of the selected answer ("" = gold). */
  selectedColor: string;
  rowHeight: number;
  gap: number;
  /** Row pictures (9-slice with `slice`), plain and selected ("" = none; the selected row gets a gold frame). */
  image: string;
  selected: string;
  slice: number;
  /** Text before the selected answer ("" = none). */
  marker: string;
}

/**
 * The player's key bindings (a controls screen): a row per toolkit action with its key and its
 * gamepad button. Arrows choose a row and a column, the action key waits for the new key or button.
 */
export interface KeybindsElement extends Base {
  type: "keybinds";
  font: string;
  size: number;
  color: string;
  /** Colour of the selected key or button ("" = gold). */
  selectedColor: string;
  rowHeight: number;
  /** Where the key column and the gamepad column start (percent of the width; 0 = the column is not shown). */
  keyColumn: number;
  padColumn: number;
}

export type UiElement = ImageElement | TextElement | BarElement | HeartsElement | CounterElement | ItemElement | IconElement | SlotElement | MinimapElement | ButtonElement | InventoryElement | ChoicesElement | KeybindsElement;

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

/**
 * What a screen is for: a plain screen (opened by actions and buttons), the pause menu (the Menu
 * key, Escape), the box for toolkit messages, the box for NPC dialogue (Zelda: Dialogue), the
 * short notifications over the game, the inventory (the inventory key, I), or the title screen
 * (the HUD hidden, no key closes it); or the HUD itself, always on screen (also a layout without a
 * screen name and without a role, as made before 0.27.0).
 */
export type ScreenRole = "hud" | "none" | "menu" | "message" | "dialogue" | "notification" | "inventory" | "title";
export const SCREEN_ROLES: readonly ScreenRole[] = ["hud", "none", "menu", "message", "dialogue", "notification", "inventory", "title"];
export const MESSAGE_KINDS = ["sign", "item", "hint", "info"] as const;
export type MessageKindName = (typeof MESSAGE_KINDS)[number];

/** How a screen (a layout with a name, opened over the game) behaves. */
export interface ScreenSettings {
  role: ScreenRole;
  /** The screen takes the keys (a menu). Off: a layer over the HUD (boss bar, notice) that the game plays under. */
  input: boolean;
  /** The game waits and the player stands still while the screen is open. */
  pause: boolean;
  /** Colour over the game behind the screen ("" = none). */
  dim: string;
  /** Message box: the toolkit messages it shows (signs, items received, hints, short notes). */
  kinds: MessageKindName[];
  /** Message box: letters a second as the text types out (0 = all at once). */
  typing: number;
  /** Project sounds: selection moves, a button is pressed, the screen opens, closes. */
  soundMove: string;
  soundPress: string;
  soundOpen: string;
  soundClose: string;
}

export interface UiLayout {
  v: number;
  /** Size of a layout pixel on screen: 0 = like the map. */
  scale: number;
  theme: LayoutTheme;
  screen: ScreenSettings;
  elements: UiElement[];
}

/** A value an element shows, by its binding ("health", "rupees", "var:<id>"...). */
export type LayoutValues = Record<string, number | string>;

/** One cell of an inventory grid: the item's icon and, for ammunition, its count. */
export interface InventoryCell {
  icon: string;
  count: number | null;
}

/** Index of the cell an arrow key moves an inventory cursor to (stays inside the grid). */
export function moveInGrid(index: number, count: number, cols: number, dir: "up" | "down" | "left" | "right"): number {
  if (count <= 0) return 0;
  const i = Math.min(Math.max(0, index), count - 1);
  const next = dir === "left" ? i - 1 : dir === "right" ? i + 1 : dir === "up" ? i - cols : i + cols;
  return next < 0 || next >= count ? i : next;
}

/** The world around the player for minimaps (map pixels). */
export interface MinimapData {
  x: number;
  y: number;
  walls: readonly { x: number; y: number; hw: number; hh: number }[];
  dots: readonly { x: number; y: number; kind: "enemy" | "object" }[];
}

// ---- reading untrusted text ----------------------------------------------------------------

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const int = (v: unknown, d: number, min: number, max = Infinity) => Math.min(max, Math.max(min, Math.round(num(v, d))));
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

function visibility(v: unknown): Visibility {
  const o = isObj(v) ? v : {};
  const when = oneOf(o.when, ["always", "variable", "item", "compare"] as const, "always");
  return {
    when,
    ...(when !== "always" ? { id: str(o.id) } : {}),
    ...(when === "compare" ? { op: oneOf(o.op, COMPARE_OPS, "<"), value: num(o.value, 0) } : {}),
    ...(o.hideInDialogue === true ? { hideInDialogue: true } : {}),
  };
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
    w: int(v.w, 16, 1),
    h: int(v.h, 16, 1),
    anchor: oneOf(v.anchor, ANCHORS, "tl"),
    show: visibility(v.show),
    rotation: ((Math.round(num(v.rotation, 0)) % 360) + 360) % 360,
    alpha: Math.min(1, Math.max(0, num(v.alpha, 1))),
    effect: oneOf(v.effect, EFFECTS, "none"),
    ...(typeof v.group === "string" && v.group ? { group: v.group } : {}),
    ...(v.locked === true ? { locked: true } : {}),
  };
  switch (type) {
    case "image":
      return { ...base, type, image: str(v.image), mode: oneOf(v.mode, ["stretch", "nine", "fit"] as const, "stretch"), slice: int(v.slice, 4, 0), color: str(v.color) };
    case "text":
      return { ...base, type, text: str(v.text), font: str(v.font), size: Math.max(1, num(v.size, 8)), color: str(v.color), align: oneOf(v.align, ["left", "center", "right"] as const, "left"), stroke: str(v.stroke), strokeWidth: Math.max(0, num(v.strokeWidth, 1)), wrap: v.wrap === true };
    case "bar":
      return {
        ...base,
        type,
        value: str(v.value, "magic"),
        max: str(v.max, "maxMagic"),
        fill: str(v.fill),
        back: str(v.back),
        dir: oneOf(v.dir, ["up", "right", "down", "left"] as const, "right"),
        fillColor: str(v.fillColor, "#3ad16b"),
        backColor: str(v.backColor, "#000000d9"),
        shape: oneOf(v.shape, BAR_SHAPES, "rect"),
        border: str(v.border, "#f0f0e0"),
        borderWidth: Math.max(0, num(v.borderWidth, 1)),
        text: str(v.text),
        size: Math.max(1, num(v.size, 6)),
      };
    case "hearts":
      return { ...base, type, full: str(v.full), half: str(v.half), empty: str(v.empty), perRow: int(v.perRow, 10, 1), gap: int(v.gap, 1, 0) };
    case "counter":
      return { ...base, type, value: str(v.value, "rupees"), icon: str(v.icon), digits: str(v.digits), places: int(v.places, 2, 1, 6) };
    case "item":
      return { ...base, type, frame: str(v.frame), slot: Number(v.slot) === 2 ? 2 : 1 };
    case "icon":
      return { ...base, type, image: str(v.image), cellW: int(v.cellW, 16, 0), cellH: int(v.cellH, 16, 0), index: int(v.index, 0, 0) };
    case "slot":
      return { ...base, type, index: int(v.index, 1, 1, 9), frame: str(v.frame), selected: str(v.selected), keyLabel: v.keyLabel !== false };
    case "minimap":
      return {
        ...base,
        type,
        shape: oneOf(v.shape, ["rect", "circle"] as const, "circle"),
        range: int(v.range, 160, 16),
        backColor: str(v.backColor, "#1f1a24d9"),
        border: str(v.border, "#f0f0e0"),
        borderWidth: Math.max(0, num(v.borderWidth, 1)),
        wallColor: str(v.wallColor, "#8e9aa8"),
        playerColor: str(v.playerColor, "#ff3040"),
        enemyColor: str(v.enemyColor, "#ffd23a"),
        objectColor: str(v.objectColor, "#5ad8ff"),
      };
    case "keybinds":
      return { ...base, type, font: str(v.font), size: Math.max(1, num(v.size, 7)), color: str(v.color), selectedColor: str(v.selectedColor), rowHeight: int(v.rowHeight, 11, 4), keyColumn: int(v.keyColumn, 55, 0, 100), padColumn: int(v.padColumn, 80, 0, 100) };
    case "choices":
      return { ...base, type, font: str(v.font), size: Math.max(1, num(v.size, 8)), color: str(v.color), selectedColor: str(v.selectedColor), rowHeight: int(v.rowHeight, 14, 4), gap: int(v.gap, 2, 0), image: str(v.image), selected: str(v.selected), slice: int(v.slice, 0, 0), marker: str(v.marker, "> ") };
    case "inventory":
      return { ...base, type, cols: int(v.cols, 6, 1, 16), cell: int(v.cell, 20, 8), gap: int(v.gap, 2, 0), frame: str(v.frame), cursor: str(v.cursor), counts: v.counts !== false };
    case "button": {
      const a = isObj(v.action) ? v.action : {};
      const action: ButtonAction = { kind: oneOf(a.kind, BUTTON_ACTIONS, "none"), id: str(a.id), value: str(a.value) };
      return { ...base, type, image: str(v.image), hover: str(v.hover), slice: int(v.slice, 4, 0), color: str(v.color, "#1f1a24e6"), hoverColor: str(v.hoverColor, "#4a3f58f0"), text: str(v.text), font: str(v.font), size: Math.max(1, num(v.size, 8)), textColor: str(v.textColor), action };
    }
  }
}

export function defaultScreen(): ScreenSettings {
  return { role: "none", input: true, pause: true, dim: "#00000080", kinds: ["sign", "item"], typing: 40, soundMove: "", soundPress: "", soundOpen: "", soundClose: "" };
}

function readScreen(v: unknown): ScreenSettings {
  const o = isObj(v) ? v : {};
  const d = defaultScreen();
  // 0.23–0.25 marked the pause menu with "menuKey".
  const role = oneOf(o.role, SCREEN_ROLES, o.menuKey === true ? "menu" : "none");
  const kinds = Array.isArray(o.kinds) ? MESSAGE_KINDS.filter((k) => (o.kinds as unknown[]).includes(k)) : d.kinds;
  return { role, input: o.input !== false, pause: o.pause !== false, dim: str(o.dim, d.dim), kinds, typing: Math.max(0, num(o.typing, d.typing)), soundMove: str(o.soundMove), soundPress: str(o.soundPress), soundOpen: str(o.soundOpen), soundClose: str(o.soundClose) };
}

export function defaultTheme(): LayoutTheme {
  return { font: "", textColor: "#f8e0a0", icons: {}, panel: "", panelSlice: 4, cursor: "" };
}

function readTheme(v: unknown): LayoutTheme {
  const o = isObj(v) ? v : {};
  const icons: Record<string, string> = {};
  if (isObj(o.icons)) for (const [k, x] of Object.entries(o.icons)) if (typeof x === "string" && x) icons[k] = x;
  const d = defaultTheme();
  return { font: str(o.font), textColor: str(o.textColor, d.textColor), icons, panel: str(o.panel), panelSlice: int(o.panelSlice, d.panelSlice, 0), cursor: str(o.cursor) };
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
  return { layout: { v: LAYOUT_VERSION, scale: int(data.scale, 0, 0), theme: readTheme(data.theme), screen: readScreen(data.screen), elements }, error: null };
}

// ---- values ----------------------------------------------------------------------------------

const BRACES = /\{([^{}]+)\}/g;

/** Every value the layout shows (for the HUD to compute). */
export function layoutBindings(layout: UiLayout): Set<string> {
  const out = new Set<string>(["health", "maxHealth", "heartValue", "dialogue"]);
  for (const e of layout.elements) {
    if (e.type === "bar") (out.add(e.value), out.add(e.max));
    if (e.type === "counter") out.add(e.value);
    if (e.type === "item") e.slot === 2 ? (out.add("item2.icon"), out.add("item2.count")) : (out.add("item.icon"), out.add("item.count"));
    if (e.type === "slot") (out.add(`slot.${e.index}.icon`), out.add(`slot.${e.index}.sel`));
    if (e.type === "inventory") (out.add("inv.name"), out.add("inv.description"), out.add("inv.count"));
    if (e.type === "text" || e.type === "button" || e.type === "bar") for (const m of e.text.matchAll(BRACES)) out.add(m[1]);
    if (e.type === "image") for (const m of e.image.matchAll(BRACES)) out.add(m[1]);
    if (e.show.when === "variable" && e.show.id) out.add(`var:${e.show.id}`);
    if (e.show.when === "item" && e.show.id) out.add(`owned:${e.show.id}`);
    if (e.show.when === "compare" && e.show.id) out.add(e.show.id);
  }
  return out;
}

export function textWithValues(text: string, values: LayoutValues): string {
  return text.replace(BRACES, (_m, key: string) => {
    const v = values[key];
    return v === undefined ? "" : String(v);
  });
}

function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "==":
      return a === b;
    case "!=":
      return a !== b;
  }
}

export function isShown(e: UiElement, values: LayoutValues): boolean {
  if (e.show.hideInDialogue && values.dialogue) return false;
  if (e.show.when === "variable") return !!e.show.id && !!values[`var:${e.show.id}`] && values[`var:${e.show.id}`] !== "0";
  if (e.show.when === "item") return !!e.show.id && !!values[`owned:${e.show.id}`];
  if (e.show.when === "compare") return !!e.show.id && compare(Number(values[e.show.id]) || 0, e.show.op ?? "<", e.show.value ?? 0);
  return true;
}

/** The pictures an element uses (built-in sprites like "hud_rupee" left out). */
export function pictureKeys(e: UiElement): string[] {
  const keys =
    e.type === "image" || e.type === "icon"
      ? [e.image]
      : e.type === "bar"
        ? [e.fill, e.back]
        : e.type === "hearts"
          ? [e.full, e.half, e.empty]
          : e.type === "counter"
            ? [e.icon, e.digits]
            : e.type === "item"
              ? [e.frame]
              : e.type === "slot"
                ? [e.frame, e.selected]
                : e.type === "inventory"
                  ? [e.frame, e.cursor]
                : e.type === "choices"
                  ? [e.image, e.selected]
                : e.type === "button"
                  ? [e.image, e.hover]
                  : [];
  // "{portrait}": a picture chosen by the value (the speaker's portrait), not a picture of the project.
  return keys.filter((k) => k && !k.startsWith("hud_") && !k.startsWith("icon_") && !k.includes("{"));
}

/** Offset (layout pixels) and opacity factor of an effect at a time (ms). */
export function effectAt(effect: Effect, timeMs: number): { dx: number; dy: number; alpha: number } {
  const t = timeMs / 1000;
  switch (effect) {
    case "blink":
      return { dx: 0, dy: 0, alpha: Math.floor(t * 4) % 2 === 0 ? 1 : 0 };
    case "pulse":
      return { dx: 0, dy: 0, alpha: 0.55 + 0.45 * Math.cos(t * Math.PI * 2) };
    case "bob":
      return { dx: 0, dy: Math.round(Math.sin(t * Math.PI * 2) * 2), alpha: 1 };
    case "shake":
      return { dx: Math.round(Math.sin(t * 50) * 1.5), dy: 0, alpha: 1 };
    default:
      return { dx: 0, dy: 0, alpha: 1 };
  }
}

// ---- geometry ----------------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The anchor point of the game window (layout pixels). */
export function anchorPoint(anchor: Anchor, viewW: number, viewH: number): Point {
  const x = anchor.endsWith("l") ? 0 : anchor.endsWith("r") ? viewW : viewW / 2;
  const y = anchor.startsWith("t") ? 0 : anchor.startsWith("b") ? viewH : viewH / 2;
  if (anchor === "l") return { x: 0, y: Math.round(viewH / 2) };
  if (anchor === "r") return { x: viewW, y: Math.round(viewH / 2) };
  return { x: Math.round(x), y: Math.round(y) };
}

/** Each element's box on a game window of a size (layout pixels), as placed by its anchor. */
export function layoutBoxes(layout: UiLayout, viewW: number, viewH: number): Record<string, Box> {
  const out: Record<string, Box> = {};
  for (const e of layout.elements) {
    const p = anchorPoint(e.anchor, viewW, viewH);
    out[e.id] = { x: p.x + e.x, y: p.y + e.y, w: e.w, h: e.h };
  }
  return out;
}

/**
 * The button the selection moves to from `from` in a direction: the nearest one whose centre lies
 * that way (distance across the direction counts double); `from` itself when there is none.
 */
export function nextButton(boxes: Record<string, Box>, ids: readonly string[], from: string, dir: "up" | "down" | "left" | "right"): string {
  const a = boxes[from];
  if (!a) return ids[0] ?? "";
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  let best = from;
  let bestScore = Infinity;
  for (const id of ids) {
    const b = boxes[id];
    if (id === from || !b) continue;
    const dx = b.x + b.w / 2 - ac.x;
    const dy = b.y + b.h / 2 - ac.y;
    const along = dir === "up" ? -dy : dir === "down" ? dy : dir === "left" ? -dx : dx;
    const across = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
    if (along <= 0) continue;
    const score = along + 2 * across;
    if (score < bestScore) (bestScore = score), (best = id);
  }
  return best;
}

/** The element's top-left from a point on the game window (the inverse of placing it). */
export function offsetFrom(anchor: Anchor, left: number, top: number, viewW: number, viewH: number): Point {
  const p = anchorPoint(anchor, viewW, viewH);
  return { x: Math.round(left - p.x), y: Math.round(top - p.y) };
}

/** The outline of a bar shape in a box (points in order around it). */
export function shapePolygon(shape: BarShape, b: Box): Point[] {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const ring = (n: number, r: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return { x: cx + Math.cos(a) * r(i) * (b.w / 2), y: cy + Math.sin(a) * r(i) * (b.h / 2) };
    });
  switch (shape) {
    case "circle":
      return ring(32, () => 1);
    case "diamond":
      return [{ x: cx, y: b.y }, { x: b.x + b.w, y: cy }, { x: cx, y: b.y + b.h }, { x: b.x, y: cy }];
    case "triangle":
      return [{ x: cx, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
    case "star":
      return ring(10, (i) => (i % 2 === 0 ? 1 : 0.45));
    case "heart": {
      // The classic parametric heart curve, fitted into the box.
      const pts: Point[] = [];
      for (let i = 0; i < 32; i++) {
        const t = (i / 32) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push({ x: cx + (x / 16) * (b.w / 2), y: b.y + ((12 - y) / 29) * b.h });
      }
      return pts;
    }
    case "round": {
      // A pill: half circles at the short ends.
      const r = Math.min(b.w, b.h) / 2;
      const pts: Point[] = [];
      const arc = (ax: number, ay: number, from: number) => {
        for (let i = 0; i <= 8; i++) {
          const a = from + (i / 8) * Math.PI;
          pts.push({ x: ax + Math.cos(a) * r, y: ay + Math.sin(a) * r });
        }
      };
      if (b.w >= b.h) {
        arc(b.x + b.w - r, cy, -Math.PI / 2);
        arc(b.x + r, cy, Math.PI / 2);
      } else {
        arc(cx, b.y + b.h - r, 0);
        arc(cx, b.y + r, Math.PI);
      }
      return pts;
    }
    default:
      return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
  }
}

/** The part of a polygon inside a convex polygon (Sutherland–Hodgman clipping). */
export function clipPolygon(subject: readonly Point[], clip: readonly Point[]): Point[] {
  let out = subject.slice();
  // The clip polygon's winding decides which side of each edge is inside.
  let area = 0;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p: Point) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= 0;
    const cross = (p: Point, q: Point): Point => {
      const d = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x);
      const t = d === 0 ? 0 : ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / d;
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) out.push(cross(p, q));
        out.push(q);
      } else if (inside(p)) out.push(cross(p, q));
    }
  }
  return out;
}

/** The filled part of a bar shape: the shape cut at the level `f` (0…1), filling towards `dir`. */
export function barFillPolygon(shape: BarShape, b: Box, dir: "up" | "right" | "down" | "left", f: number): Point[] {
  if (f <= 0) return [];
  const poly = shapePolygon(shape, b);
  if (f >= 1) return poly;
  const r: Box =
    dir === "up"
      ? { x: b.x - 1, y: b.y + b.h * (1 - f), w: b.w + 2, h: b.h * f + 1 }
      : dir === "down"
        ? { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h * f + 1 }
        : dir === "left"
          ? { x: b.x + b.w * (1 - f), y: b.y - 1, w: b.w * f + 1, h: b.h + 2 }
          : { x: b.x - 1, y: b.y - 1, w: b.w * f + 1, h: b.h + 2 };
  // Stars and hearts are not convex: clip the shape by the (convex) level rectangle.
  return clipPolygon(poly, shapePolygon("rect", r));
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
  const raw: Raw[] = [];
  let x = 6;
  if (magic) {
    raw.push({ id: "magic", type: "bar", x, y: top(4, 30), w: 8, h: 30, anchor: a("l"), value: "magic", max: "maxMagic", dir: "up" });
    x += 12;
  }
  // The two item buttons: C, and B under it (side by side they would run into the hearts on 256 pixels).
  raw.push({ id: "item", type: "item", x, y: top(6, 22), w: 22, h: 22, anchor: a("l") });
  raw.push({ id: "item2", type: "item", x, y: top(31, 22), w: 22, h: 22, anchor: a("l"), slot: 2 });
  x += 30;
  for (const [id, places] of [["rupees", 3], ["bombs", 2], ["arrows", 2], ["key", 1]] as const) {
    const w = Math.max(8, places * 6);
    raw.push({ id, type: "counter", x, y: top(6, 17), w, h: 17, anchor: a("l"), value: id, icon: `hud_${id === "key" ? "key" : id.replace(/s$/, "")}`, places });
    x += w + 8;
  }
  // Ten hearts a row, 8 pixels apart, right-aligned 30 pixels in (the gear sits in the corner).
  raw.push({ id: "life", type: "text", x: -110, y: top(3, 8), w: 80, h: 8, anchor: a("r"), text: "{t:hud.life}", size: 7, align: "center" });
  raw.push({ id: "hearts", type: "hearts", x: -110, y: top(13, 16), w: 80, h: 16, anchor: a("r"), perRow: 10, gap: 1 });
  return { v: LAYOUT_VERSION, scale: 0, theme: defaultTheme(), screen: defaultScreen(), elements: raw.map((r) => readElement(r)!) };
}
