import { LayoutPainter, type Painted } from "../host/layoutPainter.ts";
import { fontFamilyCss, type PsStory } from "../host/psmakerAssets.ts";
import { ensureProjectFont } from "../host/projectFonts.ts";
import { ANCHORS, ELEMENT_TYPES, classicLayout, type ElementType, type UiElement, type UiLayout } from "../ui/uiLayout.ts";
import { ABILITY_OPTIONS, ITEM_OPTIONS } from "./fields.ts";
import {
  BINDING_OPTIONS,
  BUILT_IN_PICTURES,
  History,
  LAYOUT_FIELD_LABEL,
  UI_LAYOUT_ACTION,
  boardScale,
  cloneLayout,
  getField,
  newElement,
  sampleValues,
  savedText,
  withField,
  writeFormText,
  type DesignerSetup,
} from "./layoutEdit.ts";

/**
 * The UI designer on the map in the PS Maker editor. A "game window" frame (the screen at the
 * map's zoom, around the player's start) shows the HUD as the game draws it (the same painter).
 * While the map's "Zelda: UI Layout" action is open, its elements can be selected, dragged and
 * resized on the map and edited in a panel at the left edge of the page; every change is written
 * into the action's "Layout data" field the way typing does, so PS Maker saves it with the map.
 */

const DEPTH = 1_000_100;
const SAVE_DELAY_MS = 250;
/** A map update that does not match what the designer wrote this long after its write is someone else's. */
const ECHO_MS = 2000;

type Ref = { id: string; root: string };
interface Drag {
  id: string;
  mode: "move" | "size";
  zx: number;
  zy: number;
  e: UiElement;
}

export interface DesignerHost {
  story(): PsStory | null;
  /** Opens the action's settings (the editor's own route). */
  openAction(ref: Ref): void;
}

export class UiDesigner {
  readonly scene: any;
  private readonly win: any;
  private readonly host: DesignerHost;
  private readonly painter: LayoutPainter;
  private readonly frameG: any;
  private readonly marks: any;
  private readonly label: any;
  private readonly zones: any[] = [];
  private handle: any = null;
  private setup: DesignerSetup | null = null;
  /** The layout being edited (while the action is open), else null. */
  private layout: UiLayout | null = null;
  private ref = "";
  private selected = "";
  private readonly history = new History();
  private seenRaw = "";
  private lastWritten = "";
  private writtenAt = 0;
  private saveTimer: any = null;
  private drag: Drag | null = null;
  private sig = "";
  private painted: Painted | null = null;
  private readonly panel: DesignerPanel;
  private readonly onKey: (e: any) => void;
  private readonly onFonts: () => void;

  constructor(scene: any, win: any, host: DesignerHost) {
    this.scene = scene;
    this.win = win;
    this.host = host;
    this.painter = new LayoutPainter(scene, DEPTH, 4);
    this.frameG = scene.add.graphics().setDepth(DEPTH - 1);
    this.marks = scene.add.graphics().setDepth(DEPTH + 1);
    this.label = scene.add.text(0, 0, "", { fontFamily: "sans-serif", fontSize: "8px", color: "#ffffff", backgroundColor: "#1f1a24cc" }).setOrigin(0, 1).setDepth(DEPTH + 1);
    this.label.setResolution?.(4);
    this.panel = new DesignerPanel(win.document, this);
    this.onKey = (e) => this.key(e);
    win.addEventListener?.("keydown", this.onKey, true);
    this.onFonts = () => {
      this.sig = "";
      this.paint();
    };
    win.document?.fonts?.addEventListener?.("loadingdone", this.onFonts);
  }

  /** Called a few times a second with the map's setup and whether the action's settings are open. */
  update(setup: DesignerSetup | null, editing: boolean): void {
    if (this.drag) return;
    this.setup = setup;
    if (setup && editing && setup.action) {
      this.panel.show();
      if (!this.layout || this.ref !== setup.action.id) {
        this.load(setup);
      } else if (setup.raw !== this.seenRaw) {
        // The map's data changed: our own write coming back, or a change from elsewhere (the editor's undo).
        this.seenRaw = setup.raw;
        if (setup.raw !== this.lastWritten && Date.now() - this.writtenAt > ECHO_MS) this.load(setup);
      }
    } else {
      this.flush();
      this.layout = null;
      this.ref = "";
      this.panel.hide();
    }
    this.paint();
  }

