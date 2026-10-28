/**
 * Layout of the classic top bar (A Link to the Past style):
 *
 *   [magic] [item]  [rupee][bomb][arrow][key]          — LIFE —
 *   [meter] [ box]   000    00    00    0       ♥♥♥♥♥♥♥♥♥♥
 *                                               ♥♥♥♥♥♥♥♥♥♥
 *
 * Coordinates are in HUD pixels (multiplied by `k` on screen). The function is
 * pure so tests can check that no two elements overlap at any screen size.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudLayoutInput {
  screenW: number;
  screenH: number;
  /** 0 = automatic. */
  scale: number;
  position: "top" | "bottom";
  safeArea: { top: number; right: number; bottom: number; left: number };
  showMagic: boolean;
  showItem: boolean;
  showHearts: boolean;
  /** Digits per counter (rupees 3, bombs 2, ...). */
  counters: number[];
  hearts: number;
  /** Sizes of the pictures in HUD pixels (own HUD pictures, Zelda: HUD Style); missing = built-in. */
  metrics?: Partial<HudMetrics>;
  /** The "LIFE" label above the hearts (default shown). */
  showLifeLabel?: boolean;
}

export interface Size {
  w: number;
  h: number;
}

/** Drawn sizes of the HUD pictures. A heart or digit cell is its size plus 1 px of space. */
export interface HudMetrics {
  heart: Size;
  icon: Size;
  /** One digit, its spacing included. */
  digit: Size;
  item: Size;
  magic: Size;
}

export const DEFAULT_HUD_METRICS: HudMetrics = {
  heart: { w: 7, h: 7 },
  icon: { w: 8, h: 8 },
  digit: { w: 6, h: 8 },
  item: { w: 22, h: 22 },
  magic: { w: 8, h: 30 },
};

export interface HudLayout {
  k: number;
  /** Visible area in HUD pixels. */
  viewW: number;
  viewH: number;
  bar: Rect;
  magic: Rect | null;
  item: Rect | null;
  counters: { icon: Rect; digits: Rect }[];
  lifeLabel: Rect | null;
  hearts: Rect[];
  /** Free area for messages / panels (not covered by the bar). */
  free: Rect;
}

export const HEART_SIZE = 8;
export const HEARTS_PER_ROW = 10;
export const DIGIT_W = 6;
export const DIGIT_H = 8;
const PAD = 6;
const COUNTER_GAP = 8;
const LABEL_H = 7;

export function hudScale(screenW: number, screenH: number, scale: number): number {
  if (scale > 0) return Math.max(1, Math.round(scale));
  return Math.max(1, Math.floor(Math.min(screenW / 256, screenH / 224)));
}

export function computeHudLayout(i: HudLayoutInput): HudLayout {
  const k = hudScale(i.screenW, i.screenH, i.scale);
  const viewW = Math.floor(i.screenW / k);
  const viewH = Math.floor(i.screenH / k);
  const left = i.safeArea.left + PAD;
  const right = viewW - i.safeArea.right - PAD;
  let x = left;
  const top = i.position === "bottom" ? 0 : i.safeArea.top;
  const y0 = top + 4;

  const m = metricsOf(i.metrics);
  const magic = i.showMagic ? { x, y: y0, w: m.magic.w, h: m.magic.h } : null;
  if (magic) x += magic.w + 4;
  const item = i.showItem ? { x, y: y0 + 2, w: m.item.w, h: m.item.h } : null;
  if (item) x += item.w + COUNTER_GAP;

  const counters: { icon: Rect; digits: Rect }[] = [];
  const digitsY = y0 + 2 + m.icon.h + 2;
  for (const digits of i.counters) {
    const w = Math.max(m.icon.w, digits * m.digit.w);
    counters.push({ icon: { x: x + Math.floor((w - m.icon.w) / 2), y: y0 + 2, w: m.icon.w, h: m.icon.h }, digits: { x, y: digitsY, w, h: m.digit.h } });
    x += w + COUNTER_GAP;
  }

  const rows = i.showHearts ? Math.max(1, Math.ceil(i.hearts / HEARTS_PER_ROW)) : 0;
  const cellW = m.heart.w + 1;
  const cellH = m.heart.h + 1;
  const lifeW = HEARTS_PER_ROW * cellW;
  const labelH = i.showLifeLabel === false ? 0 : LABEL_H + 2;
  let lifeLabel: Rect | null = null;
  const hearts: Rect[] = [];
  let barBottom = Math.max(magic ? magic.y + magic.h : y0, item ? item.y + item.h : y0, counters.length ? digitsY + m.digit.h : y0);
  if (i.showHearts) {
    // Right-aligned like the original; drops below the counters when the screen is narrow.
    let lx = right - lifeW;
    let ly = y0;
    if (lx < x) {
      lx = left;
      ly = barBottom + 4;
    }
    if (labelH) lifeLabel = { x: lx, y: ly, w: lifeW, h: LABEL_H };
    for (let n = 0; n < i.hearts; n++) {
      hearts.push({ x: lx + (n % HEARTS_PER_ROW) * cellW, y: ly + labelH + Math.floor(n / HEARTS_PER_ROW) * cellH, w: m.heart.w, h: m.heart.h });
    }
    barBottom = Math.max(barBottom, ly + labelH + rows * cellH);
  }
  const barH = barBottom - top + 4;
  const barY = i.position === "bottom" ? viewH - i.safeArea.bottom - barH : top;
  const shift = barY - top;
  const move = (r: Rect | null): Rect | null => (r ? { ...r, y: r.y + shift } : null);
  const bar = { x: 0, y: barY, w: viewW, h: barH };
  const free = i.position === "bottom" ? { x: 0, y: i.safeArea.top, w: viewW, h: barY - i.safeArea.top } : { x: 0, y: barY + barH, w: viewW, h: viewH - i.safeArea.bottom - (barY + barH) };
  return {
    k,
    viewW,
    viewH,
    bar,
    magic: move(magic),
    item: move(item),
    counters: counters.map((c) => ({ icon: move(c.icon)!, digits: move(c.digits)! })),
    lifeLabel: move(lifeLabel),
    hearts: hearts.map((h) => move(h)!),
    free,
  };
}

function metricsOf(m: Partial<HudMetrics> | undefined): HudMetrics {
  const pick = (k: keyof HudMetrics): Size => {
    const v = m?.[k];
    return v && v.w > 0 && v.h > 0 ? { w: Math.round(v.w), h: Math.round(v.h) } : DEFAULT_HUD_METRICS[k];
  };
  return { heart: pick("heart"), icon: pick("icon"), digit: pick("digit"), item: pick("item"), magic: pick("magic") };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Digits a counter needs to show `max`. */
export function digitsFor(max: number): number {
  return Math.max(1, String(Math.max(0, Math.floor(max))).length);
}
