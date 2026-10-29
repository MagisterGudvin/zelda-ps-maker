import { resolveTexture } from "./textures.ts";
import { anchorPoint, isShown, textWithValues, type Box, type LayoutValues, type UiElement, type UiLayout } from "../ui/uiLayout.ts";

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

/** Where to paint: an area of the scene (screen or world pixels) and scene pixels per layout pixel. */
export interface PaintArea {
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
}

/** What a paint produced: each shown element's box (layout pixels) and the size of the game window. */
export interface Painted {
  boxes: Record<string, Box>;
  viewW: number;
  viewH: number;
  /** Lowest edge of the elements at the top and highest edge of those at the bottom (free area between). */
  topEdge: number;
  bottomEdge: number;
}

/** Layout pixels per screen pixel: the layout's scale, else the map's zoom, else the largest whole scale for 256×224. */
export function layoutScale(scale: number, mapZoom: number, screenW: number, screenH: number): number {
  if (scale > 0) return Math.round(scale);
  if (mapZoom > 0) return Math.max(1, Math.round(mapZoom));
  return Math.max(1, Math.floor(Math.min(screenW / 256, screenH / 224)));
}

const COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
function color(value: string, fallback: string): { c: number; a: number } {
  const m = COLOR.exec((value || fallback).trim()) ?? COLOR.exec(fallback)!;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("");
  return { c: parseInt(hex.slice(0, 6), 16), a: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 };
}

/**
 * Paints a UI layout with Phaser objects (pooled): the HUD in the game and the designer's board in
 * the editor draw the same way. Values come in already computed.
 */
export class LayoutPainter {
  private readonly scene: any;
  private readonly g: any;
  /** Over the pictures (a selected button's frame). */
  private readonly fg: any;
  private readonly images: Pool;
  private readonly texts: Pool;
  private ox = 0;
  private oy = 0;
  private k = 1;

  /** `textResolution` > 1 keeps small texts sharp under a zoomed camera (the editor's map). */
  constructor(scene: any, depth = 0, textResolution = 1) {
    this.scene = scene;
    const s = scene;
    this.g = s.add.graphics().setDepth(depth);
    this.fg = s.add.graphics().setDepth(depth + 0.15);
    this.images = new Pool(() => s.add.image(0, 0, resolveTexture(s.textures, "pixel")).setOrigin(0, 0).setDepth(depth + 0.1));
    this.texts = new Pool(() => {
      const t = s.add.text(0, 0, "", { fontFamily: "monospace" }).setOrigin(0, 0).setDepth(depth + 0.2);
      if (textResolution > 1) t.setResolution?.(textResolution);
      return t;
    });
  }

  /** Graphics of this painter (also for what the HUD draws around the layout). */
  get graphics(): any {
    return this.g;
  }

  begin(): void {
    this.g.clear();
    this.fg.clear();
    this.images.begin();
    this.texts.begin();
  }

  end(): void {
    this.images.end();
    this.texts.end();
  }

  destroy(): void {
    this.g.destroy?.();
    this.fg.destroy?.();
    this.images.destroy();
    this.texts.destroy();
  }

  /** Size of a picture (a project image or a built-in sprite), or null. */
  picSize(key: string): { w: number; h: number } | null {
    const k = key ? resolveTexture(this.scene.textures, key) : null;
    if (!k) return null;
    const src = this.scene.textures.get?.(k)?.getSourceImage?.();
    return src && src.width > 0 && src.height > 0 ? { w: src.width, h: src.height } : null;
  }

  /** `focus`: the selected button of a screen (drawn with its selected look). */
  paint(layout: UiLayout, values: LayoutValues, fonts: Record<string, string>, area: PaintArea, focus = ""): Painted {
    this.ox = area.x;
    this.oy = area.y;
    this.k = area.k;
    const viewW = Math.floor(area.w / area.k);
    const viewH = Math.floor(area.h / area.k);
    const out: Painted = { boxes: {}, viewW, viewH, topEdge: 0, bottomEdge: viewH };
    for (const e of layout.elements) {
      if (!isShown(e, values)) continue;
      const p = anchorPoint(e.anchor, viewW, viewH);
      const box = this.element(e, { x: p.x + e.x, y: p.y + e.y, w: e.w, h: e.h }, values, fonts, layout, e.id === focus);
      out.boxes[e.id] = box;
      if (box.y + box.h <= viewH / 2) out.topEdge = Math.max(out.topEdge, box.y + box.h);
      else if (box.y >= viewH / 2) out.bottomEdge = Math.min(out.bottomEdge, box.y);
    }
    return out;
  }

