import { LayoutPainter, type Painted } from "../host/layoutPainter.ts";
import { fontFamilyCss, type PsStory } from "../host/psmakerAssets.ts";
import { ensureProjectFont } from "../host/projectFonts.ts";
import { anchorPoint, classicLayout, MESSAGE_KINDS, offsetFrom, type Box, type ElementType, type UiElement, type UiLayout } from "../ui/uiLayout.ts";
import { DesignerPanel, TYPE_ITEMS, type MenuItem } from "./designerPanel.ts";
import { projectUi } from "./projectUi.ts";
import {
  History,
  LAYOUT_FIELD_LABEL,
  SCREEN_FIELD_LABEL,
  UI_LAYOUT_ACTION,
  alignElements,
  boardScale,
  boundsOf,
  cloneLayout,
  groupElements,
  moveElements,
  newElement,
  pasteElements,
  reorderElements,
  resizeBox,
  sampleValues,
  savedText,
  snapMove,
  withField,
  withGroup,
  writeFormText,
  type Align,
  type DesignerSetup,
  type Guide,
  type Handle,
} from "./layoutEdit.ts";

/**
 * The UI designer on the map in the PS Maker editor. A "game window" frame (the screen at the
 * map's zoom, around the player's start) shows the HUD as the game draws it (the same painter).
 * While a "Zelda: UI Layout" action is open, its elements are edited with the mouse, like in a
 * drawing program, and in a panel at the left edge of the page; every change is written into the
 * action's "Layout data" field the way typing does, so PS Maker saves it with the map.
 *
 * The mouse is taken by a page element over the frame, not by the map scene: the editor sends a
 * press on the map canvas to its active map tool first, but leaves alone presses on elements marked
 * `data-map-primary-interaction` (its own controls over the map), while the wheel and the middle
 * button on `data-map-world-interaction` still zoom and pan the map (PS Maker 1.2.1,
 * setupWorkspaceInput). So designing never paints or selects on the map underneath.
 */

const DEPTH = 1_000_100;
/** How the frame label names a screen's role. */
const ROLE_NAMES: Record<string, string> = {
  none: "",
  menu: " (pause menu, over the HUD)",
  message: " (message box, over the HUD)",
  dialogue: " (dialogue box, over the HUD)",
  notification: " (a notification, over the HUD)",
  inventory: " (inventory, over the HUD)",
  title: " (title screen, no HUD)",
};
/** The screen name a HUD gets when it is given a role in the designer. */
const ROLE_SCREEN_NAMES: Record<string, string> = { none: "screen", menu: "pause", message: "message", dialogue: "dialogue", notification: "notification", inventory: "inventory", title: "title" };
const SAVE_DELAY_MS = 250;
/** A map update that does not match what the designer wrote this long after its write is someone else's. */
const ECHO_MS = 2000;
/** Snapping reach and handle size, in screen pixels. */
const SNAP_PX = 6;
const HANDLE_PX = 8;
const ROTATABLE: readonly ElementType[] = ["image", "text", "icon"];
const FIXED_SIZE: readonly ElementType[] = ["hearts", "counter"];
const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Ref = { id: string; root: string };
type Drag =
  | { kind: "move"; sx: number; sy: number; before: UiLayout; ids: string[]; moved: boolean; clicked: string }
  | { kind: "resize"; sx: number; sy: number; before: UiLayout; id: string; box: Box; handle: Handle }
  | { kind: "rotate"; before: UiLayout; id: string; cx: number; cy: number }
  | { kind: "marquee"; sx: number; sy: number; x: number; y: number; keep: string[] };

export interface DesignerHost {
  story(): PsStory | null;
  /** Opens the action's settings (the editor's own route). */
  openAction(ref: Ref): void;
}

/** Copied elements, shared by every designer of the page (copy on one map, paste on another). */
let clipboard: UiElement[] = [];

export class UiDesigner {
  readonly scene: any;
  private readonly win: any;
  private readonly host: DesignerHost;
  private readonly painter: LayoutPainter;
  private readonly underPainter: LayoutPainter;
  private readonly frameG: any;
  private readonly label: any;
  private setup: DesignerSetup | null = null;
  /** The layout being edited (while the action is open), else null. */
  private layout: UiLayout | null = null;
  private ref = "";
  private sel: string[] = [];
  private readonly history = new History();
  private seenRaw = "";
  private lastWritten = "";
  private writtenAt = 0;
  private saveTimer: any = null;
  private drag: Drag | null = null;
  private guides: Guide[] = [];
  private sig = "";
  private painted: Painted | null = null;
  private readonly panel: DesignerPanel;
  private readonly onKey: (e: any) => void;
  private readonly onFonts: () => void;
  /** Designer preferences: grid step (0 = off) and snapping to edges and centres. */
  grid = 0;
  snapping = true;
  // The page element over the frame and the screen geometry of the last frame.
  private overlay: any = null;
  private readonly divs: any[] = [];
  private raf = 0;
  private view = { ox: 0, oy: 0, s: 1, left: 0, top: 0 };

