import type { HudModel } from "./types.ts";
import { resolveTexture } from "./textures.ts";
import { computeHudLayout, type HudLayout, type HudMetrics, type Rect, type Size } from "../ui/hudLayout.ts";

const DIGIT_FRAME = "zmt_digit_";

/** Pool of game objects of one kind; unused ones are hidden, never re-created. */
export class Pool {
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
  destroy(): void {
    for (const o of this.items) o.destroy?.();
    this.items.length = 0;
    this.used = 0;
  }
}

/** Where and how big to paint: an area of the scene (screen or world pixels) and HUD pixels per scene pixel. */
export interface PaintArea {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Scene pixels per HUD pixel; omitted = the model's scale (0 = the map's zoom). */
  k?: number;
}

/**
 * Paints the toolkit HUD (bar, magic meter, item box, counters, hearts, LIFE label) with Phaser
 * objects of one scene: the HUD scene in the game (screen pixels), or the editor's map scene for
 * the preview in the game window frame (world pixels). Layout by computeHudLayout.
 */
export class HudPainter {
  readonly scene: any;
  private readonly game: any;
  private readonly depth: number;
  readonly g: any;
  readonly images: Pool;
  readonly texts: Pool;
  private bars: { key: string; slice: number; obj: any }[] = [];
  private readonly magicFill: any;
  private ox = 0;
  private oy = 0;
  fontFamily = "monospace";

  constructor(scene: any, game: any, depth = 0) {
    this.scene = scene;
    this.game = game;
    this.depth = depth;
    const s = scene;
    this.g = s.add.graphics().setDepth(depth);
    this.images = new Pool(() => s.add.image(0, 0, resolveTexture(s.textures, "pixel")).setOrigin(0, 0).setDepth(depth + 0.2));
    this.texts = new Pool(() => s.add.text(0, 0, "", { fontFamily: this.fontFamily }).setOrigin(0, 0).setDepth(depth + 0.3));
    this.magicFill = s.add.image(0, 0, resolveTexture(s.textures, "pixel")).setOrigin(0, 0).setDepth(depth + 0.1).setVisible(false);
  }

  begin(): void {
    this.g.clear();
    this.images.begin();
    this.texts.begin();
  }

  end(): void {
    this.images.end();
    this.texts.end();
  }

  destroy(): void {
    this.g.destroy?.();
    this.images.destroy();
    this.texts.destroy();
    this.magicFill.destroy?.();
    for (const b of this.bars) b.obj.destroy?.();
    this.bars = [];
  }

  /** Size of an own picture (a texture PS Maker loaded under the image id), or null. */
  picSize(key: string | undefined): Size | null {
    if (!key || !this.scene.textures.exists(key)) return null;
    const src = this.scene.textures.get(key)?.getSourceImage?.();
    return src && src.width > 0 && src.height > 0 ? { w: src.width, h: src.height } : null;
  }

  /** HUD picture sizes from the own pictures; the layout keeps the built-in ones for the rest. */
  metrics(skin: Record<string, string>, counters: string[]): Partial<HudMetrics> {
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

  /** The layout of a model in an area (the same the painter draws). */
  layout(model: HudModel, area: PaintArea): HudLayout {
    const zoom = Math.round(model.mapZoom || 0);
    return computeHudLayout({
      screenW: area.w,
      screenH: area.h,
      scale: model.scale > 0 ? model.scale : zoom,
      exactScale: area.k,
      position: model.position,
      safeArea: model.safeArea,
      showMagic: model.showMagic,
      showItem: model.showItem,
      showHearts: model.showHearts,
      counters: model.counters.map((c) => c.digits),
      hearts: Math.ceil(model.maxHp / Math.max(1, model.heartValue)),
      metrics: this.metrics(model.skin, model.counters.map((c) => c.id)),
      showLifeLabel: model.showLifeLabel,
      places: model.places,
    });
  }

  /** Paints the HUD parts; returns the layout (messages and panels use its free area). */
  paint(model: HudModel, area: PaintArea): HudLayout {
    this.ox = area.x;
    this.oy = area.y;
    this.fontFamily = model.fontFamily;
    const L = this.layout(model, area);
    const skin = model.skin;
    const k = L.k;
    const anyPart = !!(L.magic || L.item || L.counters.length || L.hearts.length);
    this.drawBars(anyPart ? skin.bar : undefined, model.barSlice, L.panels, k);
    if (L.magic) this.drawMagic(L.magic, k, model.maxMagic > 0 ? model.magic / model.maxMagic : 0, skin);
    else this.magicFill.setVisible(false);
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
      const t = this.text(model.lifeLabel, 0, 0, 7 * k, model.textColor);
      t.setPosition(Math.round(this.ox + (L.lifeLabel.x + L.lifeLabel.w / 2) * k - t.width / 2), Math.round(this.oy + L.lifeLabel.y * k - k));
    }
    L.hearts.forEach((h, n) => {
      const value = Math.max(0, Math.min(model.heartValue, model.hp - n * model.heartValue));
      const state = value >= model.heartValue ? "full" : value > 0 ? "half" : "empty";
      const own = state === "full" ? skin.heartFull : state === "half" ? skin.heartHalf || skin.heartFull : skin.heartEmpty;
      if (!this.fitPic(own, h, k)) this.pixelImage(`hud_heart8_${state}`, h.x, h.y, k);
    });
    this.ox = 0;
    this.oy = 0;
    return L;
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
    img.setPosition(Math.round(this.ox + (r.x + (r.w - w * f) / 2) * k), Math.round(this.oy + (r.y + (r.h - h * f) / 2) * k));
    return true;
  }

