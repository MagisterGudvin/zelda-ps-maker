import { createDefaultConfig } from "../core/config.ts";
import { HudPainter } from "../host/hudPainter.ts";
import type { HudModel } from "../host/types.ts";
import type { PsStory } from "../host/psmakerAssets.ts";
import { I18n } from "../ui/i18n.ts";
import { HUD_PARTS, type HudPart, type Rect } from "../ui/hudLayout.ts";
import { hudCounter } from "../ui/hud.ts";
import { HUD_PART_LABELS, hudStyleConfig } from "./hudStyleConfig.ts";

/**
 * The toolkit HUD on the map in the PS Maker editor: a "game window" frame (the screen at the
 * map's zoom) around the player's start, with the HUD in it as the game draws it (the same
 * painter, one HUD pixel per map pixel). Its parts can be dragged; the drop writes the part's
 * X and Y into the map's "Zelda: HUD Style" form, as if the author had typed them.
 */

interface ActionLike {
  id?: string;
  type?: string;
  actionName?: string;
  pluginParams?: Record<string, unknown>;
  moveType?: string;
  position?: { x?: number; y?: number };
}
interface MapLike {
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
const DEPTH = 1_000_100;

export interface HudPreviewSetup {
  model: HudModel;
  /** The game window on the map (world pixels). */
  frame: Rect;
  /** World pixels per HUD pixel. */
  k: number;
  /** The map's HUD Style action, or null (parts cannot be moved then). */
  style: { id: string; root: string } | null;
}

/** What the HUD of a map looks like at the start of the game, from its Start Toolkit and HUD Style. */
export function hudPreviewSetup(map: MapLike, story: (PsStory & Raw) | null, cameraZoom: number): HudPreviewSetup | null {
  let start: ActionLike | null = null;
  let style: { action: ActionLike; root: string } | null = null;
  let spawn: { x: number; y: number } | null = null;
  for (const [list, root] of LISTS) {
    for (const a of map[list] ?? []) {
      if (a?.actionName === "Zelda: Start Toolkit" && !start) start = a;
      if (a?.actionName === "Zelda: HUD Style") style = { action: a, root };
      if (a?.type === "movePlayerAction" && a.moveType === "absolute-position" && !spawn && typeof a.position?.x === "number" && typeof a.position?.y === "number") spawn = { x: a.position.x, y: a.position.y };
    }
  }
  const sp = start?.pluginParams ?? {};
  if (!start || sp.hud === false) return null;
  const cfg = createDefaultConfig();
  const ui = { ...cfg.ui, ...(style ? hudStyleConfig(style.action.pluginParams ?? {}, story) : {}) };
  const hearts = Math.max(1, Math.round(Number(sp.hearts) || 3));
  const heartValue = cfg.player.heartValue;
  const i18n = new I18n();
  i18n.setLanguage(typeof sp.language === "string" && sp.language ? sp.language : "auto");
  const zoom = cameraZoom > 0 ? cameraZoom : Number(story?.gameConfig?.zoom) || 1;
  const gw = Number(story?.gameConfig?.width) || 1280;
  const gh = Number(story?.gameConfig?.height) || 720;
  const w = gw / zoom;
  const h = gh / zoom;
  const c = spawn ?? { x: w / 2, y: h / 2 };
  const model: HudModel = {
    visible: true,
    hp: hearts * heartValue,
    maxHp: hearts * heartValue,
    heartValue,
    magic: 1,
    maxMagic: 1,
    showHearts: ui.showHearts,
    showMagic: ui.showMagic && sp.magicBar !== false,
    showItem: ui.showActiveItem,
    activeItem: null,
    counters: ui.counters.map((id) => hudCounter(id, id, 0, cfg.inventory.capacities[id] ?? 99)),
    messages: [],
    inventoryOpen: false,
    inventoryTitle: "",
    inventory: [],
    dead: false,
    deathText: "",
    lifeLabel: i18n.t("hud.life"),
    position: sp.hudBottom === true ? "bottom" : "top",
    scale: ui.scale,
    safeArea: { ...ui.safeArea },
    fontFamily: ui.fontFamily,
    skin: { ...ui.skin },
    barSlice: ui.barSlice,
    panelSlice: ui.panelSlice,
    showLifeLabel: ui.showLifeLabel,
    textColor: ui.textColor,
    box: null,
    places: { ...ui.places },
    mapZoom: zoom,
  };
  return {
    model,
    frame: { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h },
    k: (ui.scale > 0 ? ui.scale : zoom) / zoom,
    style: style?.action.id ? { id: style.action.id, root: style.root } : null,
  };
}

/** The game window frame and the HUD in it, on the editor's map scene. */
export class HudPreview {
  readonly scene: any;
  private readonly painter: HudPainter;
  private readonly frameG: any;
  private readonly label: any;
  private readonly zones = new Map<HudPart, any>();
  private setup: HudPreviewSetup | null = null;
  private sig = "";
  private dragging: { part: HudPart; x: number; y: number } | null = null;
  private onDrop: (part: HudPart, x: number, y: number) => void;

