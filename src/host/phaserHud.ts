import type { Logger } from "../core/logger.ts";
import type { HudModel, HudSink } from "./types.ts";
import type { UiLayout } from "../ui/uiLayout.ts";
import { LayoutPainter, layoutScale, type Painted } from "./layoutPainter.ts";

export const HUD_SCENE_KEY = "ZeldaMakerToolkitHUD";

const HUDS = new WeakMap<object, PhaserHud>();
const MSG_FILL = 0x101030;
const MSG_BORDER = 0xf0f0f0;

/** One HUD per Phaser game, reused across maps (avoids duplicate HUD objects). */
export function getHud(game: any, logger: Logger): PhaserHud {
  let hud = HUDS.get(game);
  if (!hud) {
    hud = new PhaserHud(game, logger);
    HUDS.set(game, hud);
  }
  return hud;
}

/**
 * The HUD in its own Phaser scene above PS Maker's scenes: the UI layout (Zelda: UI Layout, or the
 * classic one), message notes, the inventory panel and the death text, in layout pixels scaled by a
 * whole factor.
 */
export class PhaserHud implements HudSink {
  private readonly game: any;
  private readonly logger: Logger;
  private scene: any = null;
  private pending: HudModel | null = null;
  private visible = true;
  private painter: LayoutPainter | null = null;
  /** Layers (screens without keys) over the HUD, and the open screen over them. */
  private layerPainter: LayoutPainter | null = null;
  private screenPainter: LayoutPainter | null = null;
  private screenK = 0;
  private pointerHandler: ((type: "move" | "down", x: number, y: number) => void) | null = null;
  private diagText: any = null;
  private diagLines: string[] | null = null;

  /** Use getHud(); direct construction would duplicate the HUD scene. */
  constructor(game: any, logger: Logger) {
    this.game = game;
    this.logger = logger;
    this.ensureScene();
    // Fullscreen / window resize changes the screen size: lay everything out again.
    game.scale?.on?.("resize", () => {
      if (this.pending) this.render(this.pending);
      this.renderDiagnostics();
    });
    // A project font PS Maker loads later (on its first dialogue or menu): draw the texts again.
    (globalThis as { document?: { fonts?: { addEventListener?(e: string, f: () => void): void } } }).document?.fonts?.addEventListener?.("loadingdone", () => {
      if (this.pending) this.render(this.pending);
    });
  }

  private ensureScene(): void {
    const mgr = this.game.scene;
    if (mgr.getScene?.(HUD_SCENE_KEY)) {
      this.logger.warn(`A scene named "${HUD_SCENE_KEY}" already exists; the toolkit HUD is disabled.`);
      return;
    }
    const self = this;
    try {
      mgr.add(
        HUD_SCENE_KEY,
        {
          key: HUD_SCENE_KEY,
          active: true,
          create(this: any) {
            self.scene = this;
            self.painter = new LayoutPainter(this, 0);
            self.layerPainter = new LayoutPainter(this, 3);
            self.screenPainter = new LayoutPainter(this, 5);
            // Pointer over an open screen: hover and click its buttons (in its layout pixels).
            const pointer = (type: "move" | "down") => (p: { x: number; y: number }) => {
              if (self.screenK > 0) self.pointerHandler?.(type, p.x / self.screenK, p.y / self.screenK);
            };
            this.input?.on?.("pointermove", pointer("move"));
            this.input?.on?.("pointerdown", pointer("down"));
            self.diagText = this.add.text(0, 0, "", { fontFamily: "monospace", color: "#d0ffd0", backgroundColor: "#000000cc" }).setOrigin(0, 1).setDepth(10).setVisible(false);
            if (self.pending) self.render(self.pending);
            self.renderDiagnostics();
            self.applyVisible();
          },
        },
        true,
      );
      mgr.bringToTop?.(HUD_SCENE_KEY);
    } catch (err) {
      this.logger.error("Could not create the HUD scene:", err);
    }
  }

