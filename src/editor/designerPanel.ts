import { ANCHORS, BAR_SHAPES, COMPARE_OPS, EFFECTS, type ElementType, type MessageKindName, type UiElement } from "../ui/uiLayout.ts";
import { ABILITY_OPTIONS, ITEM_OPTIONS } from "./fields.ts";
import { BINDING_OPTIONS, BUILT_IN_PICTURES, getField, type Align } from "./layoutEdit.ts";
import type { UiDesigner } from "./uiDesigner.ts";

/**
 * The UI designer's page parts: the panel at the left edge (elements, the selection's fields, the
 * layout's and the screen's settings), the right-click menu and the icon picker. Plain DOM with
 * inline styles; typing in them never reaches the editor's shortcuts.
 */

/** Element types in the order the designer offers them. */
export const TYPE_ITEMS: readonly [ElementType, string][] = [
  ["image", "Picture"],
  ["text", "Text"],
  ["bar", "Bar"],
  ["hearts", "Hearts"],
  ["counter", "Counter"],
  ["item", "Item box"],
  ["icon", "Icon"],
  ["slot", "Quick slot"],
  ["minimap", "Minimap"],
  ["button", "Button"],
  ["inventory", "Inventory grid"],
];
const TYPE_LABELS = Object.fromEntries(TYPE_ITEMS) as Record<ElementType, string>;
const ROTATABLE: readonly ElementType[] = ["image", "text", "icon"];

export type MenuItem = { label: string; key?: string; run: () => void; disabled?: boolean; danger?: boolean } | { separator: true } | { title: string };

type Opt = readonly [string, string];
type FieldKind = "num" | "text" | "color" | "pic" | "font" | "bind" | "choice" | "check" | "var" | "item" | "event" | "screen" | "sound" | "percent";
interface FieldDef {
  path: string;
  label: string;
  kind: FieldKind;
  options?: readonly Opt[];
}

const ROLE_OPTIONS: readonly Opt[] = [
  ["hud", "HUD (always on screen)"],
  ["none", "Plain screen (Open UI Screen, buttons)"],
  ["menu", "Pause menu (Escape opens and closes it)"],
  ["message", "Message box (signs, items received)"],
  ["dialogue", "Dialogue box (Zelda: Dialogue, NPCs)"],
  ["notification", "Notifications (short notes over the game)"],
  ["inventory", "Inventory (I opens it)"],
  ["title", "Title screen (hides the HUD)"],
];
const ROLE_HINTS: Record<string, string> = {
  hud: "The HUD: no screen name. Choosing another role gives this action a screen name; the map then shows the project's shared HUD (or the classic one).",
  dialogue: "Zelda: Dialogue shows what an NPC says here: {speaker}, {message} (tick \"Wrap lines\"), a Picture whose picture is {portrait}. Z, X or Escape: next page; the event waits until it closes.",
  notification: "Each short note (\"You got 5 bombs\", \"Saved\", hints the message box does not show) is drawn with this layout while it lasts: texts show {note}. Several notes stack one height apart. The game plays on.",
  menu: "Escape (the Menu key) opens and closes it; PS Maker's options menu opens from a button that runs an event with \"Open options menu\".",
  message: "Texts show {message} (tick \"Wrap lines\"); {message.ready} is 1 when the page waits for a key, {message.more} while more pages follow. Z, X or Escape: next page.",
  inventory: "Add an Inventory grid: arrows move its cursor, Z takes the item in hand. Texts show {inv.name}, {inv.description}, {inv.count}. I, X or Escape close it.",
  title: "Open it with Open UI Screen on the title map. Buttons run PS Maker events: change map (new game), open the load menu, the options menu, exit the game. No key closes it.",
};
const KIND_LABELS: readonly [MessageKindName, string][] = [
  ["sign", "Signs and object texts"],
  ["item", "Item received (chests, big items)"],
  ["hint", "Hints (locked, need an item, too heavy)"],
  ["info", "Short notes (saved, pickups)"],
];

const ANCHOR_LABELS: Record<string, string> = { tl: "Top left", t: "Top", tr: "Top right", l: "Left", c: "Centre", r: "Right", bl: "Bottom left", b: "Bottom", br: "Bottom right" };
const EFFECT_LABELS: Record<string, string> = { none: "None", blink: "Blink", pulse: "Pulse (fade)", bob: "Float up and down", shake: "Shake" };
const SHAPE_LABELS: Record<string, string> = { rect: "Rectangle", round: "Pill", circle: "Circle", diamond: "Diamond", triangle: "Triangle", star: "Star", heart: "Heart" };

