import { resolveTexture } from "./textures.ts";
import {
  anchorPoint,
  barFillPolygon,
  clipPolygon,
  effectAt,
  isShown,
  shapePolygon,
  textWithValues,
  type Box,
  type InventoryCell,
  type LayoutValues,
  type MinimapData,
  type Point,
  type UiElement,
  type UiLayout,
} from "../ui/uiLayout.ts";

const DIGIT_FRAME = "zmt_digit_";
/** Depth between two elements: each element's graphics, pictures, texts and frame sit inside its step. */
const STEP = 0.005;

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

export interface PaintOptions {
  /** The selected button of a screen (drawn with its selected look). */
  focus?: string;
  /** Milliseconds, for effects (blink, pulse…). */
  time?: number;
  minimap?: MinimapData | null;
  /** Inventory grids: the owned items' cells and the cell under the cursor (-1 = no cursor). */
  inventory?: { cells: InventoryCell[]; cursor: number } | null;
  /** Choice lists: the answers and the selected one (none = the list is not drawn). */
  choices?: { items: string[]; cursor: number } | null;
  /** Key bindings: a row per action (name, key, pad button), the selected cell, waiting for a new key. */
  keybinds?: KeybindsData | null;
}

/** What a key bindings element shows (computed by the HUD). */
export interface KeybindsData {
  rows: { action: string; label: string; key: string; pad: string }[];
  row: number;
  /** 0 = the key column, 1 = the gamepad column. */
  col: number;
  waiting: boolean;
  waitText: string;
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
const cssColor = (value: string, fallback: string) => {
  const { c, a } = color(value, fallback);
  return a >= 1 ? `#${c.toString(16).padStart(6, "0")}` : `rgba(${c >> 16},${(c >> 8) & 255},${c & 255},${a.toFixed(3)})`;
};

/**
 * Paints a UI layout with Phaser objects (pooled): the HUD in the game and the designer's board in
 * the editor draw the same way. Values come in already computed. Each element gets its own depth
 * step, so a later element is drawn over an earlier one whatever it is made of.
 */
export class LayoutPainter {
  private readonly scene: any;
  private readonly depth: number;
  private readonly under: any;
  private readonly over: any;
  private readonly images: Pool;
  private readonly texts: Pool;
  private readonly shapes: Pool;
  private ox = 0;
  private oy = 0;
  private k = 1;
  /** The element being drawn: its depth, opacity and lazily taken graphics (behind and in front of its pictures). */
  private d = 0;
  private a = 1;
  private back: any = null;
  private front: any = null;

  /** `textResolution` > 1 keeps small texts sharp under a zoomed camera (the editor's map). */
  constructor(scene: any, depth = 0, textResolution = 1) {
    this.scene = scene;
    this.depth = depth;
    const s = scene;
    this.under = s.add.graphics().setDepth(depth);
    this.over = s.add.graphics().setDepth(depth + 0.9);
    this.images = new Pool(() => s.add.image(0, 0, resolveTexture(s.textures, "pixel")).setOrigin(0, 0));
    this.shapes = new Pool(() => s.add.graphics());
    this.texts = new Pool(() => {
      const t = s.add.text(0, 0, "", { fontFamily: "monospace" }).setOrigin(0, 0);
      if (textResolution > 1) t.setResolution?.(textResolution);
      return t;
    });
    this.extras();
  }

  /** Graphics over the layout (what the HUD draws around it: notes, the inventory panel). */
  get graphics(): any {
    return this.over;
  }

  /** Graphics under the layout (a screen's dim colour). */
  get backdrop(): any {
    return this.under;
  }

  begin(): void {
    this.under.clear();
    this.over.clear();
    this.images.begin();
    this.texts.begin();
    this.shapes.begin();
    this.extras();
  }

  end(): void {
    this.images.end();
    this.texts.end();
    this.shapes.end();
  }

  destroy(): void {
    this.under.destroy?.();
    this.over.destroy?.();
    this.images.destroy();
    this.texts.destroy();
    this.shapes.destroy();
  }