  constructor(scene: any, onDrop: (part: HudPart, x: number, y: number) => void) {
    this.scene = scene;
    this.onDrop = onDrop;
    this.painter = new HudPainter(scene, scene.game, DEPTH);
    this.frameG = scene.add.graphics().setDepth(DEPTH - 1);
    this.label = scene.add.text(0, 0, "", { fontFamily: "sans-serif", fontSize: "8px", color: "#ffffff", backgroundColor: "#1f1a24cc" }).setOrigin(0, 1).setDepth(DEPTH + 1);
    this.label.setResolution?.(4);
    for (const part of HUD_PARTS) {
      if (typeof scene.add.zone !== "function") break;
      const z = scene.add.zone(0, 0, 1, 1).setOrigin(0, 0).setDepth(DEPTH + 2);
      z.setInteractive?.({ draggable: true, useHandCursor: true });
      z.on?.("drag", (_p: unknown, x: number, y: number) => this.drag(part, x, y));
      z.on?.("dragend", () => this.drop());
      this.zones.set(part, z);
    }
  }

  /** Draws the setup again if it changed (and not while a part is being dragged). */
  update(setup: HudPreviewSetup | null): void {
    if (this.dragging) return;
    const sig = setup ? JSON.stringify([setup.model, setup.frame, setup.k, setup.style]) : "";
    if (sig === this.sig) return;
    this.sig = sig;
    this.setup = setup;
    this.paint();
  }

  private paint(): void {
    const st = this.setup;
    this.painter.begin();
    this.frameG.clear();
    if (!st) {
      this.painter.end();
      this.label.setVisible(false);
      for (const z of this.zones.values()) z.setVisible(false).disableInteractive?.();
      return;
    }
    const model = this.dragging ? { ...st.model, places: { ...st.model.places, [this.dragging.part]: { x: this.dragging.x, y: this.dragging.y } } } : st.model;
    const f = st.frame;
    const L = this.painter.paint(model, { x: f.x, y: f.y, w: f.w, h: f.h, k: st.k });
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
    this.label.setText(st.style ? "Game window · Zelda HUD (drag the parts)" : "Game window · Zelda HUD (add Zelda: HUD Style to move the parts)").setPosition(f.x, f.y - 1).setVisible(true);
    for (const part of HUD_PARTS) {
      const z = this.zones.get(part);
      const r = L.parts[part];
      if (!z) continue;
      if (!r || !st.style) {
        z.setVisible(false).disableInteractive?.();
        continue;
      }
      z.setPosition(f.x + r.x * st.k, f.y + r.y * st.k).setSize(r.w * st.k, r.h * st.k).setVisible(true);
      z.input?.hitArea?.setSize?.(r.w * st.k, r.h * st.k);
      z.setInteractive?.({ draggable: true, useHandCursor: true });
      if (part === this.dragging?.part) g.lineStyle(1, 0xffffff, 1).strokeRect(f.x + r.x * st.k, f.y + r.y * st.k, r.w * st.k, r.h * st.k);
    }
  }

  private drag(part: HudPart, x: number, y: number): void {
    const st = this.setup;
    if (!st) return;
    this.dragging = { part, x: Math.max(0, Math.round((x - st.frame.x) / st.k)), y: Math.max(0, Math.round((y - st.frame.y) / st.k)) };
    this.paint();
  }

  private drop(): void {
    const d = this.dragging;
    if (!d || !this.setup) return;
    // Keep the dragged place until the form update comes back through the map data.
    this.setup = { ...this.setup, model: { ...this.setup.model, places: { ...this.setup.model.places, [d.part]: { x: d.x, y: d.y } } } };
    this.dragging = null;
    this.sig = "";
    this.paint();
    this.onDrop(d.part, d.x, d.y);
  }

  destroy(): void {
    this.painter.destroy();
    this.frameG.destroy?.();
    this.label.destroy?.();
    for (const z of this.zones.values()) z.destroy?.();
    this.zones.clear();
  }
}

/** The open action settings panel if it shows the given action ("Zelda: HUD Style"). */
function openPanel(doc: any, title: string): any {
  const panel = doc?.querySelector?.('[data-map-editor-action-config-panel="true"]');
  if (!panel) return null;
  const crumbs = [...panel.querySelectorAll('nav[aria-label="Breadcrumb"] li')];
  const last = crumbs.at(-1)?.textContent?.trim();
  return last === title ? panel : null;
}

/**
 * Writes numbers into fields of the open action form, found by their labels, the way typing does
 * (the input's value, then "input" and "change" events). Collapsed sections are opened first.
 */
export function writeFormNumbers(doc: any, title: string, values: Record<string, number>): boolean {
  const panel = openPanel(doc, title);
  if (!panel) return false;
  for (const d of panel.querySelectorAll("details")) if (!d.open) d.open = true;
  const view = doc.defaultView ?? globalThis;
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement?.prototype ?? {}, "value")?.set;
  let all = true;
  for (const [label, value] of Object.entries(values)) {
    const el = [...panel.querySelectorAll(".label")].find((l: any) => (l.firstChild?.textContent ?? l.textContent ?? "").trim() === label) as any;
    const input = el?.parentElement?.querySelector?.("input");
    if (!input) {
      all = false;
      continue;
    }
    if (setter) setter.call(input, String(value));
    else input.value = String(value);
    input.dispatchEvent(new view.Event("input", { bubbles: true }));
    input.dispatchEvent(new view.Event("change", { bubbles: true }));
  }
  return all;
}

/** Form values for a dropped part. */
export function placeFieldValues(part: HudPart, x: number, y: number): Record<string, number> {
  return { [`${HUD_PART_LABELS[part]} X`]: x, [`${HUD_PART_LABELS[part]} Y`]: y };
}