const COMMON: FieldDef[] = [
  { path: "id", label: "Name", kind: "text" },
  { path: "anchor", label: "Anchor", kind: "choice", options: ANCHORS.map((a) => [a, ANCHOR_LABELS[a]] as const) },
  { path: "x", label: "X", kind: "num" },
  { path: "y", label: "Y", kind: "num" },
  { path: "w", label: "Width", kind: "num" },
  { path: "h", label: "Height", kind: "num" },
  { path: "rotation", label: "Rotation (°)", kind: "num" },
  { path: "alpha", label: "Opacity (%)", kind: "percent" },
  { path: "effect", label: "Effect", kind: "choice", options: EFFECTS.map((x) => [x, EFFECT_LABELS[x]] as const) },
  { path: "show.when", label: "Shown", kind: "choice", options: [["always", "Always"], ["variable", "While a variable is on"], ["item", "While the player has an item"], ["compare", "While a value compares"]] },
  { path: "show.id", label: "Variable", kind: "var" },
  { path: "show.id", label: "Item", kind: "item" },
  { path: "show.id", label: "Value", kind: "bind" },
  { path: "show.op", label: "Is", kind: "choice", options: COMPARE_OPS.map((o) => [o, o] as const) },
  { path: "show.value", label: "Than / to", kind: "num" },
  { path: "show.hideInDialogue", label: "Hide during dialogue", kind: "check" },
];

const BY_TYPE: Record<ElementType, FieldDef[]> = {
  image: [
    { path: "image", label: "Picture", kind: "pic" },
    { path: "mode", label: "Scaling", kind: "choice", options: [["stretch", "Stretch"], ["nine", "9-slice"], ["fit", "Fit"]] },
    { path: "slice", label: "Corner size (9-slice)", kind: "num" },
    { path: "color", label: "Colour without a picture", kind: "color" },
  ],
  text: [
    { path: "text", label: "Text ({rupees}, {var:id}, {t:hud.life})", kind: "text" },
    { path: "font", label: "Font", kind: "font" },
    { path: "size", label: "Size", kind: "num" },
    { path: "color", label: "Colour", kind: "color" },
    { path: "align", label: "Align", kind: "choice", options: [["left", "Left"], ["center", "Centre"], ["right", "Right"]] },
    { path: "stroke", label: "Outline colour (empty = shadow)", kind: "color" },
    { path: "strokeWidth", label: "Outline width", kind: "num" },
    { path: "wrap", label: "Wrap lines at the width", kind: "check" },
  ],
  bar: [
    { path: "value", label: "Value", kind: "bind" },
    { path: "max", label: "Maximum", kind: "bind" },
    { path: "shape", label: "Shape", kind: "choice", options: BAR_SHAPES.map((x) => [x, SHAPE_LABELS[x]] as const) },
    { path: "dir", label: "Fills towards", kind: "choice", options: [["right", "Right"], ["left", "Left"], ["up", "Up"], ["down", "Down"]] },
    { path: "fillColor", label: "Fill colour", kind: "color" },
    { path: "backColor", label: "Back colour", kind: "color" },
    { path: "border", label: "Border colour (empty = none)", kind: "color" },
    { path: "borderWidth", label: "Border width", kind: "num" },
    { path: "text", label: "Label (HP, {health})", kind: "text" },
    { path: "size", label: "Label size", kind: "num" },
    { path: "fill", label: "Fill picture", kind: "pic" },
    { path: "back", label: "Back picture", kind: "pic" },
  ],
  hearts: [
    { path: "full", label: "Full heart", kind: "pic" },
    { path: "half", label: "Half heart", kind: "pic" },
    { path: "empty", label: "Empty heart", kind: "pic" },
    { path: "perRow", label: "Hearts per row", kind: "num" },
    { path: "gap", label: "Gap", kind: "num" },
  ],
  counter: [
    { path: "value", label: "Value", kind: "bind" },
    { path: "icon", label: "Icon", kind: "pic" },
    { path: "digits", label: "Digit strip (0-9 in a row)", kind: "pic" },
    { path: "places", label: "Digits", kind: "num" },
  ],
  item: [{ path: "frame", label: "Frame picture", kind: "pic" }],
  icon: [
    { path: "image", label: "Icon sheet", kind: "pic" },
    { path: "cellW", label: "Cell width (0 = whole)", kind: "num" },
    { path: "cellH", label: "Cell height", kind: "num" },
    { path: "index", label: "Icon number", kind: "num" },
  ],
  slot: [
    { path: "index", label: "Slot (1-9)", kind: "num" },
    { path: "frame", label: "Frame picture", kind: "pic" },
    { path: "selected", label: "Frame when selected", kind: "pic" },
    { path: "keyLabel", label: "Show its key", kind: "check" },
  ],
  inventory: [
    { path: "cols", label: "Columns", kind: "num" },
    { path: "cell", label: "Cell size", kind: "num" },
    { path: "gap", label: "Gap", kind: "num" },
    { path: "frame", label: "Cell picture", kind: "pic" },
    { path: "cursor", label: "Cursor picture", kind: "pic" },
    { path: "counts", label: "Show ammunition counts", kind: "check" },
  ],
  minimap: [
    { path: "shape", label: "Shape", kind: "choice", options: [["circle", "Circle"], ["rect", "Rectangle"]] },
    { path: "range", label: "Map pixels to the edge", kind: "num" },
    { path: "backColor", label: "Back colour", kind: "color" },
    { path: "border", label: "Border colour", kind: "color" },
    { path: "borderWidth", label: "Border width", kind: "num" },
    { path: "wallColor", label: "Walls", kind: "color" },
    { path: "playerColor", label: "Player", kind: "color" },
    { path: "enemyColor", label: "Enemies", kind: "color" },
    { path: "objectColor", label: "Objects", kind: "color" },
  ],
  button: [
    { path: "text", label: "Text", kind: "text" },
    { path: "font", label: "Font", kind: "font" },
    { path: "size", label: "Size", kind: "num" },
    { path: "textColor", label: "Text colour", kind: "color" },
    { path: "image", label: "Picture", kind: "pic" },
    { path: "hover", label: "Picture when selected", kind: "pic" },
    { path: "slice", label: "Corner size (9-slice, 0 = stretch)", kind: "num" },
    { path: "color", label: "Colour without a picture", kind: "color" },
    { path: "hoverColor", label: "Colour when selected", kind: "color" },
    { path: "action.kind", label: "When pressed", kind: "choice", options: [["none", "Nothing"], ["event", "Run a PS Maker event"], ["open", "Open a screen"], ["close", "Close this screen"], ["variable", "Set a variable"]] },
    { path: "action.id", label: "Event", kind: "event" },
    { path: "action.id", label: "Screen", kind: "screen" },
    { path: "action.id", label: "Variable", kind: "var" },
    { path: "action.value", label: "Value", kind: "text" },
  ],
};