  /** What is drawn outside the elements (text(), icon(), panel()) goes over them. */
  private extras(): void {
    this.d = this.depth + 0.9;
    this.a = 1;
  }

  /** Size of a picture (a project image or a built-in sprite), or null. */
  picSize(key: string): { w: number; h: number } | null {
    const k = key ? resolveTexture(this.scene.textures, key) : null;
    if (!k) return null;
    const src = this.scene.textures.get?.(k)?.getSourceImage?.();
    return src && src.width > 0 && src.height > 0 ? { w: src.width, h: src.height } : null;
  }

  paint(layout: UiLayout, values: LayoutValues, fonts: Record<string, string>, area: PaintArea, opts: PaintOptions = {}): Painted {
    this.ox = area.x;
    this.oy = area.y;
    this.k = area.k;
    const viewW = Math.floor(area.w / area.k);
    const viewH = Math.floor(area.h / area.k);
    const out: Painted = { boxes: {}, viewW, viewH, topEdge: 0, bottomEdge: viewH };
    layout.elements.forEach((e, i) => {
      if (!isShown(e, values)) return;
      const p = anchorPoint(e.anchor, viewW, viewH);
      const fx = effectAt(e.effect, opts.time ?? 0);
      this.d = this.depth + (i + 1) * STEP;
      this.a = e.alpha * fx.alpha;
      this.back = this.front = null;
      const placed = { x: p.x + e.x, y: p.y + e.y, w: e.w, h: e.h };
      const drawn = this.element(e, { ...placed, x: placed.x + fx.dx, y: placed.y + fx.dy }, values, fonts, layout, e.id === opts.focus, opts);
      // Hit boxes stay where the element is placed (the effect only moves the drawing).
      const box = { ...drawn, x: drawn.x - fx.dx, y: drawn.y - fx.dy };
      out.boxes[e.id] = box;
      if (box.y + box.h <= viewH / 2) out.topEdge = Math.max(out.topEdge, box.y + box.h);
      else if (box.y >= viewH / 2) out.bottomEdge = Math.min(out.bottomEdge, box.y);
    });
    this.extras();
    return out;
  }

  private element(e: UiElement, b: Box, values: LayoutValues, fonts: Record<string, string>, layout: UiLayout, focused: boolean, opts: PaintOptions): Box {
    switch (e.type) {
      case "image": {
        // "{portrait}": the picture a value names (the speaker's portrait); none shown when it is empty.
        const key = e.image.includes("{") ? textWithValues(e.image, values) : e.image;
        if (!this.picture(key, b, e.mode, e.slice, e.rotation) && e.color) this.rect(b, color(e.color, "#000000"));
        return b;
      }
      case "text": {
        const family = fonts[e.font || layout.theme.font] ?? "monospace";
        const t = this.text(textWithValues(e.text, values), family, e.size, e.color || layout.theme.textColor, e.wrap ? e.w * this.k : 0, e.stroke ? { color: e.stroke, width: e.strokeWidth } : null);
        const w = t.width / this.k;
        const h = t.height / this.k;
        const x = e.align === "center" ? b.x + (b.w - w) / 2 : e.align === "right" ? b.x + b.w - w : b.x;
        if (e.rotation) t.setOrigin(0.5, 0.5).setRotation((e.rotation * Math.PI) / 180).setPosition(Math.round(this.sx(x + w / 2)), Math.round(this.sy(b.y + h / 2)));
        else t.setPosition(Math.round(this.sx(x)), Math.round(this.sy(b.y)));
        return b;
      }
      case "bar":
        this.bar(e, b, values, fonts, layout);
        return b;
      case "hearts":
        return this.hearts(e, b, values);
      case "counter":
        return this.counter(e, b, values);
      case "item":
        this.item(e.frame, b, String(values[e.slot === 2 ? "item2.icon" : "item.icon"] ?? ""));
        return b;
      case "icon":
        this.iconCell(e, b);
        return b;
      case "slot":
        this.slot(e, b, values, fonts, layout);
        return b;
      case "minimap":
        this.minimap(e, b, opts.minimap ?? null);
        return b;
      case "inventory":
        this.inventory(e, b, fonts, layout, opts.inventory ?? null);
        return b;
      case "choices":
        this.choices(e, b, fonts, layout, opts.choices ?? null);
        return b;
      case "keybinds":
        this.keybinds(e, b, fonts, layout, opts.keybinds ?? null, opts.time ?? 0);
        return b;
      case "button":
        this.button(e, b, values, fonts, layout, focused);
        return b;
    }
  }