  constructor(scene: any, win: any, host: DesignerHost) {
    this.scene = scene;
    this.win = win;
    this.host = host;
    this.painter = new LayoutPainter(scene, DEPTH, 4);
    // The HUD the game shows under a screen (not the title screen), below the screen's dim colour.
    this.underPainter = new LayoutPainter(scene, DEPTH - 3, 4);
    this.frameG = scene.add.graphics().setDepth(DEPTH - 1);
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
    const loop = () => {
      this.place();
      this.raf = win.requestAnimationFrame?.(loop) ?? 0;
    };
    this.raf = win.requestAnimationFrame?.(loop) ?? 0;
  }

  /** Called a few times a second with the map's setup and whether the action's settings are open. */
  update(setup: DesignerSetup | null, editing: boolean): void {
    if (this.drag) return;
    // "This map only" ticked or another shared HUD added: the panel's note changes.
    const resharing = setup?.sharing !== this.setup?.sharing || setup?.screen !== this.setup?.screen;
    this.setup = setup;
    if (resharing && this.layout) this.panel.render();
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
    this.sel = this.sel.filter((id) => this.layout!.elements.some((e) => e.id === id));
    this.panel.render(setup.error ? `Saved layout not read: ${setup.error}. Editing the classic HUD; a change replaces it.` : "");
  }

  // ---- state the panel reads and changes ---------------------------------------------------------

  get current(): UiLayout | null {
    return this.layout;
  }

  get selectedIds(): readonly string[] {
    return this.sel;
  }

  /** The selected element when exactly one is selected. */
  get selection(): UiElement | null {
    return this.sel.length === 1 ? (this.layout?.elements.find((e) => e.id === this.sel[0]) ?? null) : null;
  }

  get story(): PsStory | null {
    return this.host.story();
  }

  /** The edited layout is a screen (not the HUD). */
  get isScreen(): boolean {
    return !!this.setup?.screen;
  }

  /** Who sees the edited layout (shown at the top of the panel). */
  get sharingNote(): { text: string; warn: boolean } {
    const st = this.setup;
    if (!st) return { text: "", warn: false };
    if (st.screen) return { text: "A screen: it opens on any map of the project.", warn: false };
    if (st.sharing === "thisMap") return { text: "The HUD of this map only (This map only is ticked).", warn: false };
    if (st.sharing === "conflict")
      return { text: `Not shown in the game: the project's shared HUD is the one on map "${st.sharedMap}". Edit that one, delete this action, or tick "This map only" in its settings to keep it for this map.`, warn: true };
    return { text: "The HUD of every map that has no HUD of its own.", warn: false };
  }

  /** Events a button can run: the project's and this map's. */
  get events(): { id: string; name: string }[] {
    const global = ((this.host.story() as { globalStoryEvents?: { id?: string; name?: string; hidden?: boolean }[] } | null)?.globalStoryEvents ?? []).filter((e) => e?.id && !e.hidden).map((e) => ({ id: e.id!, name: e.name || e.id! }));
    return [...global, ...(this.setup?.mapEvents ?? [])];
  }

  /** Screen names of this map's UI Layout actions. */
  get screens(): string[] {
    return this.setup?.screens ?? [];
  }