/** Fields that apply only for some choice of the element (the visibility rule, the button's action, rotation). */
function applies(f: FieldDef, e: UiElement): boolean {
  const when = e.show.when;
  if (f.path === "show.id") return (f.kind === "var" && when === "variable") || (f.kind === "item" && when === "item") || (f.kind === "bind" && when === "compare");
  if (f.path === "show.op" || f.path === "show.value") return when === "compare";
  if (f.path === "rotation") return ROTATABLE.includes(e.type);
  if (e.type === "button" && f.path.startsWith("action.") && f.path !== "action.kind") {
    const k = e.action.kind;
    return (f.kind === "event" && k === "event") || (f.kind === "screen" && k === "open") || (f.kind === "var" && k === "variable") || (f.path === "action.value" && k === "variable");
  }
  return true;
}

const CSS = {
  panel: "position:fixed;left:8px;top:64px;width:260px;max-height:calc(100vh - 88px);overflow:auto;z-index:10000;background:#1f1a24;color:#eee;border:1px solid #ffd23a;border-radius:6px;font:12px/1.35 sans-serif;padding:6px;box-shadow:0 4px 16px #0008",
  row: "display:flex;gap:4px;align-items:center;margin:3px 0",
  label: "flex:0 0 104px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
  input: "flex:1;min-width:0;background:#2c2533;color:#eee;border:1px solid #554a5e;border-radius:3px;padding:2px 4px;font:inherit",
  button: "background:#3a3144;color:#eee;border:1px solid #6a5a78;border-radius:3px;padding:2px 6px;font:inherit;cursor:pointer",
  head: "font-weight:bold;margin:8px 0 2px;color:#ffd23a",
  menu: "position:fixed;z-index:10001;min-width:190px;background:#fbeee0;color:#3a2a20;border:2px solid #3a2a20;border-radius:8px;font:13px/1.3 sans-serif;padding:4px 0;box-shadow:0 6px 18px #0008",
};