  private sx(x: number): number {
    return this.ox + x * this.k;
  }

  private sy(y: number): number {
    return this.oy + y * this.k;
  }

  /** The element's graphics behind its pictures (or, `front`, over them). */
  private gfx(front = false): any {
    if (front) return (this.front ??= this.shapes.next().clear().setDepth(this.d + 0.003).setAlpha(1));
    return (this.back ??= this.shapes.next().clear().setDepth(this.d).setAlpha(1));
  }

  /** A pooled picture, reset to plain (origin top-left, no rotation or crop) at this element's depth and opacity. */
  private img(tex: string, frame?: string): any {
    return this.images.next().setTexture(tex, frame).setOrigin(0, 0).setRotation(0).setCrop().setAlpha(this.a).setDepth(this.d + 0.001);
  }

  private rect(b: Box, c: { c: number; a: number }): void {
    this.gfx().fillStyle(c.c, c.a * this.a).fillRect(this.sx(b.x), this.sy(b.y), b.w * this.k, b.h * this.k);
  }

  private poly(g: any, pts: readonly Point[], c: { c: number; a: number }): void {
    if (pts.length < 3) return;
    g.fillStyle(c.c, c.a * this.a).fillPoints(pts.map((p) => ({ x: this.sx(p.x), y: this.sy(p.y) })), true);
  }

  private outline(g: any, pts: readonly Point[], c: { c: number; a: number }, width: number): void {
    if (pts.length < 2 || width <= 0) return;
    g.lineStyle(width * this.k, c.c, c.a * this.a).strokePoints(pts.map((p) => ({ x: this.sx(p.x), y: this.sy(p.y) })), true, true);
  }