  private load(setup: DesignerSetup): void {
    this.layout = cloneLayout(setup.layout);
    this.ref = setup.action!.id;
    this.seenRaw = setup.raw;
    this.lastWritten = setup.raw;
    if (!this.layout.elements.some((e) => e.id === this.selected)) this.selected = "";
    this.panel.render(setup.error ? `Saved layout not read: ${setup.error}. Editing the classic HUD; a change replaces it.` : "");
  }

  // ---- state the panel reads and changes ---------------------------------------------------------

  get current(): UiLayout | null {
    return this.layout;
  }

  get selection(): UiElement | null {
    return this.layout?.elements.find((e) => e.id === this.selected) ?? null;
  }

  get story(): PsStory | null {
    return this.host.story();
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  select(id: string): void {
    if (this.selected === id) return;
    this.selected = id;
    this.sig = "";
    this.paint();
    this.panel.render();
  }

  /** Remembers the layout before a change (undo). */
  remember(): void {
    if (this.layout) this.history.push(this.layout);
  }

  /** Puts a changed layout in place: drawn at once, written into the action shortly after. */
  change(next: UiLayout, opts: { record?: boolean; rebuild?: boolean } = {}): void {
    if (!this.layout) return;
    if (opts.record) this.history.push(this.layout);
    this.layout = next;
    if (!next.elements.some((e) => e.id === this.selected)) this.selected = "";
    this.sig = "";
    this.paint();
    if (opts.rebuild) this.panel.render();
    else this.panel.sync();
    this.scheduleSave();
  }

  /** Changes a field of the selected element (or "theme.x" / "scale" of the layout). */
  setField(path: string, value: unknown): void {
    const L = this.layout;
    if (!L) return;
    const next = cloneLayout(L);
    if (path === "scale") next.scale = Math.max(0, Math.round(Number(value) || 0));
    else if (path.startsWith("theme.icons.")) {
      const item = path.slice("theme.icons.".length);
      if (value) next.theme.icons[item] = String(value);
      else delete next.theme.icons[item];
    } else if (path.startsWith("theme.")) (next.theme as any)[path.slice(6)] = path === "theme.panelSlice" ? Math.max(0, Math.round(Number(value) || 0)) : String(value);
    else {
      const i = next.elements.findIndex((e) => e.id === this.selected);
      if (i < 0) return;
      if (path === "id") {
        const id = String(value).trim();
        if (!id || next.elements.some((e, j) => j !== i && e.id === id)) return;
        this.selected = id;
      }
      next.elements[i] = withField(next.elements[i], path, value);
    }
    this.change(next, { rebuild: path === "id" || path === "show.when" });
  }

  add(type: ElementType): void {
    const L = this.layout;
    const st = this.setup;
    if (!L || !st) return;
    const k = boardScale(st, L);
    const viewW = Math.floor(st.frame.w / k);
    const viewH = Math.floor(st.frame.h / k);
    const next = cloneLayout(L);
    const e = newElement(next, type, viewW / 2 - 16, viewH / 2 - 8);
    next.elements.push(e);
    this.selected = e.id;
    this.change(next, { record: true, rebuild: true });
  }

  remove(): void {
    const L = this.layout;
    if (!L || !this.selected) return;
    const next = cloneLayout(L);
    next.elements = next.elements.filter((e) => e.id !== this.selected);
    this.change(next, { record: true, rebuild: true });
  }

  /** Moves the selected element up or down the drawing order (later = on top). */
  reorder(by: -1 | 1): void {
    const L = this.layout;
    if (!L) return;
    const i = L.elements.findIndex((e) => e.id === this.selected);
    const j = i + by;
    if (i < 0 || j < 0 || j >= L.elements.length) return;
    const next = cloneLayout(L);
    [next.elements[i], next.elements[j]] = [next.elements[j], next.elements[i]];
    this.change(next, { record: true, rebuild: true });
  }

  undo(): void {
    if (!this.layout) return;
    const prev = this.history.undo(this.layout);
    if (prev) this.change(prev, { rebuild: true });
  }

  redo(): void {
    if (!this.layout) return;
    const next = this.history.redo(this.layout);
    if (next) this.change(next, { rebuild: true });
  }

  /** Starts again from the classic Zelda HUD (undo brings the old layout back). */
  template(): void {
    if (!this.layout || !this.setup) return;
    const sp = this.setup.start;
    this.change(classicLayout({ magic: sp.magicBar !== false, bottom: sp.hudBottom === true }), { record: true, rebuild: true });
  }

  // ---- saving ------------------------------------------------------------------------------------

  private scheduleSave(): void {
    if (this.saveTimer) this.win.clearTimeout(this.saveTimer);
    this.saveTimer = this.win.setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  /** Writes a pending change into the action's field now. */
  private flush(): void {
    if (!this.saveTimer) return;
    this.win.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.layout) return;
    const { text, error } = savedText(this.layout);
    if (error) return this.panel.status(`Not saved: ${error}.`);
    if (text === this.lastWritten) return;
    if (!writeFormText(this.win.document, UI_LAYOUT_ACTION, LAYOUT_FIELD_LABEL, text)) return this.panel.status(`Not saved: the "${LAYOUT_FIELD_LABEL}" field of ${UI_LAYOUT_ACTION} was not found.`);
    this.lastWritten = text;
    this.writtenAt = Date.now();
    this.panel.status("");
  }

  // ---- the board ---------------------------------------------------------------------------------

  private fonts(layout: UiLayout): Record<string, string> {
    const story = this.host.story();
    const out: Record<string, string> = {};
    for (const id of new Set([layout.theme.font, ...layout.elements.map((e) => (e.type === "text" ? e.font : ""))])) {
      if (!id) continue;
      out[id] = fontFamilyCss(story, id);
      void ensureProjectFont(story as any, this.scene.textures, id);
    }
    return out;
  }

  private paint(): void {
    const st = this.setup;
    const layout = this.layout ?? st?.layout ?? null;
    const sig = st && layout ? JSON.stringify([layout, st.frame, st.zoom, st.values, this.selected, !!this.layout, !!st.action]) : "";
    if (sig === this.sig) return;
    this.sig = sig;
    this.painter.begin();
    this.frameG.clear();
    this.marks.clear();
    if (!st || !layout) {
      this.painter.end();
      this.label.setVisible(false);
      this.placeZones(null, null, 0);
      return;
    }
    const f = st.frame;
    const k = boardScale(st, layout);
    const values = this.layout ? sampleValues(layout, st.start) : st.values;
    this.painted = this.painter.paint(layout, values, this.fonts(layout), { x: f.x, y: f.y, w: f.w, h: f.h, k });
    this.painter.end();
    // The frame: the screen at the start of the game (dashed, like a camera view).
    const g = this.frameG;
    g.lineStyle(1, 0xffd23a, 0.9);
    const dash = (x1: number, y1: number, x2: number, y2: number) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      for (let d = 0; d < len; d += 6) {
        const a = d / len;
        const b = Math.min(1, (d + 3) / len);
        g.lineBetween(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, x1 + (x2 - x1) * b, y1 + (y2 - y1) * b);
      }
    };
    dash(f.x, f.y, f.x + f.w, f.y);
    dash(f.x + f.w, f.y, f.x + f.w, f.y + f.h);
    dash(f.x + f.w, f.y + f.h, f.x, f.y + f.h);
    dash(f.x, f.y + f.h, f.x, f.y);
    const text = this.layout
      ? "Game window · UI Layout: drag to move, the corner to resize; the panel on the left edits"
      : st.action
        ? "Game window · UI Layout (click the HUD to edit it)"
        : "Game window · classic Zelda HUD (add Zelda: UI Layout after Start Toolkit to design your own)";
    this.label.setText(text).setPosition(f.x, f.y - 1).setVisible(true);
    if (this.layout) {
      for (const [id, b] of Object.entries(this.painted.boxes)) {
        const sel = id === this.selected;
        this.marks.lineStyle(sel ? 1 : 0.5, sel ? 0xffffff : 0x5ad8ff, sel ? 1 : 0.6).strokeRect(f.x + b.x * k, f.y + b.y * k, b.w * k, b.h * k);
      }
    }
    this.placeZones(st, this.painted, k);
  }