export class DesignerPanel {
  private readonly doc: any;
  private readonly d: UiDesigner;
  private root: any = null;
  private body: any = null;
  private statusEl: any = null;
  private collapsed = false;
  private readonly syncers: (() => void)[] = [];
  private pos = { left: 8, top: 64 };
  private menuEl: any = null;
  private readonly offMenu: (e: any) => void;

  constructor(doc: any, designer: UiDesigner) {
    this.doc = doc;
    this.d = designer;
    this.offMenu = (e: any) => {
      if (this.menuEl && !this.menuEl.contains(e.target)) this.closeMenu();
    };
  }

  private el(tag: string, style = "", text = ""): any {
    const e = this.doc.createElement(tag);
    if (style) e.style.cssText = style;
    if (text) e.textContent = text;
    return e;
  }

  private button(text: string, onClick: () => void, title = ""): any {
    const b = this.el("button", CSS.button, text);
    b.type = "button";
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  /**
   * Typing in a page part must not reach the editor's shortcuts, and a press must not reach the map:
   * Phaser listens for mouse presses on the whole window and takes one outside its canvas as a press
   * at that point of the map, where the designer's panel or menu may cover an object (a slime, a
   * chest) that would then be picked and opened.
   */
  private guard(node: any): void {
    for (const type of ["keydown", "keyup", "keypress", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend"]) node.addEventListener(type, (e: any) => e.stopPropagation());
  }


  show(): void {
    if (!this.doc?.body) return;
    if (!this.root) {
      this.root = this.el("div", CSS.panel);
      this.root.style.left = `${this.pos.left}px`;
      this.root.style.top = `${this.pos.top}px`;
      this.root.setAttribute("data-zelda-ui-designer", "true");
      this.guard(this.root);
      this.doc.body.appendChild(this.root);
      this.render();
    }
    this.root.style.display = "block";
  }

  hide(): void {
    if (this.root) this.root.style.display = "none";
    this.closeMenu();
  }

  destroy(): void {
    this.closeMenu();
    this.root?.remove?.();
    this.root = null;
  }

  status(text: string): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.style.display = text ? "block" : "none";
  }

  /** Puts the values of the fields not being typed into back in line with the layout. */
  sync(): void {
    for (const s of this.syncers) s();
  }

  // ---- the right-click menu ------------------------------------------------------------------------

  get menuOpen(): boolean {
    return !!this.menuEl;
  }

  menu(x: number, y: number, items: readonly MenuItem[]): void {
    this.closeMenu();
    const m = this.el("div", CSS.menu);
    m.setAttribute("data-zelda-ui-menu", "true");
    this.guard(m);
    m.addEventListener("contextmenu", (e: any) => e.preventDefault());
    for (const it of items) {
      if ("separator" in it) m.append(this.el("div", "height:1px;background:#3a2a2033;margin:4px 8px"));
      else if ("title" in it) m.append(this.el("div", "padding:2px 12px 4px;font-size:11px;font-weight:bold;letter-spacing:1px;color:#a0603a;text-transform:uppercase", it.title));
      else {
        const row = this.el("div", `display:flex;justify-content:space-between;gap:16px;padding:4px 12px;cursor:${it.disabled ? "default" : "pointer"};${it.disabled ? "opacity:.45;" : ""}${it.danger ? "color:#c0302a;" : ""}`);
        row.append(this.el("span", "", it.label));
        if (it.key) row.append(this.el("span", "color:#a08070;font-size:11px", it.key));
        if (!it.disabled) {
          row.addEventListener("mouseenter", () => (row.style.background = "#f0d8c0"));
          row.addEventListener("mouseleave", () => (row.style.background = ""));
          row.addEventListener("click", () => {
            this.closeMenu();
            it.run();
          });
        }
        m.append(row);
      }
    }
    this.doc.body.appendChild(m);
    const view = this.doc.defaultView;
    const w = m.offsetWidth || 200;
    const h = m.offsetHeight || 300;
    m.style.left = `${Math.max(4, Math.min(x, (view?.innerWidth ?? 1e4) - w - 4))}px`;
    m.style.top = `${Math.max(4, Math.min(y, (view?.innerHeight ?? 1e4) - h - 4))}px`;
    this.menuEl = m;
    this.doc.addEventListener("pointerdown", this.offMenu, true);
  }

  closeMenu(): void {
    if (!this.menuEl) return;
    this.menuEl.remove();
    this.menuEl = null;
    this.doc.removeEventListener("pointerdown", this.offMenu, true);
  }

  // ---- the panel -----------------------------------------------------------------------------------

  /** The panel's title moves it (it may cover a part of the editor the author needs). */
  private movable(handle: any): void {
    handle.style.cursor = "move";
    handle.addEventListener("mousedown", (e: any) => {
      const start = { x: e.clientX, y: e.clientY, ...this.pos };
      const view = this.doc.defaultView;
      const move = (m: any) => {
        this.pos = { left: Math.max(0, start.left + m.clientX - start.x), top: Math.max(0, start.top + m.clientY - start.y) };
        this.root.style.left = `${this.pos.left}px`;
        this.root.style.top = `${this.pos.top}px`;
      };
      const up = () => {
        view?.removeEventListener("mousemove", move, true);
        view?.removeEventListener("mouseup", up, true);
      };
      // Capture: the panel stops presses from bubbling to the window (see guard).
      view?.addEventListener("mousemove", move, true);
      view?.addEventListener("mouseup", up, true);
      e.preventDefault();
    });
  }

  render(message = ""): void {
    if (!this.root) return;
    const L = this.d.current;
    this.root.replaceChildren();
    this.syncers.length = 0;
    const top = this.el("div", CSS.row);
    const title = this.el("div", "flex:1;font-weight:bold;color:#ffd23a", "Zelda UI designer");
    this.movable(title);
    top.append(title);
    top.append(this.button(this.collapsed ? "▸" : "▾", () => ((this.collapsed = !this.collapsed), this.render()), "Fold the panel"));
    this.root.append(top);
    this.statusEl = this.el("div", "color:#ff9a7a;margin:2px 0;display:none");
    this.root.append(this.statusEl);
    if (message) this.status(message);
    if (this.collapsed || !L) return;
    const note = this.d.sharingNote;
    if (note.text) this.root.append(this.el("div", `margin:2px 0 4px;${note.warn ? "color:#1f1a24;background:#ffd23a;padding:4px;border-radius:3px" : "color:#9ad"}`, note.text));
    this.body = this.el("div");
    this.root.append(this.body);

    const tools = this.el("div", CSS.row + ";flex-wrap:wrap");
    const undo = this.button("Undo", () => this.d.undo(), "Ctrl+Z");
    const redo = this.button("Redo", () => this.d.redo(), "Ctrl+Y");
    const states = () => {
      undo.disabled = !this.d.canUndo;
      redo.disabled = !this.d.canRedo;
    };
    states();
    this.syncers.push(states);
    tools.append(undo, redo, this.d.isScreen ? this.button("Clear", () => this.d.template(), "Remove every element (Undo brings them back)") : this.button("Classic HUD", () => this.d.template(), "Start again from the classic Zelda HUD (Undo brings this layout back)"));
    this.body.append(tools);

    const adder = this.el("div", CSS.row);
    const type = this.el("select", CSS.input);
    for (const [t, label] of TYPE_ITEMS) type.append(this.option(t, label));
    adder.append(type, this.button("Add", () => this.d.add(type.value as ElementType)));
    this.body.append(adder);

    this.body.append(this.el("div", CSS.head, "Elements"));
    const ids = this.d.selectedIds;
    for (const e of L.elements) {
      const row = this.el("div", CSS.row + `;cursor:pointer;padding:1px 3px;border-radius:3px;${ids.includes(e.id) ? "background:#4a3f58" : ""}`);
      const marks = [e.group ? `⧉${e.group}` : "", e.locked ? "locked" : ""].filter(Boolean).join(" ");
      row.append(this.el("div", "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", `${e.id} · ${TYPE_LABELS[e.type]}`));
      if (marks) row.append(this.el("div", "color:#999;font-size:11px", marks));
      row.title = "Click: select; Shift+click: add to the selection";
      row.addEventListener("click", (ev: any) => this.d.select([e.id], ev.shiftKey || ev.ctrlKey, true));
      this.body.append(row);
    }
    const sel = this.d.selection;
    if (ids.length > 1) this.multi(ids.length);
    else if (sel) this.single(sel);
    else this.body.append(this.el("div", "color:#999;margin:2px 0", "Click an element on the map or in the list. Right-click the map to create one."));

    this.body.append(this.el("div", CSS.head, this.d.isScreen ? "Screen" : "Layout"));
    const cur = () => this.d.current!;
    this.roleField();
    if (!this.d.isScreen && ROLE_HINTS.hud) this.body.append(this.el("div", "color:#999;margin:2px 0", ROLE_HINTS.hud));
    if (this.d.isScreen) {
      const role = L.screen.role;
      const takesKeys = role !== "notification" && (role !== "none" || L.screen.input);
      if (role === "none") this.field({ path: "screen.input", label: "Takes the keys (a menu)", kind: "check" }, () => cur().screen.input);
      if (takesKeys) this.field({ path: "screen.pause", label: "Pause the game", kind: "check" }, () => cur().screen.pause);
      if (role === "message" || role === "dialogue") {
        if (role === "message") this.kinds();
        this.field({ path: "screen.typing", label: "Typing (letters a second, 0 = at once)", kind: "num" }, () => cur().screen.typing);
      }
      if (ROLE_HINTS[role]) this.body.append(this.el("div", "color:#999;margin:2px 0", ROLE_HINTS[role]));
      if (role !== "notification") this.field({ path: "screen.dim", label: "Dim colour", kind: "color" }, () => cur().screen.dim);
      if (takesKeys) {
        this.field({ path: "screen.soundOpen", label: "Sound: opens", kind: "sound" }, () => cur().screen.soundOpen);
        this.field({ path: "screen.soundClose", label: "Sound: closes", kind: "sound" }, () => cur().screen.soundClose);
        this.field({ path: "screen.soundMove", label: "Sound: selection moves", kind: "sound" }, () => cur().screen.soundMove);
        this.field({ path: "screen.soundPress", label: "Sound: button pressed", kind: "sound" }, () => cur().screen.soundPress);
      } else if (role !== "notification") this.body.append(this.el("div", "color:#999", "A layer: the game plays under it; open it with Open UI Screen and close it with Close UI Screen by its name."));
    }
    this.field({ path: "scale", label: "Scale (0 = like the map)", kind: "num" }, () => cur().scale);
    this.field({ path: "theme.font", label: "Font", kind: "font" }, () => cur().theme.font);
    this.field({ path: "theme.textColor", label: "Text colour", kind: "color" }, () => cur().theme.textColor);
    this.field({ path: "theme.panel", label: "Inventory panel", kind: "pic" }, () => cur().theme.panel);
    this.field({ path: "theme.panelSlice", label: "Panel corner size", kind: "num" }, () => cur().theme.panelSlice);
    this.field({ path: "theme.cursor", label: "Inventory cursor", kind: "pic" }, () => cur().theme.cursor);
    const icons = this.el("details");
    icons.append(this.el("summary", "cursor:pointer;color:#ffd23a;margin-top:6px", "Item icons"));
    this.body.append(icons);
    for (const [item, name] of ABILITY_OPTIONS) this.field({ path: `theme.icons.${item}`, label: name, kind: "pic" }, () => cur().theme.icons[item] ?? "", icons);

    this.body.append(this.el("div", CSS.head, "Designer"));
    const grid = this.el("label", CSS.row);
    grid.append(this.el("span", CSS.label, "Grid"));
    const gs = this.el("select", CSS.input);
    for (const [v, t] of [["0", "Off"], ["2", "2 px"], ["4", "4 px"], ["8", "8 px"], ["16", "16 px"]]) gs.append(this.option(v, t));
    gs.value = String(this.d.grid);
    gs.addEventListener("change", () => this.d.setGrid(Number(gs.value)));
    grid.append(gs);
    this.body.append(grid);
    const snap = this.el("label", CSS.row);
    snap.append(this.el("span", CSS.label, "Snap to edges"));
    const sc = this.el("input");
    sc.type = "checkbox";
    sc.checked = this.d.snapping;
    sc.addEventListener("change", () => (this.d.snapping = sc.checked));
    snap.append(sc);
    this.body.append(snap);
    this.body.append(
      this.el(
        "div",
        "color:#999;margin-top:6px",
        "Drag to move (Alt: no snapping), the white squares to resize (Shift: keep proportions), the gold dot to turn. Shift+click or drag a frame to select several. Right-click: create, copy, group, lock, order, align. Arrows move (Shift: 8 px).",
      ),
    );
  }

  private single(sel: UiElement): void {
    const order = this.el("div", CSS.row + ";flex-wrap:wrap");
    order.append(
      this.button("Front", () => this.d.reorder("front"), "Draw on top"),
      this.button("Back", () => this.d.reorder("back"), "Draw under the others"),
      this.button("Copy", () => this.d.copy(), "Ctrl+C"),
      this.button("Paste", () => this.d.paste(), "Ctrl+V"),
      this.button("Delete", () => this.d.remove(), "Delete"),
    );
    this.body.append(order);
    this.body.append(this.el("div", CSS.head, `${TYPE_LABELS[sel.type]} “${sel.id}”`));
    for (const f of [...COMMON, ...BY_TYPE[sel.type]]) {
      if (!applies(f, sel)) continue;
      this.field(f, () => {
        const now = this.d.selection;
        return now ? getField(now, f.path) : undefined;
      });
    }
    if (sel.type === "icon") this.body.append(this.button("Pick the icon…", () => this.picker(sel)));
  }

  private multi(count: number): void {
    this.body.append(this.el("div", CSS.head, `${count} elements`));
    const align: [Align, string][] = [
      ["left", "⇤"],
      ["center", "↔"],
      ["right", "⇥"],
      ["top", "⤒"],
      ["middle", "↕"],
      ["bottom", "⤓"],
      ["spreadX", "⋯"],
      ["spreadY", "⋮"],
    ];
    const names: Record<Align, string> = { left: "Align left", center: "Align centre", right: "Align right", top: "Align top", middle: "Align middle", bottom: "Align bottom", spreadX: "Space evenly across", spreadY: "Space evenly down" };
    const row = this.el("div", CSS.row + ";flex-wrap:wrap");
    for (const [how, sym] of align) row.append(this.button(sym, () => this.d.align(how), names[how]));
    this.body.append(row);
    const ops = this.el("div", CSS.row + ";flex-wrap:wrap");
    ops.append(
      this.button("Group", () => this.d.group(true), "Ctrl+G"),
      this.button("Ungroup", () => this.d.group(false), "Ctrl+Shift+G"),
      this.button("Lock", () => this.d.lock(true)),
      this.button("Unlock", () => this.d.lock(false)),
      this.button("Delete", () => this.d.remove(), "Delete"),
    );
    this.body.append(ops);
  }

  /** The cells of an icon sheet to click on. */
  private picker(sel: Extract<UiElement, { type: "icon" }>): void {
    const img = this.d.image(sel.image);
    if (!img) return this.status("Choose the icon sheet (a picture from Images) first.");
    const cw = sel.cellW || img.w;
    const ch = sel.cellH || img.h;
    const cols = Math.max(1, Math.floor(img.w / cw));
    const rows = Math.max(1, Math.floor(img.h / ch));
    const box = this.el("div", "display:grid;gap:2px;margin:4px 0;max-height:240px;overflow:auto;background:#2c2533;padding:4px;border-radius:4px");
    box.style.gridTemplateColumns = `repeat(${Math.min(cols, 8)}, 26px)`;
    for (let i = 0; i < Math.min(cols * rows, 1024); i++) {
      const c = this.el("canvas", `width:24px;height:24px;cursor:pointer;image-rendering:pixelated;border:1px solid ${i === sel.index ? "#ffd23a" : "transparent"}`);
      c.width = 24;
      c.height = 24;
      c.title = `#${i}`;
      const g = c.getContext?.("2d");
      if (g) {
        g.imageSmoothingEnabled = false;
        const f = Math.min(24 / cw, 24 / ch);
        g.drawImage(img.src, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch, (24 - cw * f) / 2, (24 - ch * f) / 2, cw * f, ch * f);
      }
      c.addEventListener("click", () => {
        this.d.remember();
        this.d.setField("index", i);
        this.render();
      });
      box.append(c);
    }
    this.body.append(box);
  }

  private option(value: string, text: string): any {
    const o = this.el("option", "", text);
    o.value = value;
    return o;
  }

  private choices(f: FieldDef): Opt[] {
    const story = this.d.story;
    switch (f.kind) {
      case "pic":
        return [
          ["", "None / built-in"],
          ...(f.path === "image" ? ([["{portrait}", "Portrait of the speaker (Zelda: Dialogue)"]] as const) : []),
          ...BUILT_IN_PICTURES.map((p) => [p, `Built-in: ${p.replace(/^hud_/, "")}`] as const),
          ...(story?.images ?? []).map((i) => [i.id, i.name || i.id] as const),
        ];
      case "font":
        return [["", "Default"], ...(story?.gameUI?.fonts ?? []).map((x) => [x.id, x.name || x.id] as const)];
      case "bind":
        return [...BINDING_OPTIONS, ...(story?.variables ?? []).map((v) => [`var:${v.id}`, `Variable: ${v.name || v.id}`] as const)];
      case "var":
        return [["", "—"], ...(story?.variables ?? []).map((v) => [v.id, v.name || v.id] as const)];
      case "item":
        return [["", "—"], ...ITEM_OPTIONS];
      case "event":
        return [["", "—"], ...this.d.events.map((e) => [e.id, e.name] as const)];
      case "screen":
        return [["", "—"], ...this.d.screens.map((n) => [n, n] as const)];
      case "sound":
        return [["", "None"], ...this.d.sounds.map((s) => [s.id, s.name] as const)];
      default:
        return [...(f.options ?? [])];
    }
  }

  /** One labelled field bound to a path of the selection or the layout. */
  /** What the layout is: the HUD or a screen with a role (the HUD has no screen name). */
  private roleField(): void {
    const row = this.el("label", CSS.row);
    row.append(this.el("span", CSS.label, "Role"));
    const input = this.el("select", CSS.input);
    for (const [v, t] of ROLE_OPTIONS) input.append(this.option(v, t));
    const now = () => (this.d.isScreen ? (this.d.current?.screen.role ?? "none") : "hud");
    input.value = now();
    input.addEventListener("change", () => {
      this.d.remember();
      this.d.setRole(input.value);
    });
    this.syncers.push(() => {
      if (this.doc.activeElement !== input) input.value = now();
    });
    row.append(input);
    this.body.append(row);
  }

  /** The message box's kinds: a checkbox for each kind of toolkit message. */
  private kinds(): void {
    this.body.append(this.el("div", "color:#ccc;margin:4px 0 0", "Shows these messages (the others stay short notes)"));
    for (const [kind, label] of KIND_LABELS) {
      const row = this.el("label", CSS.row);
      const input = this.el("input");
      input.type = "checkbox";
      const read = () => this.d.current?.screen.kinds.includes(kind) ?? false;
      input.checked = read();
      input.addEventListener("change", () => {
        const now = this.d.current?.screen.kinds ?? [];
        this.d.remember();
        this.d.setField("screen.kinds", input.checked ? [...now, kind] : now.filter((k) => k !== kind));
      });
      this.syncers.push(() => (input.checked = read()));
      row.append(this.el("span", CSS.label, label), input);
      this.body.append(row);
    }
  }

  private field(f: FieldDef, read: () => unknown, parent: any = this.body): void {
    const row = this.el("label", CSS.row);
    row.append(this.el("span", CSS.label, f.label));
    row.title = f.label;
    let input: any;
    const value = () => read();
    const shown = () => (f.kind === "percent" ? String(Math.round(Number(value() ?? 1) * 100)) : String(value() ?? ""));
    if (f.kind === "check") {
      input = this.el("input");
      input.type = "checkbox";
      input.checked = value() === true;
      input.addEventListener("change", () => {
        this.d.remember();
        this.d.setField(f.path, input.checked);
      });
      this.syncers.push(() => (input.checked = value() === true));
    } else if (["choice", "pic", "font", "bind", "var", "item", "event", "screen", "sound"].includes(f.kind)) {
      input = this.el("select", CSS.input);
      const opts = this.choices(f);
      const now = String(value() ?? "");
      if (!opts.some(([v]) => v === now)) opts.push([now, `${now} (not in this project)`]);
      for (const [v, t] of opts) input.append(this.option(v, t));
      input.value = now;
      input.addEventListener("change", () => {
        this.d.remember();
        this.d.setField(f.path, input.value);
      });
      this.syncers.push(() => {
        if (this.doc.activeElement !== input) input.value = String(value() ?? "");
      });
    } else {
      input = this.el("input", CSS.input);
      input.type = f.kind === "num" || f.kind === "percent" ? "number" : "text";
      if (f.kind === "percent") Object.assign(input, { min: 0, max: 100, step: 5 });
      if (f.kind === "color") input.placeholder = "#rrggbb or #rrggbbaa";
      input.value = shown();
      // Undo goes back to before the typing.
      input.addEventListener("focus", () => this.d.remember());
      const numeric = f.kind === "num" || f.kind === "percent";
      const parsed = () => (f.kind === "percent" ? Number(input.value) / 100 : numeric ? Number(input.value) : input.value);
      // A name is taken when typed out (the list and the selection follow it).
      if (f.path !== "id")
        input.addEventListener("input", () => {
          if (numeric && input.value.trim() === "") return;
          this.d.setField(f.path, parsed());
        });
      input.addEventListener("change", () => {
        if (f.path === "id") this.d.setField("id", input.value);
        input.value = shown();
      });
      this.syncers.push(() => {
        if (this.doc.activeElement !== input) input.value = shown();
      });
    }
    row.append(input);
    parent.append(row);
  }
}