  private element(e: UiElement, b: Box, values: LayoutValues, fonts: Record<string, string>, layout: UiLayout, focused: boolean): Box {
    switch (e.type) {
      case "image":
        if (!this.picture(e.image, b, e.mode, e.slice) && e.color) this.rect(b, color(e.color, "#000000"));
        return b;
      case "text": {
        const family = fonts[e.font || layout.theme.font] ?? "monospace";
        const t = this.text(textWithValues(e.text, values), family, e.size, e.color || layout.theme.textColor);
        const x = e.align === "center" ? b.x + (b.w - t.width / this.k) / 2 : e.align === "right" ? b.x + b.w - t.width / this.k : b.x;
        t.setPosition(Math.round(this.ox + x * this.k), Math.round(this.oy + b.y * this.k));
        return b;
      }
      case "bar":
        this.bar(e, b, values);
        return b;
      case "hearts":
        return this.hearts(e, b, values);
      case "counter":
        return this.counter(e, b, values);
      case "item":
        this.item(e, b, values);
        return b;
      case "button":
        this.button(e, b, values, fonts, layout, focused);
        return b;
    }
  }

  /** A button: its picture (the selected one while focused) or colour, a gold frame when selected without a selected picture, its text centred. */
  private button(e: Extract<UiElement, { type: "button" }>, b: Box, values: LayoutValues, fonts: Record<string, string>, layout: UiLayout, focused: boolean): void {
    const pic = focused && e.hover ? e.hover : e.image;
    const mode = e.slice > 0 ? "nine" : "stretch";
    const drawn = this.picture(pic, b, mode, e.slice);
    if (!drawn) this.rect(b, color(focused ? e.hoverColor : e.color, "#1f1a24e6"));
    // Selected without a picture of its own for it: a gold frame shows the selection.
    if (focused && !(drawn && e.hover)) this.fg.lineStyle(this.k, 0xffd23a, 1).strokeRect(this.sx(b.x) + this.k / 2, this.sy(b.y) + this.k / 2, b.w * this.k - this.k, b.h * this.k - this.k);
    if (!e.text) return;
    const family = fonts[e.font || layout.theme.font] ?? "monospace";
    const t = this.text(textWithValues(e.text, values), family, e.size, e.textColor || layout.theme.textColor);
    t.setPosition(Math.round(this.sx(b.x) + (b.w * this.k - t.width) / 2), Math.round(this.sy(b.y) + (b.h * this.k - t.height) / 2));
  }

  private sx(x: number): number {
    return this.ox + x * this.k;
  }

  private sy(y: number): number {
    return this.oy + y * this.k;
  }

  private rect(b: Box, c: { c: number; a: number }): void {
    this.g.fillStyle(c.c, c.a).fillRect(this.sx(b.x), this.sy(b.y), b.w * this.k, b.h * this.k);
  }

  /** A picture over a box: stretched, 9-slice or fitted. False when the picture is missing. */
  private picture(key: string, b: Box, mode: "stretch" | "nine" | "fit", slice = 0): boolean {
    const size = this.picSize(key);
    if (!size) return false;
    const tex = resolveTexture(this.scene.textures, key)!;
    if (mode === "nine" && slice > 0) {
      this.nineSlice(tex, size, slice, b);
      return true;
    }
    const img = this.images.next().setTexture(tex).setCrop().setAlpha(1);
    if (mode === "fit") {
      const f = Math.min(b.w / size.w, b.h / size.h);
      img.setScale(f * this.k).setPosition(Math.round(this.sx(b.x + (b.w - size.w * f) / 2)), Math.round(this.sy(b.y + (b.h - size.h * f) / 2)));
    } else img.setScale((b.w * this.k) / size.w, (b.h * this.k) / size.h).setPosition(this.sx(b.x), this.sy(b.y));
    return true;
  }