  /** Invisible zones over the elements: select and drag (while editing) or open the action. */
  private placeZones(st: DesignerSetup | null, painted: Painted | null, k: number): void {
    const add = this.scene.add;
    if (typeof add.zone !== "function") return;
    const boxes = st && painted && (this.layout || st.action) ? Object.entries(painted.boxes) : [];
    while (this.zones.length < boxes.length) {
      const z = add.zone(0, 0, 1, 1).setOrigin(0, 0);
      z.on?.("pointerdown", () => this.press(z.zmtId));
      z.on?.("dragstart", () => this.dragStart(z.zmtId, "move", z));
      z.on?.("drag", (_p: unknown, x: number, y: number) => this.dragTo(x, y));
      z.on?.("dragend", () => this.dragEnd());
      this.zones.push(z);
    }
    this.zones.forEach((z, i) => {
      const entry = boxes[i];
      if (!entry || !st) {
        z.setVisible(false).disableInteractive?.();
        return;
      }
      const [id, b] = entry;
      z.zmtId = id;
      const x = st.frame.x + b.x * k;
      const y = st.frame.y + b.y * k;
      // Later elements are drawn on top, so they take the click.
      z.setPosition(x, y).setSize(b.w * k, b.h * k).setDepth(DEPTH + 2 + i / 1000).setVisible(true);
      z.input?.hitArea?.setSize?.(b.w * k, b.h * k);
      z.setInteractive?.({ draggable: !!this.layout, useHandCursor: true });
      // setInteractive keeps the first draggable flag of an object that had input before.
      this.scene.input?.setDraggable?.(z, !!this.layout);
    });
    // The resize corner of the selected element.
    const sel = this.layout && st && painted ? painted.boxes[this.selected] : null;
    const resizable = sel && ["image", "text", "bar", "item"].includes(this.selection?.type ?? "");
    if (!this.handle && resizable) {
      this.handle = add.zone(0, 0, 1, 1).setOrigin(0, 0).setDepth(DEPTH + 3);
      this.handle.on?.("dragstart", () => this.dragStart(this.selected, "size", this.handle));
      this.handle.on?.("drag", (_p: unknown, x: number, y: number) => this.dragTo(x, y));
      this.handle.on?.("dragend", () => this.dragEnd());
    }
    if (!this.handle) return;
    if (!resizable || !sel || !st) {
      this.handle.setVisible(false).disableInteractive?.();
      return;
    }
    const size = Math.max(3, 8 / (this.scene.cameras?.main?.zoom || 1));
    const hx = st.frame.x + (sel.x + sel.w) * k - size / 2;
    const hy = st.frame.y + (sel.y + sel.h) * k - size / 2;
    this.marks.fillStyle(0xffffff, 1).fillRect(hx, hy, size, size);
    this.handle.setPosition(hx, hy).setSize(size, size).setVisible(true);
    this.handle.input?.hitArea?.setSize?.(size, size);
    this.handle.setInteractive?.({ draggable: true, useHandCursor: true });
  }