  private screen(): { W: number; H: number } {
    return { W: this.game.scale?.width ?? this.game.config?.width ?? 320, H: this.game.scale?.height ?? this.game.config?.height ?? 240 };
  }

  redraw(): void {
    if (this.pending) this.render(this.pending);
  }

  render(model: HudModel): void {
    this.pending = model;
    const p = this.painter;
    if (!this.scene || !this.scene.sys?.displayList || !p) return;
    const { W, H } = this.screen();
    const k = layoutScale(model.layout.scale || model.scale, model.mapZoom, W, H);
    p.begin();
    if (model.hudHidden) {
      p.end();
      this.drawScreen(model);
      return;
    }
    const painted = p.paint(model.layout, model.values, model.fonts, { x: 0, y: 0, w: W, h: H, k }, { time: model.time, minimap: model.minimap });
    const font = model.fonts[model.layout.theme.font] ?? "monospace";
    this.drawMessages(model, painted, k, font);
    if (model.dead) {
      const t = p.text(model.deathText, font, 10, "#ffffff");
      t.setPosition(Math.round(W / 2 - t.width / 2), Math.round(H / 2 - t.height / 2));
    }
    if (model.inventoryOpen) this.drawInventory(model, painted, k, font);
    p.end();
    this.drawScreen(model);
  }

  /** Layers, then the open screen over the game: its dim colour, its layout with the selected button. */
  private drawScreen(model: HudModel): void {
    const lp = this.layerPainter;
    const sp = this.screenPainter;
    if (!sp || !lp) return;
    const { W, H } = this.screen();
    const dim = (p: LayoutPainter, value: string) => {
      const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
      if (m) p.backdrop.fillStyle(parseInt(m[1], 16), m[2] ? parseInt(m[2], 16) / 255 : 1).fillRect(0, 0, W, H);
    };
    // One painter for every layer: they are few and rarely overlap.
    lp.begin();
    for (const l of model.layers) {
      const k = layoutScale(l.layout.scale || model.scale, model.mapZoom, W, H);
      lp.paint(l.layout, l.values, model.fonts, { x: 0, y: 0, w: W, h: H, k }, { time: model.time, minimap: model.minimap });
    }
    lp.end();
    sp.begin();
    const sc = model.screen;
    this.screenK = 0;
    if (sc) {
      const k = layoutScale(sc.layout.scale || model.scale, model.mapZoom, W, H);
      dim(sp, sc.layout.screen.dim);
      sp.paint(sc.layout, sc.values, model.fonts, { x: 0, y: 0, w: W, h: H, k }, { focus: sc.focus, time: model.time, minimap: model.minimap, inventory: sc.inventory });
      this.screenK = k;
    }
    sp.end();
  }

  viewSize(layout: UiLayout): { w: number; h: number } {
    const { W, H } = this.screen();
    const k = layoutScale(layout.scale || this.pending?.scale || 0, this.pending?.mapZoom ?? 0, W, H);
    return { w: Math.floor(W / k), h: Math.floor(H / k) };
  }

  setScreenPointer(handler: (type: "move" | "down", x: number, y: number) => void): () => void {
    this.pointerHandler = handler;
    return () => {
      if (this.pointerHandler === handler) this.pointerHandler = null;
    };
  }