  /** A picture over a box: stretched, 9-slice or fitted, turned by `rotation` degrees (not 9-slice). False when the picture is missing. */
  private picture(key: string, b: Box, mode: "stretch" | "nine" | "fit", slice = 0, rotation = 0, frame?: string, frameSize?: { w: number; h: number }): boolean {
    const size = frameSize ?? this.picSize(key);
    if (!size) return false;
    const tex = resolveTexture(this.scene.textures, key)!;
    if (mode === "nine" && slice > 0 && !frame) {
      this.nineSlice(tex, size, slice, b);
      return true;
    }
    const img = this.img(tex, frame);
    let w = b.w;
    let h = b.h;
    if (mode === "fit") {
      const f = Math.min(b.w / size.w, b.h / size.h);
      w = size.w * f;
      h = size.h * f;
    }
    img.setScale((w * this.k) / size.w, (h * this.k) / size.h);
    if (rotation) img.setOrigin(0.5, 0.5).setRotation((rotation * Math.PI) / 180).setPosition(this.sx(b.x + b.w / 2), this.sy(b.y + b.h / 2));
    else img.setPosition(Math.round(this.sx(b.x + (b.w - w) / 2)), Math.round(this.sy(b.y + (b.h - h) / 2)));
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
        this.img(tex, name)
          .setScale((dw[col] * this.k) / sw[col], (dh[row] * this.k) / sh[row])
          .setPosition(Math.round(this.sx(dx[col])), Math.round(this.sy(dy[row])));
      }
    }
  }

  /** A text at a font size in layout pixels (the plain fallback font is bold to stay readable), with an outline or a soft shadow. */
  text(value: string, family: string, size: number, fill: string, wrapW = 0, stroke: { color: string; width: number } | null = null): any {
    const t = this.texts.next();
    const px = Math.max(1, Math.round(size * this.k));
    t.setStyle({ fontFamily: family, fontSize: `${px}px`, color: fill || "#ffffff", fontStyle: family === "monospace" ? "bold" : "normal", ...(wrapW > 0 ? { wordWrap: { width: wrapW, useAdvancedWrap: true } } : { wordWrap: null }) });
    if (stroke) {
      t.setStroke(cssColor(stroke.color, "#000000"), Math.max(1, stroke.width * this.k));
      t.setShadow(0, 0, "#000000", 0, false, false);
    } else {
      t.setStroke("#000000", 0);
      t.setShadow(1, 1, "#000000", 0, false, true);
    }
    // Pooled texts: a fading note or a turned label may have left its alpha, origin or angle.
    t.setOrigin(0, 0).setRotation(0).setAlpha(this.a).setDepth(this.d + 0.002);
    t.setText(value);
    return t;
  }

  private bar(e: Extract<UiElement, { type: "bar" }>, b: Box, values: LayoutValues, fonts: Record<string, string>, layout: UiLayout): void {
    const max = Number(values[e.max] ?? e.max) || 0;
    const f = max > 0 ? Math.max(0, Math.min(1, (Number(values[e.value]) || 0) / max)) : 0;
    const k = this.k;
    const fill = this.picSize(e.fill);
    const pictureBack = this.picture(e.back, b, "stretch");
    if (fill) {
      // The fill picture over the back, cut from the empty side.
      const img = this.img(resolveTexture(this.scene.textures, e.fill)!);
      img.setScale((b.w * k) / fill.w, (b.h * k) / fill.h).setPosition(this.sx(b.x), this.sy(b.y));
      const cw = Math.round(fill.w * f);
      const ch = Math.round(fill.h * f);
      if (e.dir === "up") img.setCrop(0, fill.h - ch, fill.w, ch);
      else if (e.dir === "down") img.setCrop(0, 0, fill.w, ch);
      else if (e.dir === "left") img.setCrop(fill.w - cw, 0, cw, fill.h);
      else img.setCrop(0, 0, cw, fill.h);
      img.setVisible(f > 0);
    } else if (pictureBack || e.shape !== "rect") {
      // A shape in colours: back, the level, the border.
      const g = this.gfx();
      const outline = shapePolygon(e.shape, b);
      if (!pictureBack) this.poly(g, outline, color(e.backColor, "#000000d9"));
      // Over a back picture a plain bar fills inside its 2-pixel frame, as the classic meter does.
      const level = pictureBack && e.shape === "rect" ? { x: b.x + 2, y: b.y + 2, w: Math.max(0, b.w - 4), h: Math.max(0, b.h - 4) } : b;
      this.poly(pictureBack ? this.gfx(true) : g, barFillPolygon(e.shape, level, e.dir, f), color(e.fillColor, "#3ad16b"));
      if (e.border && !pictureBack) this.outline(g, outline, color(e.border, "#f0f0e0"), e.borderWidth);
    } else {
      // The classic meter: a framed box with the fill inside a 2-pixel inset.
      this.rect(b, color(e.backColor, "#000000d9"));
      if (e.border && e.borderWidth > 0) {
        const bw = e.borderWidth * k;
        this.gfx().lineStyle(bw, color(e.border, "#f0f0e0").c, this.a).strokeRect(this.sx(b.x) + bw / 2, this.sy(b.y) + bw / 2, b.w * k - bw, b.h * k - bw);
      }
      const inner = { x: b.x + 2, y: b.y + 2, w: Math.max(0, b.w - 4), h: Math.max(0, b.h - 4) };
      const vertical = e.dir === "up" || e.dir === "down";
      const len = (vertical ? inner.h : inner.w) * f;
      const r = vertical ? { ...inner, y: e.dir === "up" ? inner.y + inner.h - len : inner.y, h: len } : { ...inner, x: e.dir === "left" ? inner.x + inner.w - len : inner.x, w: len };
      if (len > 0) this.rect(r, color(e.fillColor, "#3ad16b"));
    }
    if (e.text) {
      const t = this.text(textWithValues(e.text, values), fonts[layout.theme.font] ?? "monospace", e.size, layout.theme.textColor);
      t.setPosition(Math.round(this.sx(b.x) + (b.w * k - t.width) / 2), Math.round(this.sy(b.y) + (b.h * k - t.height) / 2));
    }
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
      if (strip) this.img(resolveTexture(this.scene.textures, e.digits)!, `${DIGIT_FRAME}${digits[d]}`).setScale(this.k).setPosition(this.sx(x), this.sy(y));
      else this.picture(`hud_digit_${digits[d]}`, { x, y, w: 6, h: 8 }, "stretch");
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

  /** A frame (picture, else the classic double border) with an icon fitted inside. */
  private item(frame: string, b: Box, icon: string): void {
    const k = this.k;
    if (!this.picture(frame, b, "fit")) {
      const g = this.gfx();
      const X = this.sx(b.x);
      const Y = this.sy(b.y);
      g.fillStyle(0x000000, 0.8 * this.a).fillRect(X, Y, b.w * k, b.h * k);
      g.lineStyle(k, 0xf0f0e0, this.a).strokeRect(X + k / 2, Y + k / 2, b.w * k - k, b.h * k - k);
      g.lineStyle(k, 0x6070c0, this.a).strokeRect(X + k + k / 2, Y + k + k / 2, (b.w - 2) * k - k, (b.h - 2) * k - k);
    }
    if (!icon) return;
    const size = Math.max(8, Math.min(b.w, b.h) - 6);
    this.icon(icon, b.x + (b.w - size) / 2, b.y + (b.h - size) / 2, size);
  }

  /** One cell of an icon sheet, fitted into the box. */
  private iconCell(e: Extract<UiElement, { type: "icon" }>, b: Box): void {
    const size = this.picSize(e.image);
    if (!size) {
      this.rect(b, color("#00000066", "#00000066"));
      return;
    }
    if (!e.cellW || !e.cellH) {
      this.picture(e.image, b, "fit", 0, e.rotation);
      return;
    }
    const cols = Math.max(1, Math.floor(size.w / e.cellW));
    const col = e.index % cols;
    const row = Math.floor(e.index / cols);
    if ((row + 1) * e.cellH > size.h) return;
    const tex = resolveTexture(this.scene.textures, e.image)!;
    const name = `zmt_icon_${e.cellW}x${e.cellH}_${e.index}`;
    const t = this.scene.textures.get(tex);
    if (!t.has?.(name)) t.add?.(name, 0, col * e.cellW, row * e.cellH, e.cellW, e.cellH);
    this.picture(e.image, b, "fit", 0, e.rotation, name, { w: e.cellW, h: e.cellH });
  }

  private slot(e: Extract<UiElement, { type: "slot" }>, b: Box, values: LayoutValues, fonts: Record<string, string>, layout: UiLayout): void {
    const selected = !!Number(values[`slot.${e.index}.sel`]);
    this.item(selected && e.selected ? e.selected : e.frame, b, String(values[`slot.${e.index}.icon`] ?? ""));
    // Selected without a picture for it: a gold frame.
    if (selected && !e.selected) this.gfx(true).lineStyle(this.k, 0xffd23a, this.a).strokeRect(this.sx(b.x) + this.k / 2, this.sy(b.y) + this.k / 2, b.w * this.k - this.k, b.h * this.k - this.k);
    if (e.keyLabel) this.text(String(e.index), fonts[layout.theme.font] ?? "monospace", 6, layout.theme.textColor, 0, { color: "#000000", width: 1 }).setPosition(Math.round(this.sx(b.x + 1)), Math.round(this.sy(b.y)));
  }

  /**
   * An item grid: a cell frame for every cell that fits the box, the owned items' icons in them (with
   * their ammunition count), the cursor's cell with its picture or a gold frame.
   */
  private inventory(e: Extract<UiElement, { type: "inventory" }>, b: Box, fonts: Record<string, string>, layout: UiLayout, data: { cells: InventoryCell[]; cursor: number } | null): void {
    const step = e.cell + e.gap;
    const rows = Math.max(1, Math.floor((b.h + e.gap) / step));
    const cells = data?.cells ?? [];
    const total = Math.max(rows * e.cols, Math.ceil(cells.length / e.cols) * e.cols);
    for (let i = 0; i < total; i++) {
      const cell = { x: b.x + (i % e.cols) * step, y: b.y + Math.floor(i / e.cols) * step, w: e.cell, h: e.cell };
      const item = cells[i];
      this.item(e.frame, cell, item?.icon ?? "");
      if (item && e.counts && item.count !== null) {
        const t = this.text(String(item.count), fonts[layout.theme.font] ?? "monospace", 6, layout.theme.textColor, 0, { color: "#000000", width: 1 });
        t.setPosition(Math.round(this.sx(cell.x + cell.w) - t.width - this.k), Math.round(this.sy(cell.y + cell.h) - t.height));
      }
      if (i !== (data?.cursor ?? -1)) continue;
      if (!this.picture(e.cursor, cell, "stretch")) this.gfx(true).lineStyle(this.k, 0xffd23a, this.a).strokeRect(this.sx(cell.x) + this.k / 2, this.sy(cell.y) + this.k / 2, cell.w * this.k - this.k, cell.h * this.k - this.k);
    }
  }

  /** Key bindings: a row per action with its name, its key and its pad button; the selected cell framed in gold. */
  private keybinds(e: Extract<UiElement, { type: "keybinds" }>, b: Box, fonts: Record<string, string>, layout: UiLayout, data: KeybindsData | null, time: number): void {
    if (!data) return;
    const family = fonts[e.font || layout.theme.font] ?? "monospace";
    const color = e.color || layout.theme.textColor;
    const gold = e.selectedColor || "#ffd23a";
    // More rows than fit: the list scrolls with the selection; small arrows say there are more.
    const fit = Math.max(1, Math.floor((b.h + 0.5) / e.rowHeight));
    const first = data.row >= fit ? Math.min(data.row - fit + 1, data.rows.length - fit) : 0;
    const arrow = (up: boolean) => {
      const x = this.sx(b.x + b.w - 4);
      const y = this.sy(up ? b.y + 1 : b.y + fit * e.rowHeight - 1);
      const d = this.k * 2;
      this.gfx(true).fillStyle(0xffd23a, this.a).fillTriangle(x - d, up ? y + d : y - d, x + d, up ? y + d : y - d, x, y);
    };
    if (first > 0) arrow(true);
    if (first + fit < data.rows.length) arrow(false);
    data.rows.forEach((r, i) => {
      if (i < first || i >= first + fit) return;
      const y = b.y + (i - first) * e.rowHeight;
      const cells: [string, number, number][] = [[r.label, 0, -1]];
      if (e.keyColumn > 0) cells.push([r.key, e.keyColumn, 0]);
      if (e.padColumn > 0) cells.push([r.pad, e.padColumn, 1]);
      for (const [text, at, col] of cells) {
        const on = col >= 0 && i === data.row && col === data.col;
        const waiting = on && data.waiting;
        // Waiting for the new key: the cell blinks its prompt.
        const shown = waiting ? (Math.floor(time / 300) % 2 === 0 ? data.waitText : "") : text;
        const x = b.x + (b.w * at) / 100;
        const t = this.text(shown, family, e.size, on ? gold : color);
        t.setPosition(Math.round(this.sx(x + 2)), Math.round(this.sy(y + (e.rowHeight - t.height / this.k) / 2)));
        if (on) {
          const right = col === 0 && e.padColumn > e.keyColumn ? (b.w * e.padColumn) / 100 : b.w;
          this.gfx(true).lineStyle(this.k, 0xffd23a, this.a).strokeRect(this.sx(x) + this.k / 2, this.sy(y) + this.k / 2, (right - (b.w * at) / 100) * this.k - this.k * 2, e.rowHeight * this.k - this.k);
        }
      }
    });
  }

  /** The answers of a dialogue, one row each from the top of the box; the selected one marked. */
  private choices(e: Extract<UiElement, { type: "choices" }>, b: Box, fonts: Record<string, string>, layout: UiLayout, data: { items: string[]; cursor: number } | null): void {
    if (!data?.items.length) return;
    const family = fonts[e.font || layout.theme.font] ?? "monospace";
    data.items.forEach((item, i) => {
      const row = { x: b.x, y: b.y + i * (e.rowHeight + e.gap), w: b.w, h: e.rowHeight };
      const on = i === data.cursor;
      const pic = on && e.selected ? e.selected : e.image;
      if (pic) this.picture(pic, row, e.slice > 0 ? "nine" : "stretch", e.slice);
      if (on && !e.selected) this.gfx(true).lineStyle(this.k, 0xffd23a, this.a).strokeRect(this.sx(row.x) + this.k / 2, this.sy(row.y) + this.k / 2, row.w * this.k - this.k, row.h * this.k - this.k);
      const t = this.text(`${on ? e.marker : ""}${item}`, family, e.size, on ? e.selectedColor || "#ffd23a" : e.color || layout.theme.textColor);
      t.setPosition(Math.round(this.sx(row.x + 3)), Math.round(this.sy(row.y + (row.h - t.height / this.k) / 2)));
    });
  }

  /** The world around the player squeezed into the box, cut to its shape. */
  private minimap(e: Extract<UiElement, { type: "minimap" }>, b: Box, data: MinimapData | null): void {
    const g = this.gfx();
    const shape = shapePolygon(e.shape === "circle" ? "circle" : "rect", b);
    this.poly(g, shape, color(e.backColor, "#1f1a24d9"));
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const s = Math.min(b.w, b.h) / 2 / e.range;
    const at = (x: number, y: number): Point => ({ x: cx + (x - (data?.x ?? 0)) * s, y: cy + (y - (data?.y ?? 0)) * s });
    if (data) {
      const wall = color(e.wallColor, "#8e9aa8");
      for (const w of data.walls) {
        const p = at(w.x - w.hw, w.y - w.hh);
        const r = { x: p.x, y: p.y, w: w.hw * 2 * s, h: w.hh * 2 * s };
        if (r.x > b.x + b.w || r.y > b.y + b.h || r.x + r.w < b.x || r.y + r.h < b.y) continue;
        this.poly(g, clipPolygon(shapePolygon("rect", r), shape), wall);
      }
      for (const d of data.dots) {
        const p = at(d.x, d.y);
        const dot = { x: p.x - 1, y: p.y - 1, w: 2, h: 2 };
        this.poly(g, clipPolygon(shapePolygon("rect", dot), shape), color(d.kind === "enemy" ? e.enemyColor : e.objectColor, "#ffffff"));
      }
    }
    this.poly(g, shapePolygon("rect", { x: cx - 1.5, y: cy - 1.5, w: 3, h: 3 }), color(e.playerColor, "#ff3040"));
    if (e.border) this.outline(g, shape, color(e.border, "#f0f0e0"), e.borderWidth);
  }

  /** A button: its picture (the selected one while focused) or colour, a gold frame when selected without a selected picture, its text centred. */
  private button(e: Extract<UiElement, { type: "button" }>, b: Box, values: LayoutValues, fonts: Record<string, string>, layout: UiLayout, focused: boolean): void {
    const pic = focused && e.hover ? e.hover : e.image;
    const drawn = this.picture(pic, b, e.slice > 0 ? "nine" : "stretch", e.slice);
    if (!drawn) this.rect(b, color(focused ? e.hoverColor : e.color, "#1f1a24e6"));
    if (focused && !(drawn && e.hover)) this.gfx(true).lineStyle(this.k, 0xffd23a, this.a).strokeRect(this.sx(b.x) + this.k / 2, this.sy(b.y) + this.k / 2, b.w * this.k - this.k, b.h * this.k - this.k);
    if (!e.text) return;
    const family = fonts[e.font || layout.theme.font] ?? "monospace";
    const t = this.text(textWithValues(e.text, values), family, e.size, e.textColor || layout.theme.textColor);
    t.setPosition(Math.round(this.sx(b.x) + (b.w * this.k - t.width) / 2), Math.round(this.sy(b.y) + (b.h * this.k - t.height) / 2));
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