  private press(id: string): void {
    if (!this.layout) {
      if (this.setup?.action) this.host.openAction(this.setup.action);
      return;
    }
    if (id) this.select(id);
  }

  private dragStart(id: string, mode: Drag["mode"], zone: any): void {
    const e = this.layout?.elements.find((x) => x.id === id);
    if (!e) return;
    this.select(id);
    this.drag = { id, mode, zx: zone.x, zy: zone.y, e: { ...e } };
  }

  private dragTo(x: number, y: number): void {
    const d = this.drag;
    const st = this.setup;
    if (!d || !st || !this.layout) return;
    const k = boardScale(st, this.layout);
    const dx = Math.round((x - d.zx) / k);
    const dy = Math.round((y - d.zy) / k);
    const next = cloneLayout(this.layout);
    const i = next.elements.findIndex((e) => e.id === d.id);
    if (i < 0) return;
    next.elements[i] = d.mode === "move" ? { ...next.elements[i], x: d.e.x + dx, y: d.e.y + dy } : { ...next.elements[i], w: Math.max(1, d.e.w + dx), h: Math.max(1, d.e.h + dy) };
    this.layout = next;
    this.sig = "";
    this.paint();
    this.panel.sync();
  }

  private dragEnd(): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.layout) return;
    const now = this.layout.elements.find((e) => e.id === d.id);
    if (!now || (now.x === d.e.x && now.y === d.e.y && now.w === d.e.w && now.h === d.e.h)) return;
    // Undo goes back to before the drag.
    const before = cloneLayout(this.layout);
    before.elements = before.elements.map((e) => (e.id === d.id ? d.e : e));
    this.history.push(before);
    this.panel.sync();
    this.scheduleSave();
  }

  /** Arrows move the selected element (Shift: 8 pixels), Delete removes it, Ctrl+Z / Ctrl+Y undo and redo. */
  private key(e: any): void {
    if (!this.layout) return;
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ""));
    if (typing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const step = e.shiftKey ? 8 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    let handled = true;
    if (ctrl && (e.key === "z" || e.key === "Z")) e.shiftKey ? this.redo() : this.undo();
    else if (ctrl && (e.key === "y" || e.key === "Y")) this.redo();
    else if (this.selected && moves[e.key]) {
      const [dx, dy] = moves[e.key];
      const sel = this.selection!;
      const next = cloneLayout(this.layout);
      next.elements = next.elements.map((x) => (x.id === sel.id ? { ...x, x: x.x + dx, y: x.y + dy } : x));
      this.change(next, { record: true });
    } else if (this.selected && (e.key === "Delete" || e.key === "Backspace")) this.remove();
    else if (this.selected && e.key === "Escape") this.select("");
    else handled = false;
    if (handled) {
      e.preventDefault?.();
      e.stopPropagation?.();
    }
  }

  destroy(): void {
    this.flush();
    this.win.removeEventListener?.("keydown", this.onKey, true);
    this.win.document?.fonts?.removeEventListener?.("loadingdone", this.onFonts);
    this.panel.destroy();
    this.painter.destroy();
    this.frameG.destroy?.();
    this.marks.destroy?.();
    this.label.destroy?.();
    for (const z of this.zones) z.destroy?.();
    this.zones.length = 0;
    this.handle?.destroy?.();
  }
}

