import type { ToolkitConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import type { HudModel, HudSink, SheetPreview } from "./types.ts";
import { resolveTexture } from "./textures.ts";
import { computeHudLayout, type HudLayout, type HudMetrics, type Rect, type Size } from "../ui/hudLayout.ts";

export const HUD_SCENE_KEY = "ZeldaMakerToolkitHUD";

const HUDS = new WeakMap<object, PhaserHud>();
const MSG_FILL = 0x101030;
const MSG_BORDER = 0xf0f0f0;
const DIGIT_FRAME = "zmt_digit_";

/** One HUD per Phaser game, reused across maps (avoids duplicate HUD objects). */
export function getHud(game: any, cfg: ToolkitConfig, logger: Logger): PhaserHud {
  let hud = HUDS.get(game);
  if (!hud) {
    hud = new PhaserHud(game, cfg, logger);
    HUDS.set(game, hud);
  }
  return hud;
}

/** Pool of game objects of one kind; unused ones are hidden, never re-created. */
class Pool {
  private readonly items: any[] = [];
  private used = 0;
  private readonly make: () => any;
  constructor(make: () => any) {
    this.make = make;
  }
  begin(): void {
    this.used = 0;
  }
  next(): any {
    let o = this.items[this.used];
    if (!o) {
      o = this.make();
      this.items.push(o);
    }
    this.used++;
    o.setVisible(true);
    return o;
  }
  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i].setVisible(false);
  }
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
  private images!: Pool;
  private texts!: Pool;
  private diagText: any = null;
  private diagLines: string[] | null = null;
  private preview: SheetPreview | null = null;
  private previewG: any = null;
  private previewImg: any = null;
  private previewLabels!: Pool;
  /** Own bar picture (9-slice where the renderer supports it) and magic fill (cropped). */
  private bar: { key: string; slice: number; obj: any } | null = null;
  private magicFill: any = null;

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
    this.g = s.add.graphics();
    this.images = new Pool(() => s.add.image(0, 0, resolveTexture(s.textures, "pixel")).setOrigin(0, 0));
    this.texts = new Pool(() => s.add.text(0, 0, "", { fontFamily: this.cfg.ui.fontFamily }).setOrigin(0, 0));
    this.diagText = s.add.text(0, 0, "", { fontFamily: "monospace", color: "#d0ffd0", backgroundColor: "#000000cc" }).setOrigin(0, 1).setDepth(10).setVisible(false);
    this.previewG = s.add.graphics().setDepth(20);
    this.previewImg = s.add.image(0, 0, resolveTexture(s.textures, "pixel")).setOrigin(0, 0).setDepth(21).setVisible(false);
    this.previewLabels = new Pool(() => s.add.text(0, 0, "", { fontFamily: "monospace", color: "#ffff66", backgroundColor: "#000000aa" }).setOrigin(0, 0).setDepth(22));
    this.magicFill = s.add.image(0, 0, resolveTexture(s.textures, "pixel")).setOrigin(0, 0).setVisible(false);
  }

  /** Size of an own picture (a texture PS Maker loaded under the image id), or null. */
  private picSize(key: string | undefined): Size | null {
    if (!key || !this.scene.textures.exists(key)) return null;
    const src = this.scene.textures.get(key)?.getSourceImage?.();
    return src && src.width > 0 && src.height > 0 ? { w: src.width, h: src.height } : null;
  }

  /** HUD picture sizes from the own pictures; the layout keeps the built-in ones for the rest. */
  private metrics(skin: Record<string, string>, counters: string[]): Partial<HudMetrics> {
    const m: Partial<HudMetrics> = {};
    const heart = this.picSize(skin.heartFull) ?? this.picSize(skin.heartEmpty);
    if (heart) m.heart = heart;
    const icons = counters.map((c) => this.picSize(skin[c])).filter((x): x is Size => !!x);
    if (icons.length) m.icon = { w: Math.max(8, ...icons.map((i) => i.w)), h: Math.max(8, ...icons.map((i) => i.h)) };
    const digits = this.picSize(skin.digits);
    if (digits) m.digit = { w: Math.floor(digits.w / 10) + 1, h: digits.h };
    const item = this.picSize(skin.itemBox);
    if (item) m.item = item;
    const magic = this.picSize(skin.magicFrame) ?? this.picSize(skin.magicFill);
    if (magic) m.magic = magic;
    return m;
  }

  /** Frames 0-9 on a digit strip (ten equal digits in one row). */
  private digitFrames(key: string): boolean {
    const size = this.picSize(key);
    if (!size) return false;
    const tex = this.scene.textures.get(key);
    if (!tex.has?.(`${DIGIT_FRAME}0`)) {
      const w = Math.floor(size.w / 10);
      for (let d = 0; d < 10; d++) tex.add?.(`${DIGIT_FRAME}${d}`, 0, d * w, 0, w, size.h);
    }
    return !!tex.has?.(`${DIGIT_FRAME}0`);
  }

  /** An own picture fitted into a HUD rectangle (whole picture, centred), or false. */
  private fitPic(key: string | undefined, r: Rect, k: number, frame?: string): boolean {
    const size = this.picSize(key);
    if (!size || !key) return false;
    const w = frame ? (this.scene.textures.get(key).get(frame)?.width ?? size.w) : size.w;
    const h = frame ? (this.scene.textures.get(key).get(frame)?.height ?? size.h) : size.h;
    const f = Math.min(r.w / w, r.h / h);
    const img = this.images.next();
    if (frame) img.setTexture(key, frame);
    else img.setTexture(key);
    img.setScale(f * k);
    img.setPosition(Math.round((r.x + (r.w - w * f) / 2) * k), Math.round((r.y + (r.h - h * f) / 2) * k));
    return true;
  }

  /** The bar behind the HUD: own picture as a 9-slice (WebGL) or stretched. */
  private drawBar(key: string | undefined, slice: number, r: Rect, k: number): void {
    const size = this.picSize(key);
    if (!size || !key) {
      this.bar?.obj.setVisible(false);
      return;
    }
    if (!this.bar || this.bar.key !== key || this.bar.slice !== slice) {
      this.bar?.obj.destroy();
      const s = this.scene;
      const sl = Math.max(0, Math.min(Math.floor(slice), Math.floor(size.w / 2) - 1, Math.floor(size.h / 2) - 1));
      const webgl = this.game.renderer?.type === 2;
      const obj = webgl && typeof s.add.nineslice === "function" && sl > 0 ? s.add.nineslice(0, 0, key, undefined, size.w, size.h, sl, sl, sl, sl) : s.add.image(0, 0, key);
      obj.setOrigin(0, 0).setDepth(-1);
      this.bar = { key, slice, obj };
    }
    const o = this.bar.obj;
    o.setVisible(true).setPosition(r.x * k, r.y * k);
    if (typeof o.setSize === "function" && o.type === "NineSlice") o.setSize(r.w, r.h).setScale(k);
    else o.setScale((r.w * k) / size.w, (r.h * k) / size.h);
  }

  private tex(id: string): string {
    return resolveTexture(this.scene.textures, id) ?? resolveTexture(this.scene.textures, "icon_generic")!;
  }

  private screen(): { W: number; H: number } {
    return { W: this.game.scale?.width ?? this.game.config?.width ?? 320, H: this.game.scale?.height ?? this.game.config?.height ?? 240 };
  }

  /** Places a pixel texture in HUD pixels (k = whole scale factor). */
  private pixelImage(id: string, x: number, y: number, k: number, size?: number): void {
    const img = this.images.next();
    img.setTexture(this.tex(id));
    img.setPosition(x * k, y * k);
    if (size !== undefined) {
      const w = img.width || size;
      const h = img.height || size;
      const f = Math.min(size / w, size / h);
      img.setScale(f * k);
      img.setPosition((x + (size - w * f) / 2) * k, (y + (size - h * f) / 2) * k);
    } else {
      img.setScale(k);
    }
  }

  private text(value: string, x: number, y: number, px: number, color: string, opts: Record<string, unknown> = {}): any {
    const t = this.texts.next();
    t.setStyle({ fontFamily: this.cfg.ui.fontFamily, fontSize: `${Math.round(px)}px`, color, fontStyle: "bold", ...opts });
    t.setShadow(1, 1, "#000000", 0, false, true);
    t.setText(value);
    t.setOrigin(0, 0);
    t.setPosition(Math.round(x), Math.round(y));
    return t;
  }

  render(model: HudModel): void {
    this.pending = model;
    if (!this.scene || !this.scene.sys?.displayList || !this.g) return;
    const { W, H } = this.screen();
    const L = computeHudLayout({
      screenW: W,
      screenH: H,
      scale: model.scale,
      position: model.position,
      safeArea: model.safeArea,
      showMagic: model.showMagic,
      showItem: true,
      showHearts: model.showHearts,
      counters: model.counters.map((c) => c.digits),
      hearts: Math.ceil(model.maxHp / Math.max(1, model.heartValue)),
      metrics: this.metrics(model.skin, model.counters.map((c) => c.id)),
      showLifeLabel: model.showLifeLabel,
    });
    const skin = model.skin;
    const k = L.k;
    const g = this.g;
    g.clear();
    this.images.begin();
    this.texts.begin();

    this.drawBar(skin.bar, model.barSlice, L.bar, k);
    if (L.magic) this.drawMagic(L.magic, k, model.maxMagic > 0 ? model.magic / model.maxMagic : 0, skin);
    else this.magicFill?.setVisible(false);
    if (L.item) this.drawItemBox(L.item, k, model);
    const ownDigits = !!skin.digits && this.digitFrames(skin.digits);
    model.counters.forEach((c, i) => {
      const r = L.counters[i];
      if (!r) return;
      if (!this.fitPic(skin[c.id], r.icon, k)) this.pixelImage(c.icon, r.icon.x, r.icon.y, k, 8);
      const digits = String(Math.max(0, Math.min(c.value, 10 ** c.digits - 1))).padStart(c.digits, "0");
      const dw = r.digits.w / c.digits;
      for (let d = 0; d < digits.length; d++) {
        const cell = { x: r.digits.x + d * dw, y: r.digits.y, w: dw - (ownDigits ? 1 : 0), h: r.digits.h };
        if (!ownDigits || !this.fitPic(skin.digits, cell, k, `${DIGIT_FRAME}${digits[d]}`)) this.pixelImage(`hud_digit_${digits[d]}`, cell.x, cell.y, k);
      }
    });
    if (L.lifeLabel) {
      const t = this.text(model.lifeLabel, 0, 0, 7 * k, model.textColor, { fontFamily: model.fontFamily });
      t.setPosition(Math.round((L.lifeLabel.x + L.lifeLabel.w / 2) * k - t.width / 2), Math.round(L.lifeLabel.y * k - k));
    }
    L.hearts.forEach((h, n) => {
      const value = Math.max(0, Math.min(model.heartValue, model.hp - n * model.heartValue));
      const state = value >= model.heartValue ? "full" : value > 0 ? "half" : "empty";
      const own = state === "full" ? skin.heartFull : state === "half" ? (skin.heartHalf ?? skin.heartFull) : skin.heartEmpty;
      if (!this.fitPic(own, h, k)) this.pixelImage(`hud_heart8_${state}`, h.x, h.y, k);
    });

    this.drawMessages(model, L);
    if (model.dead) {
      const t = this.text(model.deathText, 0, 0, 10 * k, "#ffffff");
      t.setPosition(Math.round(W / 2 - t.width / 2), Math.round(H / 2 - t.height / 2));
    }
    if (model.inventoryOpen) this.drawInventory(model, L);
    this.images.end();
    this.texts.end();
  }

  private drawMagic(r: Rect, k: number, frac: number, skin: Record<string, string>): void {
    const g = this.g;
    const f = Math.max(0, Math.min(1, frac));
    const frame = this.fitPic(skin.magicFrame, r, k);
    if (!frame) {
      g.fillStyle(0x000000, 0.85).fillRect(r.x * k, r.y * k, r.w * k, r.h * k);
      g.lineStyle(k, 0xf0f0e0, 1).strokeRect(r.x * k + k / 2, r.y * k + k / 2, r.w * k - k, r.h * k - k);
    }
    const fill = this.picSize(skin.magicFill);
    if (fill && this.magicFill) {
      // The fill picture over the frame, cut from the top as magic is spent.
      const cut = Math.round(fill.h * (1 - f));
      this.magicFill.setTexture(skin.magicFill).setVisible(f > 0).setScale((r.w * k) / fill.w, (r.h * k) / fill.h).setPosition(r.x * k, r.y * k).setCrop(0, cut, fill.w, fill.h - cut);
      return;
    }
    this.magicFill?.setVisible(false);
    const inner = (r.h - 4) * f;
    g.fillStyle(0x3ad16b, 1).fillRect((r.x + 2) * k, (r.y + r.h - 2 - inner) * k, (r.w - 4) * k, inner * k);
  }

  private drawItemBox(r: Rect, k: number, model: HudModel): void {
    if (!this.fitPic(model.skin.itemBox, r, k)) {
      const g = this.g;
      g.fillStyle(0x000000, 0.8).fillRect(r.x * k, r.y * k, r.w * k, r.h * k);
      g.lineStyle(k, 0xf0f0e0, 1).strokeRect(r.x * k + k / 2, r.y * k + k / 2, r.w * k - k, r.h * k - k);
      g.lineStyle(k, 0x6070c0, 1).strokeRect((r.x + 1) * k + k / 2, (r.y + 1) * k + k / 2, (r.w - 2) * k - k, (r.h - 2) * k - k);
    }
    if (!model.activeItem) return;
    const size = Math.max(8, Math.min(r.w, r.h) - 6);
    this.pixelImage(model.activeItem.icon, r.x + (r.w - size) / 2, r.y + (r.h - size) / 2, k, size);
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

  private drawInventory(model: HudModel, L: HudLayout): void {
    const k = L.k;
    const { W } = this.screen();
    const pw = Math.min(W - 16 * k, 200 * k);
    const ph = Math.min(L.free.h * k - 8 * k, 120 * k);
    const px = Math.round((W - pw) / 2);
    const py = Math.round(L.free.y * k + 4 * k);
    const g = this.g;
    g.fillStyle(MSG_FILL, 0.95).fillRect(px, py, pw, ph);
    g.lineStyle(k, MSG_BORDER, 1).strokeRect(px + k / 2, py + k / 2, pw - k, ph - k);
    this.text(model.inventoryTitle, px + 6 * k, py + 4 * k, 8 * k, model.textColor);
    const cell = 22;
    const perRow = Math.max(1, Math.floor((pw / k - 12) / cell));
    let desc = model.inventory.length === 0 ? "" : " ";
    model.inventory.forEach((slot, i) => {
      const ix = px / k + 6 + (i % perRow) * cell;
      const iy = py / k + 18 + Math.floor(i / perRow) * cell;
      this.pixelImage(slot.icon, ix + 2, iy + 2, k, 16);
      if (slot.selected) {
        g.lineStyle(k, 0xffd23a, 1).strokeRect(ix * k, iy * k, 20 * k, 20 * k);
        desc = `${slot.name}${slot.count !== null ? ` (${slot.count})` : ""}\n${slot.description}`;
      }
    });
    if (desc.trim()) {
      const t = this.text(desc, px + 6 * k, 0, 7 * k, "#ffffff", { wordWrap: { width: pw - 12 * k, useAdvancedWrap: true } });
      t.setPosition(px + 6 * k, py + ph - t.height - 4 * k);
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