  /** The backgrounds behind the HUD (the band or one per placed part): own picture as a 9-slice (WebGL) or stretched. */
  private drawBars(key: string | undefined, slice: number, rects: Rect[], k: number): void {
    const size = this.picSize(key);
    const want = size && key ? rects.length : 0;
    while (this.bars.length > want || this.bars.some((b) => b.key !== key || b.slice !== slice)) this.bars.pop()!.obj.destroy();
    if (!size || !key) return;
    const s = this.scene;
    const sl = Math.max(0, Math.min(Math.floor(slice), Math.floor(size.w / 2) - 1, Math.floor(size.h / 2) - 1));
    const webgl = this.game?.renderer?.type === 2;
    while (this.bars.length < want) {
      const obj = webgl && typeof s.add.nineslice === "function" && sl > 0 ? s.add.nineslice(0, 0, key, undefined, size.w, size.h, sl, sl, sl, sl) : s.add.image(0, 0, key);
      obj.setOrigin(0, 0).setDepth(this.depth - 0.1);
      this.bars.push({ key, slice, obj });
    }
    rects.forEach((r, i) => {
      const o = this.bars[i].obj;
      o.setVisible(true).setPosition(this.ox + r.x * k, this.oy + r.y * k);
      if (typeof o.setSize === "function" && o.type === "NineSlice") o.setSize(r.w, r.h).setScale(k);
      else o.setScale((r.w * k) / size.w, (r.h * k) / size.h);
    });
  }

  private drawMagic(r: Rect, k: number, frac: number, skin: Record<string, string>): void {
    const g = this.g;
    const f = Math.max(0, Math.min(1, frac));
    const X = this.ox + r.x * k;
    const Y = this.oy + r.y * k;
    if (!this.fitPic(skin.magicFrame, r, k)) {
      g.fillStyle(0x000000, 0.85).fillRect(X, Y, r.w * k, r.h * k);
      g.lineStyle(k, 0xf0f0e0, 1).strokeRect(X + k / 2, Y + k / 2, r.w * k - k, r.h * k - k);
    }
    const fill = this.picSize(skin.magicFill);
    if (fill) {
      // The fill picture over the frame, cut from the top as magic is spent.
      const cut = Math.round(fill.h * (1 - f));
      this.magicFill.setTexture(skin.magicFill).setVisible(f > 0).setScale((r.w * k) / fill.w, (r.h * k) / fill.h).setPosition(X, Y).setCrop(0, cut, fill.w, fill.h - cut);
      return;
    }
    this.magicFill.setVisible(false);
    const inner = (r.h - 4) * f;
    g.fillStyle(0x3ad16b, 1).fillRect(X + 2 * k, Y + (r.h - 2 - inner) * k, (r.w - 4) * k, inner * k);
  }

  private drawItemBox(r: Rect, k: number, model: HudModel): void {
    if (!this.fitPic(model.skin.itemBox, r, k)) {
      const g = this.g;
      const X = this.ox + r.x * k;
      const Y = this.oy + r.y * k;
      g.fillStyle(0x000000, 0.8).fillRect(X, Y, r.w * k, r.h * k);
      g.lineStyle(k, 0xf0f0e0, 1).strokeRect(X + k / 2, Y + k / 2, r.w * k - k, r.h * k - k);
      g.lineStyle(k, 0x6070c0, 1).strokeRect(X + k + k / 2, Y + k + k / 2, (r.w - 2) * k - k, (r.h - 2) * k - k);
    }
    if (!model.activeItem) return;
    const size = Math.max(8, Math.min(r.w, r.h) - 6);
    this.pixelImage(model.activeItem.icon, r.x + (r.w - size) / 2, r.y + (r.h - size) / 2, k, size);
  }

  private tex(id: string): string {
    return resolveTexture(this.scene.textures, id) ?? resolveTexture(this.scene.textures, "icon_generic")!;
  }

  /** Places a pixel texture in HUD pixels (k = scene pixels per HUD pixel). */
  pixelImage(id: string, x: number, y: number, k: number, size?: number): void {
    const img = this.images.next();
    img.setTexture(this.tex(id));
    if (size !== undefined) {
      const w = img.width || size;
      const h = img.height || size;
      const f = Math.min(size / w, size / h);
      img.setScale(f * k);
      img.setPosition(this.ox + (x + (size - w * f) / 2) * k, this.oy + (y + (size - h * f) / 2) * k);
    } else {
      img.setScale(k);
      img.setPosition(this.ox + x * k, this.oy + y * k);
    }
  }

  /** A text at scene pixels (font size px). */
  text(value: string, x: number, y: number, px: number, color: string, opts: Record<string, unknown> = {}): any {
    const t = this.texts.next();
    t.setStyle({ fontFamily: this.fontFamily, fontSize: `${Math.max(1, Math.round(px))}px`, color, fontStyle: "bold", ...opts });
    t.setShadow(1, 1, "#000000", 0, false, true);
    // Pooled texts: a fading message may have left its alpha on this one.
    t.setAlpha(1);
    t.setText(value);
    t.setOrigin(0, 0);
    t.setPosition(Math.round(x), Math.round(y));
    return t;
  }
}