// ---- the panel -----------------------------------------------------------------------------------

type Opt = readonly [string, string];
type FieldKind = "num" | "text" | "color" | "pic" | "font" | "bind" | "choice" | "check" | "var" | "item";
interface FieldDef {
  path: string;
  label: string;
  kind: FieldKind;
  options?: readonly Opt[];
}

const ANCHOR_LABELS: Record<string, string> = { tl: "Top left", t: "Top", tr: "Top right", l: "Left", c: "Centre", r: "Right", bl: "Bottom left", b: "Bottom", br: "Bottom right" };
const TYPE_LABELS: Record<ElementType, string> = { image: "Picture", text: "Text", bar: "Bar", hearts: "Hearts", counter: "Counter", item: "Item box" };

const COMMON: FieldDef[] = [
  { path: "id", label: "Name", kind: "text" },
  { path: "anchor", label: "Anchor", kind: "choice", options: ANCHORS.map((a) => [a, ANCHOR_LABELS[a]] as const) },
  { path: "x", label: "X", kind: "num" },
  { path: "y", label: "Y", kind: "num" },
  { path: "w", label: "Width", kind: "num" },
  { path: "h", label: "Height", kind: "num" },
  { path: "show.when", label: "Shown", kind: "choice", options: [["always", "Always"], ["variable", "While a variable is on"], ["item", "While the player has an item"]] },
  { path: "show.id", label: "Variable", kind: "var" },
  { path: "show.id", label: "Item", kind: "item" },
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
  ],
  bar: [
    { path: "value", label: "Value", kind: "bind" },
    { path: "max", label: "Maximum", kind: "bind" },
    { path: "fill", label: "Fill picture", kind: "pic" },
    { path: "back", label: "Back picture", kind: "pic" },
    { path: "dir", label: "Fills towards", kind: "choice", options: [["right", "Right"], ["left", "Left"], ["up", "Up"], ["down", "Down"]] },
    { path: "fillColor", label: "Fill colour", kind: "color" },
    { path: "backColor", label: "Back colour", kind: "color" },
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
};

