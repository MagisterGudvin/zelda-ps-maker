import type { ToolkitConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import type { HudModel, HudSink, MessageBoxModel, SheetPreview } from "./types.ts";
import { resolveTexture } from "./textures.ts";
import type { HudLayout } from "../ui/hudLayout.ts";
import { HudPainter, Pool } from "./hudPainter.ts";

export const HUD_SCENE_KEY = "ZeldaMakerToolkitHUD";

const HUDS = new WeakMap<object, PhaserHud>();
const MSG_FILL = 0x101030;
const MSG_BORDER = 0xf0f0f0;

/** One HUD per Phaser game, reused across maps (avoids duplicate HUD objects). */
export function getHud(game: any, cfg: ToolkitConfig, logger: Logger): PhaserHud {
  let hud = HUDS.get(game);
  if (!hud) {
    hud = new PhaserHud(game, cfg, logger);
    HUDS.set(game, hud);
  }
  return hud;
}

/**
 * Classic HUD (A Link to the Past style top bar) drawn in its own Phaser scene
 * above PS Maker's scenes: pixel digits and hearts scaled by a whole factor,
 * real-resolution text for labels and messages, and a layout computed by
 * `computeHudLayout` so elements never overlap.
 */
export class PhaserHud implements HudSink {
  private readonly game: any;
  private readonly cfg: ToolkitConfig;
  private readonly logger: Logger;
  private scene: any = null;
  private pending: HudModel | null = null;
  private visible = true;
  private g: any = null;
  private painter: HudPainter | null = null;
  private diagText: any = null;
  private diagLines: string[] | null = null;
  private preview: SheetPreview | null = null;
  private previewG: any = null;
  private previewImg: any = null;
  private previewLabels!: Pool;
  /** The dialogue box (Zelda: Message Style): background, picture slices, text. */
  private boxG: any = null;
  private boxText: any = null;
  private boxPics!: Pool;
  private panelPics!: Pool;
  private cursorImg: any = null;
  private boxWrap: { key: string; lines: string[] } | null = null;

  /** Use getHud(); direct construction would duplicate the HUD scene. */
  constructor(game: any, cfg: ToolkitConfig, logger: Logger) {
    this.game = game;
    this.cfg = cfg;
    this.logger = logger;
    this.ensureScene();
    // Fullscreen / window resize changes the screen size: lay everything out again.
    game.scale?.on?.("resize", () => {
      if (this.pending) this.render(this.pending);
      this.renderDiagnostics();
      this.renderPreview();
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
            self.build();
            if (self.pending) self.render(self.pending);
            self.renderDiagnostics();
            self.renderPreview();
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

  private build(): void {
    const s = this.scene;
    this.painter = new HudPainter(s, this.game, 0);
    this.painter.fontFamily = this.cfg.ui.fontFamily;
    this.g = this.painter.g;
    this.diagText = s.add.text(0, 0, "", { fontFamily: "monospace", color: "#d0ffd0", backgroundColor: "#000000cc" }).setOrigin(0, 1).setDepth(10).setVisible(false);
    this.previewG = s.add.graphics().setDepth(20);
    this.previewImg = s.add.image(0, 0, resolveTexture(s.textures, "pixel")).setOrigin(0, 0).setDepth(21).setVisible(false);
    this.previewLabels = new Pool(() => s.add.text(0, 0, "", { fontFamily: "monospace", color: "#ffff66", backgroundColor: "#000000aa" }).setOrigin(0, 0).setDepth(22));
    this.boxG = s.add.graphics().setDepth(15);
    this.boxPics = new Pool(() => s.add.image(0, 0, resolveTexture(s.textures, "pixel")).setOrigin(0, 0).setDepth(15));
    // Inventory panel picture: over the HUD bar, under the HUD's graphics and item icons.
    this.panelPics = new Pool(() => s.add.image(0, 0, resolveTexture(s.textures, "pixel")).setOrigin(0, 0).setDepth(-0.05));
    // Inventory cursor picture: under the item icons (a highlight or a frame with an open middle).
    this.cursorImg = s.add.image(0, 0, resolveTexture(s.textures, "pixel")).setOrigin(0, 0).setDepth(0.15).setVisible(false);
    this.boxText = s.add.text(0, 0, "", { fontFamily: "monospace" }).setOrigin(0, 0).setDepth(16).setVisible(false);
  }

  private screen(): { W: number; H: number } {
    return { W: this.game.scale?.width ?? this.game.config?.width ?? 320, H: this.game.scale?.height ?? this.game.config?.height ?? 240 };
  }

  private text(value: string, x: number, y: number, px: number, color: string, opts: Record<string, unknown> = {}): any {
    return this.painter!.text(value, x, y, px, color, opts);
  }

  private pixelImage(id: string, x: number, y: number, k: number, size?: number): void {
    this.painter!.pixelImage(id, x, y, k, size);
  }

  render(model: HudModel): void {
    this.pending = model;
    if (!this.scene || !this.scene.sys?.displayList || !this.painter) return;
    const { W, H } = this.screen();
    const painter = this.painter;
    painter.begin();
    const L = painter.paint(model, { x: 0, y: 0, w: W, h: H });
    const k = L.k;

    this.drawMessages(model, L);
    this.drawBox(model.box, model, L);
    if (model.dead) {
      const t = this.text(model.deathText, 0, 0, 10 * k, "#ffffff");
      t.setPosition(Math.round(W / 2 - t.width / 2), Math.round(H / 2 - t.height / 2));
    }
    this.panelPics.begin();
    this.cursorImg?.setVisible(false);
    if (model.inventoryOpen) this.drawInventory(model, L);
    this.panelPics.end();
    painter.end();
  }

  /** Classic dialogue-style boxes in the free area, newest at the bottom. */
  private drawMessages(model: HudModel, L: HudLayout): void {
    if (model.messages.length === 0) return;
    const k = L.k;
    const { W } = this.screen();
    const boxW = Math.min(W - 16 * k, 240 * k);
    const x = Math.round((W - boxW) / 2);
    let bottom = (L.free.y + L.free.h) * k - 6 * k;
    for (let i = model.messages.length - 1; i >= 0; i--) {
      const m = model.messages[i];
      const t = this.text(m.text, 0, 0, 8 * k, "#ffffff", { wordWrap: { width: boxW - 12 * k, useAdvancedWrap: true } });
      const h = t.height + 8 * k;
      const top = bottom - h;
      if (top < L.free.y * k) {
        t.setVisible(false);
        break;
      }
      const a = Math.min(1, m.remainingMs / 300);
      this.g.fillStyle(MSG_FILL, 0.92 * a).fillRect(x, top, boxW, h);
      this.g.lineStyle(k, MSG_BORDER, a).strokeRect(x + k / 2, top + k / 2, boxW - k, h - k);
      t.setPosition(x + 6 * k, top + 4 * k);
      t.setAlpha(a);
      bottom = top - 3 * k;
    }
  }

  /**
   * The toolkit's dialogue box, drawn like a PS Maker dialogue layout: its size and padding in the
   * game's logical UI pixels scaled to the screen, a colour background with border and rounded
   * corners or a picture (9-slice: the corners drawn at the border width, as NineSliceBackground),
   * the layout's text style. The text is wrapped once, so typing never moves words between lines.
   */
  private drawBox(box: MessageBoxModel | null, model: HudModel, L: HudLayout): void {
    const g = this.boxG;
    if (!g) return;
    g.clear();
    this.boxPics.begin();
    if (!box) {
      this.boxPics.end();
      this.boxText.setVisible(false);
      return;
    }
    const st = box.style;
    const { W, H } = this.screen();
    const f = Math.min(W / st.logicalW, H / st.logicalH);
    const w = Math.round(Math.min(st.width * f, W - 16));
    const h = Math.round(st.height * f);
    const x = Math.round((W - w) / 2);
    const k = L.k;
    const barTop = L.bar.y * k;
    const barBottom = (L.bar.y + L.bar.h) * k;
    const y = Math.round(box.position === "top" ? (model.position === "top" ? barBottom : 0) + st.gap * f : (model.position === "bottom" ? barTop : H) - st.gap * f - h);

    const bg = st.background;
    if (bg.type === "plain") {
      const fill = hexColor(bg.color);
      const r = Math.min(bg.borderRadius * f, h / 2, w / 2);
      g.fillStyle(fill.color, fill.alpha * (bg.opacity / 100)).fillRoundedRect(x, y, w, h, r);
      const bw = bg.borderWidth * f;
      if (bw > 0) {
        const line = hexColor(bg.borderColor);
        g.lineStyle(bw, line.color, line.alpha).strokeRoundedRect(x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(0, r - bw / 2));
      }
    } else if (this.painter!.picSize(bg.imageId)) {
      this.drawBoxPicture(this.boxPics, bg, x, y, w, h, f);
    }

    const t = st.text;
    const pad = st.padding;
    const wrapW = Math.max(10, w - (pad.left + pad.right) * f);
    const px = Math.max(6, Math.round(t.size * f));
    this.boxText.setStyle({ fontFamily: t.fontFamily, fontSize: `${px}px`, color: t.color, align: t.align, fontStyle: "normal", wordWrap: { width: wrapW, useAdvancedWrap: true } });
    this.boxText.setLineSpacing?.(Math.round(px * (t.lineHeight / 100 - 1)));
    this.boxText.setStroke?.(t.strokeColor, t.strokeWidth * f);
    const key = `${box.text}|${wrapW}|${px}|${t.fontFamily}`;
    if (this.boxWrap?.key !== key) {
      const wrapped = typeof this.boxText.getWrappedText === "function" ? this.boxText.getWrappedText(box.text) : null;
      this.boxWrap = { key, lines: Array.isArray(wrapped) ? wrapped : [box.text] };
    }
    let left = box.shown;
    const shown: string[] = [];
    for (const line of this.boxWrap.lines) {
      if (left <= 0) break;
      shown.push(line.slice(0, left));
      left -= line.length + 1;
    }
    this.boxText.setText(shown.join("\n"));
    this.boxText.setPosition(x + pad.left * f, y + pad.top * f).setVisible(true);

    // "More" caret, blinking, while the box waits for the action key.
    if (box.waiting && Math.floor(Date.now() / 400) % 2 === 0) {
      const c = hexColor(st.caretColor);
      const size = Math.max(4, px * 0.45);
      const cx = x + w - pad.right * f - size;
      const cy = y + h - pad.bottom * f - size * 0.8;
      g.fillStyle(c.color, c.alpha).fillTriangle(cx, cy, cx + size, cy, cx + size / 2, cy + size * 0.8);
    }
    this.boxPics.end();
  }

  private drawBoxPicture(pics: Pool, bg: Extract<MessageBoxModel["style"]["background"], { type: "image" }>, x: number, y: number, w: number, h: number, f: number): void {
    const key = bg.imageId;
    const size = this.painter!.picSize(key)!;
    const alpha = Math.max(0, Math.min(1, bg.opacity / 100));
    const put = (frame: string | undefined, dx: number, dy: number, dw: number, dh: number) => {
      if (dw <= 0 || dh <= 0) return;
      const img = pics.next();
      if (frame) img.setTexture(key, frame);
      else img.setTexture(key);
      img.setScale(1).setPosition(Math.round(dx), Math.round(dy)).setDisplaySize(Math.round(dw), Math.round(dh)).setAlpha(alpha);
    };
    if (bg.mode === "stretch") return put(undefined, x, y, w, h);
    if (bg.mode === "fit") {
      const s = Math.min(w / size.w, h / size.h);
      return put(undefined, x + (w - size.w * s) / 2, y + (h - size.h * s) / 2, size.w * s, size.h * s);
    }
    const sl = bg.slice;
    const L = Math.max(0, Math.min(sl.left, size.w));
    const R = Math.max(0, Math.min(sl.right, size.w - L));
    const T = Math.max(0, Math.min(sl.top, size.h));
    const B = Math.max(0, Math.min(sl.bottom, size.h - T));
    const want = Math.max(0, bg.borderWidth * f);
    const b = Math.round(want * Math.min(1, want > 0 ? w / (want * 2) : 1, want > 0 ? h / (want * 2) : 1));
    const sx = [0, L, size.w - R];
    const sw = [L, size.w - L - R, R];
    const sy = [0, T, size.h - B];
    const sh = [T, size.h - T - B, B];
    const dx = [x, x + b, x + w - b];
    const dw = [b, w - 2 * b, b];
    const dy = [y, y + b, y + h - b];
    const dh = [b, h - 2 * b, b];
    const tex = this.scene.textures.get(key);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (sw[col] <= 0 || sh[row] <= 0) continue;
        const name = `zmt9_${L}_${T}_${R}_${B}_${row * 3 + col}`;
        if (!tex.has?.(name)) tex.add?.(name, 0, sx[col], sy[row], sw[col], sh[row]);
        put(name, dx[col], dy[row], dw[col], dh[row]);
      }
    }
  }

  private drawInventory(model: HudModel, L: HudLayout): void {
    const k = L.k;
    const { W } = this.screen();
    const pw = Math.min(W - 16 * k, 200 * k);
    const ph = Math.min(L.free.h * k - 8 * k, 120 * k);
    const px = Math.round((W - pw) / 2);
    const py = Math.round(L.free.y * k + 4 * k);
    const g = this.g;
    const skin = model.skin;
    const ownPanel = !!this.painter!.picSize(skin.inventoryPanel);
    // Content inset (HUD pixels): clear of the panel picture's border.
    const pad = ownPanel ? Math.max(6, model.panelSlice + 3) : 6;
    if (ownPanel) {
      // Own panel picture (HUD Style → Inventory panel): a 9-slice whose border is drawn in HUD pixels.
      const sl = model.panelSlice;
      this.drawBoxPicture(this.panelPics, { type: "image", imageId: skin.inventoryPanel, opacity: 100, mode: "nine-slice", borderWidth: sl, slice: { top: sl, right: sl, bottom: sl, left: sl } }, px, py, pw, ph, k);
    } else {
      g.fillStyle(MSG_FILL, 0.95).fillRect(px, py, pw, ph);
      g.lineStyle(k, MSG_BORDER, 1).strokeRect(px + k / 2, py + k / 2, pw - k, ph - k);
    }
    const cursor = this.painter!.picSize(skin.inventoryCursor);
    this.text(model.inventoryTitle, px + pad * k, py + (pad - 2) * k, 8 * k, model.textColor);
    const cell = 22;
    const perRow = Math.max(1, Math.floor((pw / k - 2 * pad) / cell));
    let desc = model.inventory.length === 0 ? "" : " ";
    model.inventory.forEach((slot, i) => {
      const ix = px / k + pad + (i % perRow) * cell;
      const iy = py / k + pad + 12 + Math.floor(i / perRow) * cell;
      this.pixelImage(slot.icon, ix + 2, iy + 2, k, 16);
      if (slot.selected) {
        if (cursor) this.cursorImg?.setTexture(skin.inventoryCursor).setScale(1).setPosition(ix * k, iy * k).setDisplaySize(20 * k, 20 * k).setVisible(true);
        else g.lineStyle(k, 0xffd23a, 1).strokeRect(ix * k, iy * k, 20 * k, 20 * k);
        desc = `${slot.name}${slot.count !== null ? ` (${slot.count})` : ""}\n${slot.description}`;
      }
    });
    if (desc.trim()) {
      const t = this.text(desc, px + pad * k, 0, 7 * k, "#ffffff", { wordWrap: { width: pw - 2 * pad * k, useAdvancedWrap: true } });
      t.setPosition(px + pad * k, py + ph - t.height - (pad - 2) * k);
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

  setSheetPreview(preview: SheetPreview | null): void {
    this.preview = preview;
    this.renderPreview();
  }

  /** Shows the whole sheet scaled to the screen with every frame number. */
  private renderPreview(): void {
    if (!this.previewG) return;
    this.previewG.clear();
    this.previewLabels.begin();
    const p = this.preview;
    if (!p || !this.scene.textures.exists(p.textureKey)) {
      this.previewImg.setVisible(false);
      this.previewLabels.end();
      return;
    }
    const { W, H } = this.screen();
    const src = this.scene.textures.get(p.textureKey).getSourceImage();
    const sw = src.width;
    const sh = src.height;
    const f = Math.min((W - 16) / sw, (H - 40) / sh);
    const scale = f >= 1 ? Math.floor(f) : f;
    const ox = Math.round((W - sw * scale) / 2);
    const oy = 32;
    this.previewG.fillStyle(0x000000, 0.9).fillRect(0, 0, W, H);
    this.previewImg.setTexture(p.textureKey, "__BASE").setPosition(ox, oy).setScale(scale).setVisible(true);
    const title = this.previewLabels.next();
    title.setStyle({ fontSize: "14px" });
    title.setText(`${p.title} — ${p.frameWidth}x${p.frameHeight}`).setPosition(8, 8);
    const stepX = p.frameWidth + p.spacing;
    const stepY = p.frameHeight + p.spacing;
    const cols = Math.floor((sw - 2 * p.margin + p.spacing) / stepX);
    const rows = Math.floor((sh - 2 * p.margin + p.spacing) / stepY);
    const font = `${Math.max(8, Math.min(14, Math.round((p.frameWidth * scale) / 4)))}px`;
    this.previewG.lineStyle(1, 0xffff66, 0.6);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ox + (p.margin + c * stepX) * scale;
        const y = oy + (p.margin + r * stepY) * scale;
        this.previewG.strokeRect(x, y, p.frameWidth * scale, p.frameHeight * scale);
        const t = this.previewLabels.next();
        t.setStyle({ fontSize: font });
        t.setText(String(r * cols + c)).setPosition(x + 1, y + 1);
      }
    }
    this.previewLabels.end();
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

/** "#rgb", "#rrggbb" or "#rrggbbaa" → Phaser colour and alpha (white when unreadable). */
export function hexColor(value: string): { color: number; alpha: number } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec((value ?? "").trim());
  if (!m) return { color: 0xffffff, alpha: 1 };
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return { color: parseInt(hex.slice(0, 6), 16), alpha: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 };
}