  /** Notes in boxes above the bottom elements, newest at the bottom. */
  private drawMessages(model: HudModel, L: Painted, k: number, font: string): void {
    if (model.messages.length === 0) return;
    const g = this.painter!.graphics;
    const { W } = this.screen();
    const boxW = Math.min(W - 16 * k, 240 * k);
    const x = Math.round((W - boxW) / 2);
    let bottom = L.bottomEdge * k - 6 * k;
    for (let i = model.messages.length - 1; i >= 0; i--) {
      const m = model.messages[i];
      const t = this.painter!.text(m.text, font, 8, "#ffffff", boxW - 12 * k);
      const h = t.height + 8 * k;
      const top = bottom - h;
      if (top < L.topEdge * k) {
        t.setVisible(false);
        break;
      }
      const a = Math.min(1, m.remainingMs / 300);
      g.fillStyle(MSG_FILL, 0.92 * a).fillRect(x, top, boxW, h);
      g.lineStyle(k, MSG_BORDER, a).strokeRect(x + k / 2, top + k / 2, boxW - k, h - k);
      t.setPosition(x + 6 * k, top + 4 * k);
      t.setAlpha(a);
      bottom = top - 3 * k;
    }
  }

  /** The inventory panel (I) under the top elements: the theme's panel and cursor pictures, or built-in. */
  private drawInventory(model: HudModel, L: Painted, k: number, font: string): void {
    const p = this.painter!;
    const g = p.graphics;
    const theme = model.layout.theme;
    const pw = Math.min(L.viewW - 16, 200);
    const ph = Math.min(L.bottomEdge - L.topEdge - 8, 120);
    const px = Math.round((L.viewW - pw) / 2);
    const py = L.topEdge + 4;
    const own = p.panel(theme.panel, theme.panelSlice, { x: px, y: py, w: pw, h: ph });
    // Content inset: clear of the panel picture's border.
    const pad = own ? Math.max(6, theme.panelSlice + 3) : 6;
    if (!own) {
      g.fillStyle(MSG_FILL, 0.95).fillRect(px * k, py * k, pw * k, ph * k);
      g.lineStyle(k, MSG_BORDER, 1).strokeRect(px * k + k / 2, py * k + k / 2, pw * k - k, ph * k - k);
    }
    p.text(model.inventoryTitle, font, 8, theme.textColor).setPosition((px + pad) * k, (py + pad - 2) * k);
    const cell = 22;
    const perRow = Math.max(1, Math.floor((pw - 2 * pad) / cell));
    let desc = model.inventory.length === 0 ? "" : " ";
    model.inventory.forEach((slot, i) => {
      const ix = px + pad + (i % perRow) * cell;
      const iy = py + pad + 12 + Math.floor(i / perRow) * cell;
      if (slot.selected) {
        // Under the icon: a highlight or a frame with an open middle.
        if (!p.panel(theme.cursor, 0, { x: ix, y: iy, w: 20, h: 20 })) g.lineStyle(k, 0xffd23a, 1).strokeRect(ix * k, iy * k, 20 * k, 20 * k);
        desc = `${slot.name}${slot.count !== null ? ` (${slot.count})` : ""}\n${slot.description}`;
      }
      p.icon(slot.icon, ix + 2, iy + 2, 16);
    });
    if (desc.trim()) {
      const t = p.text(desc, font, 7, "#ffffff", (pw - 2 * pad) * k);
      t.setPosition((px + pad) * k, (py + ph - pad + 2) * k - t.height);
    }
  }

  setDiagnostics(lines: string[] | null): void {
    this.diagLines = lines;
    this.renderDiagnostics();
  }

  private renderDiagnostics(): void {
    if (!this.diagText) return;
    const lines = this.diagLines;
    if (!lines) {
      this.diagText.setVisible(false);
      return;
    }
    const { W, H } = this.screen();
    const px = Math.max(10, Math.round(H / 60));
    this.diagText.setStyle({ fontFamily: "monospace", fontSize: `${px}px`, color: "#d0ffd0", backgroundColor: "#000000cc", wordWrap: { width: W - 8, useAdvancedWrap: true } });
    this.diagText.setText(lines.join("\n"));
    this.diagText.setPosition(4, H - 4);
    this.diagText.setVisible(true);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.game.scene?.bringToTop?.(HUD_SCENE_KEY);
    this.applyVisible();
  }

  private applyVisible(): void {
    this.scene?.sys?.setVisible?.(this.visible);
  }
}