const CSS = {
  panel: "position:fixed;left:8px;top:64px;width:250px;max-height:calc(100vh - 88px);overflow:auto;z-index:10000;background:#1f1a24;color:#eee;border:1px solid #ffd23a;border-radius:6px;font:12px/1.35 sans-serif;padding:6px;box-shadow:0 4px 16px #0008",
  row: "display:flex;gap:4px;align-items:center;margin:3px 0",
  label: "flex:0 0 96px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
  input: "flex:1;min-width:0;background:#2c2533;color:#eee;border:1px solid #554a5e;border-radius:3px;padding:2px 4px;font:inherit",
  button: "background:#3a3144;color:#eee;border:1px solid #6a5a78;border-radius:3px;padding:2px 6px;font:inherit;cursor:pointer",
  head: "font-weight:bold;margin:8px 0 2px;color:#ffd23a",
};

/** The designer's DOM panel: elements, the selected element's fields, the layout's settings. */
class DesignerPanel {
  private readonly doc: any;
  private readonly d: UiDesigner;
  private root: any = null;
  private body: any = null;
  private statusEl: any = null;
  private collapsed = false;
  private readonly syncers: (() => void)[] = [];
  private pos = { left: 8, top: 64 };

  constructor(doc: any, designer: UiDesigner) {
    this.doc = doc;
    this.d = designer;
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

  show(): void {
    if (!this.doc?.body) return;
    if (!this.root) {
      this.root = this.el("div", CSS.panel);
      this.root.style.left = `${this.pos.left}px`;
      this.root.style.top = `${this.pos.top}px`;
      this.root.setAttribute("data-zelda-ui-designer", "true");
      // Typing here must not reach the editor's shortcuts.
      for (const type of ["keydown", "keyup", "keypress"]) this.root.addEventListener(type, (e: any) => e.stopPropagation());
      this.doc.body.appendChild(this.root);
      this.render();
    }
    this.root.style.display = "block";
  }

  hide(): void {
    if (this.root) this.root.style.display = "none";
  }

  destroy(): void {
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
        view?.removeEventListener("mousemove", move);
        view?.removeEventListener("mouseup", up);
      };
      view?.addEventListener("mousemove", move);
      view?.addEventListener("mouseup", up);
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
    tools.append(undo, redo, this.button("Classic HUD", () => this.d.template(), "Start again from the classic Zelda HUD (Undo brings this layout back)"));
    this.body.append(tools);

    const adder = this.el("div", CSS.row);
    const type = this.el("select", CSS.input);
    for (const t of ELEMENT_TYPES) type.append(this.option(t, TYPE_LABELS[t]));
    adder.append(type, this.button("Add", () => this.d.add(type.value as ElementType)));
    this.body.append(adder);

    this.body.append(this.el("div", CSS.head, "Elements"));
    const sel = this.d.selection;
    for (const e of L.elements) {
      const row = this.el("div", CSS.row + `;cursor:pointer;padding:1px 3px;border-radius:3px;${e.id === sel?.id ? "background:#4a3f58" : ""}`);
      row.append(this.el("div", "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", `${e.id} · ${TYPE_LABELS[e.type]}`));
      row.addEventListener("click", () => this.d.select(e.id));
      this.body.append(row);
    }
    if (sel) {
      const order = this.el("div", CSS.row);
      order.append(this.button("Up", () => this.d.reorder(-1), "Draw earlier (under)"), this.button("Down", () => this.d.reorder(1), "Draw later (on top)"), this.button("Delete", () => this.d.remove(), "Delete"));
      this.body.append(order);
      this.body.append(this.el("div", CSS.head, `${TYPE_LABELS[sel.type]} “${sel.id}”`));
      for (const f of [...COMMON, ...BY_TYPE[sel.type]]) {
        const when = sel.show.when;
        if ((f.kind === "var" && when !== "variable") || (f.kind === "item" && when !== "item")) continue;
        this.field(f, () => {
          const now = this.d.selection;
          return now ? getField(now, f.path) : undefined;
        });
      }
    } else this.body.append(this.el("div", "color:#999;margin:2px 0", "Click an element on the map or in the list."));

    this.body.append(this.el("div", CSS.head, "Layout"));
    this.field({ path: "scale", label: "Scale (0 = like the map)", kind: "num" }, () => this.d.current?.scale);
    this.field({ path: "theme.font", label: "Font", kind: "font" }, () => this.d.current?.theme.font);
    this.field({ path: "theme.textColor", label: "Text colour", kind: "color" }, () => this.d.current?.theme.textColor);
    this.field({ path: "theme.panel", label: "Inventory panel", kind: "pic" }, () => this.d.current?.theme.panel);
    this.field({ path: "theme.panelSlice", label: "Panel corner size", kind: "num" }, () => this.d.current?.theme.panelSlice);
    this.field({ path: "theme.cursor", label: "Inventory cursor", kind: "pic" }, () => this.d.current?.theme.cursor);
    const icons = this.el("details");
    icons.append(this.el("summary", "cursor:pointer;color:#ffd23a;margin-top:6px", "Item icons"));
    this.body.append(icons);
    for (const [item, name] of ABILITY_OPTIONS) this.field({ path: `theme.icons.${item}`, label: name, kind: "pic" }, () => this.d.current?.theme.icons[item] ?? "", icons);
    this.body.append(this.el("div", "color:#999;margin-top:6px", "Arrows move the selected element (Shift: 8 px), Delete removes it. Changes are written into the action's Layout data."));
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
        return [["", "None / built-in"], ...BUILT_IN_PICTURES.map((p) => [p, `Built-in: ${p.replace(/^hud_/, "")}`] as const), ...(story?.images ?? []).map((i) => [i.id, i.name || i.id] as const)];
      case "font":
        return [["", "Default"], ...(story?.gameUI?.fonts ?? []).map((x) => [x.id, x.name || x.id] as const)];
      case "bind":
        return [...BINDING_OPTIONS, ...(story?.variables ?? []).map((v) => [`var:${v.id}`, `Variable: ${v.name || v.id}`] as const)];
      case "var":
        return [["", "—"], ...(story?.variables ?? []).map((v) => [v.id, v.name || v.id] as const)];
      case "item":
        return [["", "—"], ...ITEM_OPTIONS];
      default:
        return [...(f.options ?? [])];
    }
  }

  /** One labelled field bound to a path of the selection or the layout. */
  private field(f: FieldDef, read: () => unknown, parent: any = this.body): void {
    const row = this.el("label", CSS.row);
    row.append(this.el("span", CSS.label, f.label));
    row.title = f.label;
    let input: any;
    const value = () => read();
    if (f.kind === "check") {
      input = this.el("input");
      input.type = "checkbox";
      input.checked = value() === true;
      input.addEventListener("change", () => {
        this.d.remember();
        this.d.setField(f.path, input.checked);
      });
      this.syncers.push(() => (input.checked = value() === true));
    } else if (["choice", "pic", "font", "bind", "var", "item"].includes(f.kind)) {
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
      input.type = f.kind === "num" ? "number" : "text";
      if (f.kind === "color") input.placeholder = "#rrggbb or #rrggbbaa";
      input.value = String(value() ?? "");
      // Undo goes back to before the typing.
      input.addEventListener("focus", () => this.d.remember());
      // A name is taken when typed out (the list and the selection follow it).
      if (f.path !== "id")
        input.addEventListener("input", () => {
          if (f.kind === "num" && input.value.trim() === "") return;
          this.d.setField(f.path, f.kind === "num" ? Number(input.value) : input.value);
        });
      input.addEventListener("change", () => {
        if (f.path === "id") this.d.setField("id", input.value);
        input.value = String(value() ?? "");
      });
      this.syncers.push(() => {
        if (this.doc.activeElement !== input) input.value = String(value() ?? "");
      });
    }
    row.append(input);
    parent.append(row);
  }
}