  private nineSlice(tex: string, size: { w: number; h: number }, slice: number, b: Box): void {
    const sl = Math.max(0, Math.min(slice, Math.floor(size.w / 2), Math.floor(size.h / 2)));
    const bw = Math.min(sl, b.w / 2, b.h / 2);
    const sx = [0, sl, size.w - sl];
    const sw = [sl, size.w - 2 * sl, sl];
    const sy = [0, sl, size.h - sl];
    const sh = [sl, size.h - 2 * sl, sl];
    const dx = [b.x, b.x + bw, b.x + b.w - bw];
    const dw = [bw, b.w - 2 * bw, bw];
    const dy = [b.y, b.y + bw, b.y + b.h - bw];
    const dh = [bw, b.h - 2 * bw, bw];
    const t = this.scene.textures.get(tex);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (sw[col] <= 0 || sh[row] <= 0 || dw[col] <= 0 || dh[row] <= 0) continue;
        const name = `zmt9_${sl}_${row * 3 + col}`;
        if (!t.has?.(name)) t.add?.(name, 0, sx[col], sy[row], sw[col], sh[row]);
        this.images
          .next()
          .setTexture(tex, name)
          .setCrop()
          .setAlpha(1)
          .setScale((dw[col] * this.k) / sw[col], (dh[row] * this.k) / sh[row])
          .setPosition(Math.round(this.sx(dx[col])), Math.round(this.sy(dy[row])));
      }
    }
  }

  /** A text at a font size in layout pixels (the plain fallback font is bold to stay readable). */
  text(value: string, family: string, size: number, fill: string, wrapW = 0): any {
    const t = this.texts.next();
    const px = Math.max(1, Math.round(size * this.k));
    t.setStyle({ fontFamily: family, fontSize: `${px}px`, color: fill || "#ffffff", fontStyle: family === "monospace" ? "bold" : "normal", ...(wrapW > 0 ? { wordWrap: { width: wrapW, useAdvancedWrap: true } } : { wordWrap: null }) });
    t.setShadow(1, 1, "#000000", 0, false, true);
    // Pooled texts: a fading note may have left its alpha on this one.
    t.setAlpha(1);
    t.setText(value);
    return t;
  }

  private bar(e: Extract<UiElement, { type: "bar" }>, b: Box, values: LayoutValues): void {
    const max = Number(values[e.max]) || 0;
    const f = max > 0 ? Math.max(0, Math.min(1, (Number(values[e.value]) || 0) / max)) : 0;
    const k = this.k;
    if (!this.picture(e.back, b, "stretch")) {
      this.rect(b, color(e.backColor, "#000000d9"));
      this.g.lineStyle(k, 0xf0f0e0, 1).strokeRect(this.sx(b.x) + k / 2, this.sy(b.y) + k / 2, b.w * k - k, b.h * k - k);
    }
    const fill = this.picSize(e.fill);
    if (fill) {
      // The fill picture over the back, cut from the empty side.
      const img = this.images.next().setTexture(resolveTexture(this.scene.textures, e.fill)!).setAlpha(1);
      img.setScale((b.w * k) / fill.w, (b.h * k) / fill.h).setPosition(this.sx(b.x), this.sy(b.y));
      const cw = Math.round(fill.w * f);
      const ch = Math.round(fill.h * f);
      if (e.dir === "up") img.setCrop(0, fill.h - ch, fill.w, ch);
      else if (e.dir === "down") img.setCrop(0, 0, fill.w, ch);
      else if (e.dir === "left") img.setCrop(fill.w - cw, 0, cw, fill.h);
      else img.setCrop(0, 0, cw, fill.h);
      img.setVisible(f > 0);
      return;
    }
    // Built-in fill: inside a 2-pixel frame.
    const inner = { x: b.x + 2, y: b.y + 2, w: Math.max(0, b.w - 4), h: Math.max(0, b.h - 4) };
    const vertical = e.dir === "up" || e.dir === "down";
    const len = (vertical ? inner.h : inner.w) * f;
    const r = vertical ? { ...inner, y: e.dir === "up" ? inner.y + inner.h - len : inner.y, h: len } : { ...inner, x: e.dir === "left" ? inner.x + inner.w - len : inner.x, w: len };
    if (len > 0) this.rect(r, color(e.fillColor, "#3ad16b"));
  }

  private hearts(e: Extract<UiElement, { type: "hearts" }>, b: Box, values: LayoutValues): Box {
    const heart = Math.max(1, Number(values.heartValue) || 2);
    const hp = Number(values.health) || 0;
    const count = Math.max(0, Math.ceil((Number(values.maxHealth) || 0) / heart));
    const pics = { full: e.full || "hud_heart8_full", half: e.half || e.full || "hud_heart8_half", empty: e.empty || "hud_heart8_empty" };
    const cell = this.picSize(pics.full) ?? { w: 7, h: 7 };
    const rows = Math.max(1, Math.ceil(count / e.perRow));
    for (let n = 0; n < count; n++) {
      const v = Math.max(0, Math.min(heart, hp - n * heart));
      const key = v >= heart ? pics.full : v > 0 ? pics.half : pics.empty;
      const x = b.x + (n % e.perRow) * (cell.w + e.gap);
      const y = b.y + Math.floor(n / e.perRow) * (cell.h + e.gap);
      this.picture(key, { x, y, w: cell.w, h: cell.h }, "stretch");
    }
    return { x: b.x, y: b.y, w: Math.min(count || e.perRow, e.perRow) * (cell.w + e.gap) - e.gap, h: rows * (cell.h + e.gap) - e.gap };
  }

  private counter(e: Extract<UiElement, { type: "counter" }>, b: Box, values: LayoutValues): Box {
    const icon = this.picSize(e.icon) ?? { w: 8, h: 8 };
    const strip = e.digits ? this.digitFrames(e.digits) : null;
    const dw = strip ? strip.w + 1 : 6;
    const dh = strip ? strip.h : 8;
    const w = Math.max(icon.w, e.places * dw);
    this.picture(e.icon, { x: b.x + Math.floor((w - icon.w) / 2), y: b.y, w: icon.w, h: icon.h }, "stretch");
    const n = Math.max(0, Math.min(Math.floor(Number(values[e.value]) || 0), 10 ** e.places - 1));
    const digits = String(n).padStart(e.places, "0");
    const y = b.y + icon.h + 1;
    for (let d = 0; d < digits.length; d++) {
      const x = b.x + d * dw;
      if (strip) {
        this.images
          .next()
          .setTexture(resolveTexture(this.scene.textures, e.digits)!, `${DIGIT_FRAME}${digits[d]}`)
          .setCrop()
          .setAlpha(1)
          .setScale(this.k)
          .setPosition(this.sx(x), this.sy(y));
      } else this.picture(`hud_digit_${digits[d]}`, { x, y, w: 6, h: 8 }, "stretch");
    }
    return { x: b.x, y: b.y, w, h: icon.h + 1 + dh };
  }

  /** Frames 0-9 of a digit strip (ten equal digits in one row), or null. */
  private digitFrames(key: string): { w: number; h: number } | null {
    const size = this.picSize(key);
    if (!size) return null;
    const tex = this.scene.textures.get(resolveTexture(this.scene.textures, key)!);
    const w = Math.floor(size.w / 10);
    if (!tex.has?.(`${DIGIT_FRAME}0`)) for (let d = 0; d < 10; d++) tex.add?.(`${DIGIT_FRAME}${d}`, 0, d * w, 0, w, size.h);
    return tex.has?.(`${DIGIT_FRAME}0`) ? { w, h: size.h } : null;
  }

  private item(e: Extract<UiElement, { type: "item" }>, b: Box, values: LayoutValues): void {
    const k = this.k;
    if (!this.picture(e.frame, b, "fit")) {
      const X = this.sx(b.x);
      const Y = this.sy(b.y);
      this.g.fillStyle(0x000000, 0.8).fillRect(X, Y, b.w * k, b.h * k);
      this.g.lineStyle(k, 0xf0f0e0, 1).strokeRect(X + k / 2, Y + k / 2, b.w * k - k, b.h * k - k);
      this.g.lineStyle(k, 0x6070c0, 1).strokeRect(X + k + k / 2, Y + k + k / 2, (b.w - 2) * k - k, (b.h - 2) * k - k);
    }
    const icon = String(values["item.icon"] ?? "");
    if (!icon) return;
    const size = Math.max(8, Math.min(b.w, b.h) - 6);
    this.icon(icon, b.x + (b.w - size) / 2, b.y + (b.h - size) / 2, size);
  }

  /** An item icon fitted into a square (layout pixels); a placeholder when the picture is missing. */
  icon(key: string, x: number, y: number, size: number): void {
    if (!this.picture(key, { x, y, w: size, h: size }, "fit")) this.picture("icon_generic", { x, y, w: size, h: size }, "fit");
  }

  /** A picture as a 9-slice (or stretched) over a box in layout pixels; false when missing. */
  panel(key: string, slice: number, b: Box): boolean {
    return this.picture(key, b, slice > 0 ? "nine" : "stretch", slice);
  }
}