  /** The project's sounds (for screen sounds). */
  get sounds(): { id: string; name: string }[] {
    const audio = (this.host.story() as { audio?: { id?: string; name?: string }[] } | null)?.audio ?? [];
    return audio.filter((a) => a?.id).map((a) => ({ id: a.id!, name: a.name || a.id! }));
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  get hasClipboard(): boolean {
    return clipboard.length > 0;
  }

  /** The picture of a project image (for the icon picker), or null. */
  image(id: string): { src: any; w: number; h: number } | null {
    const t = id && this.scene.textures?.exists?.(id) ? this.scene.textures.get(id) : null;
    const src = t?.getSourceImage?.();
    return src && src.width > 0 ? { src, w: src.width, h: src.height } : null;
  }

  /** Selects elements (a group comes whole unless `exact`); `add` toggles them in the selection. */
  select(ids: readonly string[], add = false, exact = false): void {
    const L = this.layout;
    if (!L) return;
    const full = exact ? [...ids] : [...new Set(ids.flatMap((id) => withGroup(L, id)))];
    let next: string[];
    if (add) {
      const allIn = full.every((id) => this.sel.includes(id));
      next = allIn ? this.sel.filter((id) => !full.includes(id)) : [...new Set([...this.sel, ...full])];
    } else next = full;
    if (next.length === this.sel.length && next.every((id, i) => id === this.sel[i])) return;
    this.sel = next;
    this.sig = "";
    this.paint();
    this.panel.render();
  }

  selectAll(): void {
    if (this.layout) this.select(this.layout.elements.map((e) => e.id), false, true);
  }

  /** Remembers the layout before a change (undo). */
  remember(): void {
    if (this.layout) this.history.push(this.layout);
  }

  /** Puts a changed layout in place: drawn at once, written into the action shortly after. */
  change(next: UiLayout, opts: { record?: boolean; rebuild?: boolean; select?: string[] } = {}): void {
    if (!this.layout) return;
    if (opts.record) this.history.push(this.layout);
    this.layout = next;
    this.sel = (opts.select ?? this.sel).filter((id) => next.elements.some((e) => e.id === id));
    this.sig = "";
    this.paint();
    if (opts.rebuild || opts.select) this.panel.render();
    else this.panel.sync();
    this.scheduleSave();
  }

  /** Changes a field of the selected element (or "theme.x" / "screen.x" / "scale" of the layout). */
  setField(path: string, value: unknown): void {
    const L = this.layout;
    if (!L) return;
    const next = cloneLayout(L);
    if (path === "scale") next.scale = Math.max(0, Math.round(Number(value) || 0));
    else if (path === "screen.typing") next.screen.typing = Math.max(0, Number(value) || 0);
    else if (path === "screen.kinds") next.screen.kinds = MESSAGE_KINDS.filter((k) => Array.isArray(value) && value.includes(k));
    else if (path.startsWith("screen.")) (next.screen as any)[path.slice(7)] = typeof value === "boolean" ? value : String(value);
    else if (path.startsWith("theme.icons.")) {
      const item = path.slice("theme.icons.".length);
      if (value) next.theme.icons[item] = String(value);
      else delete next.theme.icons[item];
    } else if (path.startsWith("theme.")) (next.theme as any)[path.slice(6)] = path === "theme.panelSlice" ? Math.max(0, Math.round(Number(value) || 0)) : String(value);
    else {
      const one = this.selection;
      const i = one ? next.elements.findIndex((e) => e.id === one.id) : -1;
      if (i < 0) return;
      let select: string[] | undefined;
      if (path === "id") {
        const id = String(value).trim();
        if (!id || next.elements.some((e, j) => j !== i && e.id === id)) return;
        select = [id];
      }
      const before = next.elements[i];
      next.elements[i] = withField(before, path, value);
      // A new anchor keeps the element where it is on the game window (X and Y count from the new corner).
      if (path === "anchor") {
        const { w, h } = this.viewSize();
        const p = anchorPoint(before.anchor, w, h);
        next.elements[i] = { ...next.elements[i], ...offsetFrom(next.elements[i].anchor, p.x + before.x, p.y + before.y, w, h) };
      }
      this.change(next, { rebuild: path === "show.when" || path === "action.kind", select });
      return;
    }
    this.change(next, { rebuild: path === "screen.input" || path === "screen.role" });
  }

  /**
   * The Role list: the HUD is a layout without a screen name, a screen has one. Turning one into the
   * other writes the action's Screen name field (as typing in it would); a screen's role is in its layout.
   */
  setRole(role: string): void {
    const L = this.layout;
    if (!L) return;
    if (role === "hud") {
      if (!this.isScreen) return;
      this.change({ ...cloneLayout(L), screen: { ...L.screen, role: "none" } });
      this.flush();
      if (!writeFormText(this.win.document, UI_LAYOUT_ACTION, SCREEN_FIELD_LABEL, "")) this.panel.status(`Not changed: the "${SCREEN_FIELD_LABEL}" field of ${UI_LAYOUT_ACTION} was not found.`);
      return;
    }
    const roleOf = role as UiLayout["screen"]["role"];
    if (this.isScreen) return this.setField("screen.role", roleOf);
    // A HUD becomes a screen: the name of its role, numbered when the project has a screen of that name.
    const taken = new Set(projectUi(this.host.story() as Parameters<typeof projectUi>[0]).screens.map((x) => x.name));
    const base = ROLE_SCREEN_NAMES[role] ?? "screen";
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
    this.change({ ...cloneLayout(L), screen: { ...L.screen, role: roleOf, dim: role === "notification" || role === "title" ? "" : L.screen.dim } });
    this.flush();
    if (!writeFormText(this.win.document, UI_LAYOUT_ACTION, SCREEN_FIELD_LABEL, name)) this.panel.status(`Not changed: the "${SCREEN_FIELD_LABEL}" field of ${UI_LAYOUT_ACTION} was not found.`);
  }

  /** The game window in layout pixels. */
  private viewSize(): { w: number; h: number } {
    const st = this.setup;
    if (!st || !this.layout) return { w: 0, h: 0 };
    const k = boardScale(st, this.layout);
    return { w: Math.floor(st.frame.w / k), h: Math.floor(st.frame.h / k) };
  }

  /** Adds an element: at a point of the game window (layout pixels), else in its middle. */
  add(type: ElementType, at?: { x: number; y: number }): void {
    const L = this.layout;
    if (!L) return;
    const { w, h } = this.viewSize();
    const next = cloneLayout(L);
    const e = newElement(next, type, at?.x ?? w / 2 - 16, at?.y ?? h / 2 - 8, w, h);
    next.elements.push(e);
    this.change(next, { record: true, select: [e.id] });
  }

  remove(): void {
    const L = this.layout;
    if (!L || !this.sel.length) return;
    const next = cloneLayout(L);
    next.elements = next.elements.filter((e) => !this.sel.includes(e.id));
    this.change(next, { record: true, select: [] });
  }

  copy(): void {
    if (!this.layout || !this.sel.length) return;
    clipboard = this.layout.elements.filter((e) => this.sel.includes(e.id)).map((e) => JSON.parse(JSON.stringify(e)) as UiElement);
    this.panel.render();
  }

  cut(): void {
    this.copy();
    this.remove();
  }

  /** Pastes the copied elements: 8 pixels off the originals, or with their box's corner at a point. */
  paste(at?: { x: number; y: number }): void {
    const L = this.layout;
    if (!L || !clipboard.length) return;
    let dx = 8;
    let dy = 8;
    if (at) {
      const { w, h } = this.viewSize();
      const boxes = clipboard.map((e) => {
        const p = anchorPoint(e.anchor, w, h);
        return { x: p.x + e.x, y: p.y + e.y, w: e.w, h: e.h };
      });
      const b = boundsOf(boxes)!;
      dx = Math.round(at.x - b.x);
      dy = Math.round(at.y - b.y);
    }
    const { layout, ids } = pasteElements(L, clipboard, dx, dy);
    this.change(layout, { record: true, select: ids });
  }

  duplicate(): void {
    if (!this.sel.length) return;
    const keep = clipboard;
    this.copy();
    this.paste();
    clipboard = keep;
  }

  reorder(how: "front" | "back" | "forward" | "backward"): void {
    if (this.layout && this.sel.length) this.change(reorderElements(this.layout, this.sel, how), { record: true, rebuild: true });
  }

  group(on: boolean): void {
    if (this.layout && this.sel.length) this.change(groupElements(this.layout, this.sel, on), { record: true, rebuild: true });
  }

  lock(on: boolean): void {
    const L = this.layout;
    if (!L || !this.sel.length) return;
    const next = cloneLayout(L);
    for (const e of next.elements) {
      if (!this.sel.includes(e.id)) continue;
      if (on) e.locked = true;
      else delete e.locked;
    }
    this.change(next, { record: true, rebuild: true });
  }

  align(how: Align): void {
    if (this.layout && this.painted && this.sel.length > 1) this.change(alignElements(this.layout, this.sel, this.painted.boxes, how), { record: true });
  }

  /** Moves the selection by (dx, dy) layout pixels (arrow keys). */
  nudge(dx: number, dy: number): void {
    if (this.layout && this.sel.length) this.change(moveElements(this.layout, this.sel, dx, dy), { record: true });
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

  /** Starts again from the classic Zelda HUD, or an empty screen (undo brings the old layout back). */
  template(): void {
    if (!this.layout || !this.setup) return;
    const sp = this.setup.start;
    const classic = classicLayout({ magic: sp.magicBar !== false, bottom: sp.hudBottom === true });
    this.change(this.isScreen ? { ...classic, screen: this.layout.screen, elements: [] } : classic, { record: true, select: [] });
  }

  setGrid(step: number): void {
    this.grid = Math.max(0, Math.round(step));
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

  // ---- drawing on the map ------------------------------------------------------------------------

  private fonts(layout: UiLayout): Record<string, string> {
    const story = this.host.story();
    const out: Record<string, string> = {};
    for (const id of new Set([layout.theme.font, ...layout.elements.map((e) => (e.type === "text" || e.type === "button" ? e.font : ""))])) {
      if (!id) continue;
      out[id] = fontFamilyCss(story, id);
      void ensureProjectFont(story as any, this.scene.textures, id);
    }
    return out;
  }

  private paint(): void {
    const st = this.setup;
    const layout = this.layout ?? st?.layout ?? null;
    const sig = st && layout ? JSON.stringify([layout, st.frame, st.zoom, st.values, !!this.layout, !!st.action, st.under]) : "";
    if (sig === this.sig) return;
    this.sig = sig;
    this.painter.begin();
    this.underPainter.begin();
    this.frameG.clear();
    if (!st || !layout) {
      this.painter.end();
      this.underPainter.end();
      this.painted = null;
      this.label.setVisible(false);
      return;
    }
    const f = st.frame;
    const k = boardScale(st, layout);
    const values = this.layout ? sampleValues(layout, st.start) : st.values;
    // Inventory grids show a few built-in item icons, the cursor on the bow (the sample {inv.name}).
    const inventory = { cells: ["sword", "bow", "bomb", "boomerang"].map((id) => ({ icon: layout.theme.icons[id] || `icon_${id}`, count: id === "bow" ? 30 : id === "bomb" ? 10 : null })), cursor: 1 };
    this.painted = this.painter.paint(layout, values, this.fonts(layout), { x: f.x, y: f.y, w: f.w, h: f.h, k }, { inventory });
    this.painter.end();
    const under = st.screen && layout.screen.role !== "title" ? st.under : null;
    if (under) this.underPainter.paint(under, sampleValues(under, st.start), this.fonts(under), { x: f.x, y: f.y, w: f.w, h: f.h, k: boardScale(st, under) });
    this.underPainter.end();
    // The frame: the screen at the start of the game (dashed, like a camera view).
    const g = this.frameG;
    // A screen is drawn over the game, dimmed by its colour.
    const dim = st.screen ? /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(layout.screen.dim.trim()) : null;
    if (dim) g.fillStyle(parseInt(dim[1], 16), dim[2] ? parseInt(dim[2], 16) / 255 : 1).fillRect(f.x, f.y, f.w, f.h);
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
    const what = st.screen ? `screen "${st.screen}"${ROLE_NAMES[layout.screen.role]}` : st.sharing === "thisMap" ? "HUD of this map" : st.sharing === "conflict" ? "second shared HUD (not shown in the game)" : "HUD of all maps";
    const text = this.layout
      ? `Game window · ${what}: drag to move, right-click for more; the wheel and the middle button still move the map`
      : st.sharing === "project"
        ? `Game window · the shared HUD from map "${st.sharedMap}" (open its UI Layout there to edit it)`
        : st.sharing === "conflict"
          ? `Game window · the shared HUD from map "${st.sharedMap}"; this map's UI Layout is a second one (click to see it)`
          : st.action
            ? `Game window · ${what} (click it to edit)`
            : "Game window · classic Zelda HUD (add Zelda: UI Layout after Start Toolkit to design your own)";
    this.label.setText(text).setPosition(f.x, f.y - 1).setVisible(true);
  }

  // ---- the page element over the frame -----------------------------------------------------------

  private canvasOf(): any {
    return this.scene.game?.canvas ?? null;
  }

  /** Creates the overlay once, inside the editor's map frame (so the editor recognises it). */
  private ensureOverlay(): any {
    const doc = this.win.document;
    const canvas = this.canvasOf();
    if (!doc?.createElement || !canvas?.getBoundingClientRect) return null;
    if (!this.overlay) {
      const o = doc.createElement("div");
      o.setAttribute("data-zelda-ui-board", "true");
      // The editor's own controls over the map: no map tool on a left press, wheel and middle drag still move the map.
      o.setAttribute("data-map-world-interaction", "true");
      o.setAttribute("data-map-primary-interaction", "true");
      o.style.cssText = "position:fixed;overflow:hidden;z-index:5;touch-action:none;user-select:none";
      o.addEventListener("pointerdown", (e: any) => this.down(e));
      o.addEventListener("pointermove", (e: any) => this.move(e));
      o.addEventListener("pointerup", (e: any) => this.up(e));
      o.addEventListener("pointercancel", (e: any) => this.up(e));
      o.addEventListener("contextmenu", (e: any) => this.context(e));
      this.overlay = o;
    }
    const parent = canvas.closest?.("#editor-game-frame") ?? canvas.parentElement ?? doc.body;
    if (this.overlay.parentElement !== parent) parent.appendChild(this.overlay);
    return this.overlay;
  }

  /** Screen point → layout pixel of the game window. */
  private toLayout(cx: number, cy: number): { x: number; y: number } {
    return { x: (cx - this.view.ox) / this.view.s, y: (cy - this.view.oy) / this.view.s };
  }

  /** Keeps the overlay over the frame as the editor pans and zooms, and draws the selection on it (every frame). */
  private place(): void {
    const st = this.setup;
    const layout = this.layout ?? st?.layout;
    const o = st && layout && (this.layout || st.action) ? this.ensureOverlay() : this.overlay;
    if (!o) return;
    const canvas = this.canvasOf();
    const cam = this.scene.cameras?.main;
    if (!st || !layout || !canvas || !cam || !(this.layout || st.action)) {
      o.style.display = "none";
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const cs = rect.width / (canvas.width || rect.width || 1);
    const k = boardScale(st, layout);
    const z = cam.zoom * cs;
    const s = k * z;
    const fx = rect.left + (st.frame.x - cam.worldView.x) * z;
    const fy = rect.top + (st.frame.y - cam.worldView.y) * z;
    // The designer's area: the frame and every element, also one dragged out of the frame (with
    // room for its handles), so no press on the layout reaches the map below. Inside the canvas.
    const area = boundsOf([{ x: 0, y: 0, w: st.frame.w / k, h: st.frame.h / k }, ...Object.values(this.painted?.boxes ?? {})])!;
    const pad = this.layout ? (HANDLE_PX * 3) / s : 0;
    const left = Math.max(fx + (area.x - pad) * s, rect.left);
    const top = Math.max(fy + (area.y - pad) * s, rect.top);
    const right = Math.min(fx + (area.x + area.w + pad) * s, rect.right);
    const bottom = Math.min(fy + (area.y + area.h + pad) * s, rect.bottom);
    if (right <= left || bottom <= top) {
      o.style.display = "none";
      return;
    }
    this.view = { ox: fx, oy: fy, s, left, top };
    Object.assign(o.style, { display: "block", left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`, pointerEvents: this.layout ? "auto" : "none", cursor: "default" });
    this.drawOverlay();
  }

  private div(i: number): any {
    let d = this.divs[i];
    if (!d) {
      d = this.win.document.createElement("div");
      this.divs.push(d);
      this.overlay.appendChild(d);
    }
    if (d.parentElement !== this.overlay) this.overlay.appendChild(d);
    d.style.display = "block";
    return d;
  }

  /** Outlines, the selection with its handles, guides and the marquee; in preview, click areas over the HUD. */
  private drawOverlay(): void {
    const boxes = this.painted?.boxes ?? {};
    const v = this.view;
    let n = 0;
    const at = (b: Box, css: string, attrs: Record<string, string> = {}, rotation = 0) => {
      const d = this.div(n++);
      d.style.cssText = `position:absolute;box-sizing:border-box;left:${v.ox - v.left + b.x * v.s}px;top:${v.oy - v.top + b.y * v.s}px;width:${Math.max(1, b.w * v.s)}px;height:${Math.max(1, b.h * v.s)}px;${rotation ? `transform:rotate(${rotation}deg);` : ""}${css}`;
      for (const name of ["data-handle", "data-id"]) d.removeAttribute(name);
      for (const [name, value] of Object.entries(attrs)) d.setAttribute(name, value);
      return d;
    };
    const L = this.layout;
    if (!L) {
      // Preview: click areas over the elements open the action.
      for (const id of Object.keys(boxes)) at(boxes[id], "pointer-events:auto;cursor:pointer", { "data-id": id });
    } else {
      for (const e of L.elements) {
        const b = boxes[e.id];
        if (!b) continue;
        const selected = this.sel.includes(e.id);
        const rot = ROTATABLE.includes(e.type) ? e.rotation : 0;
        at(b, `pointer-events:none;border:1px ${selected ? "solid #ffffff" : `dashed ${e.locked ? "#ff9a7a66" : "#5ad8ff88"}`};${selected ? "box-shadow:0 0 0 1px #000a" : ""}`, {}, rot);
      }
      const one = this.selection;
      const b = one ? boxes[one.id] : null;
      if (one && b && !FIXED_SIZE.includes(one.type) && !this.drag) {
        const hs = HANDLE_PX / v.s;
        for (const h of HANDLES) {
          const hx = h.includes("w") ? b.x : h.includes("e") ? b.x + b.w : b.x + b.w / 2;
          const hy = h.includes("n") ? b.y : h.includes("s") ? b.y + b.h : b.y + b.h / 2;
          const cursor = h === "n" || h === "s" ? "ns-resize" : h === "e" || h === "w" ? "ew-resize" : h === "ne" || h === "sw" ? "nesw-resize" : "nwse-resize";
          at({ x: hx - hs / 2, y: hy - hs / 2, w: hs, h: hs }, `pointer-events:auto;background:#fff;border:1px solid #000;cursor:${cursor}`, { "data-handle": h });
        }
        if (ROTATABLE.includes(one.type)) at({ x: b.x + b.w / 2 - hs / 2, y: b.y - hs * 2.5, w: hs, h: hs }, "pointer-events:auto;background:#ffd23a;border:1px solid #000;border-radius:50%;cursor:grab", { "data-handle": "rotate" });
      }
      for (const g of this.guides) {
        const vw = this.viewSize();
        at(g.axis === "x" ? { x: g.at, y: 0, w: 1 / v.s, h: vw.h } : { x: 0, y: g.at, w: vw.w, h: 1 / v.s }, "pointer-events:none;background:#ff4fd8");
      }
      const d = this.drag;
      if (d?.kind === "marquee") {
        const r = { x: Math.min(d.sx, d.x), y: Math.min(d.sy, d.y), w: Math.abs(d.x - d.sx), h: Math.abs(d.y - d.sy) };
        at(r, "pointer-events:none;border:1px dashed #fff;background:#5ad8ff22");
      }
    }
    for (let i = n; i < this.divs.length; i++) this.divs[i].style.display = "none";
  }

  /** The topmost unlocked element under a layout point (later elements are drawn on top). */
  private hit(x: number, y: number): string {
    const L = this.layout;
    const boxes = this.painted?.boxes ?? {};
    if (!L) return "";
    for (let i = L.elements.length - 1; i >= 0; i--) {
      const e = L.elements[i];
      const b = boxes[e.id];
      if (b && !e.locked && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return e.id;
    }
    return "";
  }

  private down(e: any): void {
    // The middle button is the editor's (it pans the map). Any other press stays here: cancelling it
    // also keeps the browser from sending the mouse press Phaser would take as a press on the map.
    if (e.button === 1) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    this.panel.closeMenu();
    if (!this.layout) {
      const id = e.target?.getAttribute?.("data-id");
      if (id && this.setup?.action) this.host.openAction(this.setup.action);
      return;
    }
    this.overlay.setPointerCapture?.(e.pointerId);
    this.win.document.activeElement?.blur?.();
    const p = this.toLayout(e.clientX, e.clientY);
    const handle = e.target?.getAttribute?.("data-handle");
    const one = this.selection;
    if (handle && one) {
      const box = this.painted?.boxes[one.id];
      if (!box) return;
      this.drag = handle === "rotate" ? { kind: "rotate", before: this.layout, id: one.id, cx: box.x + box.w / 2, cy: box.y + box.h / 2 } : { kind: "resize", sx: p.x, sy: p.y, before: this.layout, id: one.id, box, handle: handle as Handle };
      return;
    }
    const id = this.hit(p.x, p.y);
    if (!id) {
      if (!e.shiftKey) this.select([]);
      this.drag = { kind: "marquee", sx: p.x, sy: p.y, x: p.x, y: p.y, keep: e.shiftKey ? [...this.sel] : [] };
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) this.select([id], true, e.altKey);
    else if (!this.sel.includes(id)) this.select([id], false, e.altKey);
    if (!this.sel.includes(id)) return;
    this.drag = { kind: "move", sx: p.x, sy: p.y, before: this.layout, ids: [...this.sel], moved: false, clicked: additive ? "" : id };
  }

  private move(e: any): void {
    const d = this.drag;
    if (!d || !this.layout || !this.painted) return;
    const p = this.toLayout(e.clientX, e.clientY);
    const { w: vw, h: vh } = this.viewSize();
    const snap = this.snapping && !e.altKey;
    if (d.kind === "marquee") {
      d.x = p.x;
      d.y = p.y;
      return;
    }
    if (d.kind === "move") {
      let dx = Math.round(p.x - d.sx);
      let dy = Math.round(p.y - d.sy);
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 1) return;
      d.moved = true;
      const boxesBefore = this.boxesOf(d.before, vw, vh);
      const box = boundsOf(d.ids.map((id) => boxesBefore[id]).filter(Boolean));
      this.guides = [];
      if (box && (snap || this.grid > 1)) {
        const others = d.before.elements.filter((x) => !d.ids.includes(x.id)).map((x) => boxesBefore[x.id]);
        const s = snapMove({ ...box, x: box.x + dx, y: box.y + dy }, snap ? others : [], vw, vh, snap ? SNAP_PX / this.view.s : 0, this.grid);
        dx += s.dx;
        dy += s.dy;
        this.guides = s.guides;
      }
      this.layout = moveElements(d.before, d.ids, dx, dy);
    } else if (d.kind === "resize") {
      const nb = resizeBox(d.box, d.handle, Math.round(p.x - d.sx), Math.round(p.y - d.sy), e.shiftKey);
      const next = cloneLayout(d.before);
      const el = next.elements.find((x) => x.id === d.id)!;
      el.x += nb.x - d.box.x;
      el.y += nb.y - d.box.y;
      el.w = nb.w;
      el.h = nb.h;
      this.layout = next;
    } else {
      let deg = (Math.atan2(p.y - d.cy, p.x - d.cx) * 180) / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      const next = cloneLayout(d.before);
      const el = next.elements.find((x) => x.id === d.id)!;
      el.rotation = ((Math.round(deg) % 360) + 360) % 360;
      this.layout = next;
    }
    this.sig = "";
    this.paint();
    this.panel.sync();
  }

  private up(e: any): void {
    const d = this.drag;
    this.drag = null;
    this.guides = [];
    this.overlay?.releasePointerCapture?.(e.pointerId);
    if (!d || !this.layout) return;
    if (d.kind === "marquee") {
      const r = { x: Math.min(d.sx, d.x), y: Math.min(d.sy, d.y), w: Math.abs(d.x - d.sx), h: Math.abs(d.y - d.sy) };
      if (r.w < 1 && r.h < 1) return;
      const boxes = this.painted?.boxes ?? {};
      const inside = this.layout.elements.filter((x) => {
        const b = boxes[x.id];
        return b && !x.locked && b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
      });
      this.select([...d.keep, ...inside.map((x) => x.id)], false, true);
      return;
    }
    if (d.kind === "move" && !d.moved) {
      // A click (no drag) on one of several selected elements selects just it (and its group).
      if (d.clicked && this.sel.length > 1) this.select([d.clicked]);
      return;
    }
    if (JSON.stringify(d.before) === JSON.stringify(this.layout)) return;
    this.history.push(d.before);
    this.panel.sync();
    this.scheduleSave();
  }

  private boxesOf(layout: UiLayout, vw: number, vh: number): Record<string, Box> {
    // Painted boxes for the shown size of hearts and counters; placed boxes for the rest.
    const out: Record<string, Box> = {};
    for (const e of layout.elements) {
      const painted = this.painted?.boxes[e.id];
      const p = anchorPoint(e.anchor, vw, vh);
      out[e.id] = painted && FIXED_SIZE.includes(e.type) ? { ...painted, x: p.x + e.x, y: p.y + e.y } : { x: p.x + e.x, y: p.y + e.y, w: e.w, h: e.h };
    }
    return out;
  }

  /** Right-click: what can be done with the element under the mouse, or what can be created there. */
  private context(e: any): void {
    if (!this.layout) return;
    e.preventDefault();
    e.stopPropagation();
    const p = this.toLayout(e.clientX, e.clientY);
    const at = { x: Math.round(p.x), y: Math.round(p.y) };
    const id = this.hit(p.x, p.y);
    if (id && !this.sel.includes(id)) this.select([id]);
    const L = this.layout;
    const items: MenuItem[] = [];
    if (id || this.sel.length) {
      const sel = L.elements.filter((x) => this.sel.includes(x.id));
      const grouped = sel.some((x) => x.group);
      const locked = sel.some((x) => x.locked);
      items.push(
        { label: "Copy", key: "Ctrl+C", run: () => this.copy() },
        { label: "Cut", key: "Ctrl+X", run: () => this.cut() },
        { label: "Paste here", key: "Ctrl+V", run: () => this.paste(at), disabled: !clipboard.length },
        { label: "Duplicate", key: "Ctrl+D", run: () => this.duplicate() },
        { separator: true },
        { label: "Bring to front", key: "Ctrl+Shift+]", run: () => this.reorder("front") },
        { label: "Bring forward", key: "Ctrl+]", run: () => this.reorder("forward") },
        { label: "Send backward", key: "Ctrl+[", run: () => this.reorder("backward") },
        { label: "Send to back", key: "Ctrl+Shift+[", run: () => this.reorder("back") },
        { separator: true },
        grouped ? { label: "Ungroup", key: "Ctrl+Shift+G", run: () => this.group(false) } : { label: "Group", key: "Ctrl+G", run: () => this.group(true), disabled: sel.length < 2 },
        locked ? { label: "Unlock", run: () => this.lock(false) } : { label: "Lock", run: () => this.lock(true) },
      );
      if (sel.length > 1)
        items.push(
          { separator: true },
          { label: "Align left", run: () => this.align("left") },
          { label: "Align centre", run: () => this.align("center") },
          { label: "Align right", run: () => this.align("right") },
          { label: "Align top", run: () => this.align("top") },
          { label: "Align middle", run: () => this.align("middle") },
          { label: "Align bottom", run: () => this.align("bottom") },
          { label: "Space evenly across", run: () => this.align("spreadX"), disabled: sel.length < 3 },
          { label: "Space evenly down", run: () => this.align("spreadY"), disabled: sel.length < 3 },
        );
      items.push({ separator: true }, { label: "Delete", key: "Del", run: () => this.remove(), danger: true });
    } else {
      items.push({ title: "Create here" });
      for (const [type, label] of TYPE_ITEMS) items.push({ label, run: () => this.add(type, at) });
      items.push({ separator: true }, { label: "Paste here", key: "Ctrl+V", run: () => this.paste(at), disabled: !clipboard.length }, { label: "Select all", key: "Ctrl+A", run: () => this.selectAll() });
    }
    this.panel.menu(e.clientX, e.clientY, items);
  }

  /** Keys on the map while designing: arrows (Shift: 8 px), Delete, Ctrl+Z / Y / C / X / V / D / A / G, Ctrl+[ ]. */
  private key(e: any): void {
    if (!this.layout) return;
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ""));
    if (typing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = String(e.key ?? "").toLowerCase();
    const step = e.shiftKey ? 8 : 1;
    const moves: Record<string, [number, number]> = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
    const has = this.sel.length > 0;
    let handled = true;
    if (ctrl && k === "z") e.shiftKey ? this.redo() : this.undo();
    else if (ctrl && k === "y") this.redo();
    else if (ctrl && k === "c" && has) this.copy();
    else if (ctrl && k === "x" && has) this.cut();
    else if (ctrl && k === "v" && clipboard.length) this.paste();
    else if (ctrl && k === "d" && has) this.duplicate();
    else if (ctrl && k === "a") this.selectAll();
    else if (ctrl && k === "g" && has) this.group(!e.shiftKey);
    else if (ctrl && (e.key === "]" || e.code === "BracketRight") && has) this.reorder(e.shiftKey ? "front" : "forward");
    else if (ctrl && (e.key === "[" || e.code === "BracketLeft") && has) this.reorder(e.shiftKey ? "back" : "backward");
    else if (has && moves[k]) this.nudge(...moves[k]);
    else if (has && (k === "delete" || k === "backspace")) this.remove();
    else if (k === "escape" && (has || this.panel.menuOpen)) {
      this.panel.closeMenu();
      this.select([]);
    } else handled = false;
    if (handled) {
      e.preventDefault?.();
      e.stopPropagation?.();
    }
  }

  destroy(): void {
    this.flush();
    if (this.raf) this.win.cancelAnimationFrame?.(this.raf);
    this.win.removeEventListener?.("keydown", this.onKey, true);
    this.win.document?.fonts?.removeEventListener?.("loadingdone", this.onFonts);
    this.panel.destroy();
    this.overlay?.remove?.();
    this.overlay = null;
    this.painter.destroy();
    this.underPainter.destroy();
    this.frameG.destroy?.();
    this.label.destroy?.();
  }
}
