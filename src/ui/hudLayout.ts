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
}

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
const LIFE_W = HEARTS_PER_ROW * HEART_SIZE;

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

  const magic = i.showMagic ? { x, y: y0, w: 8, h: 30 } : null;
  if (magic) x += magic.w + 4;
  const item = i.showItem ? { x, y: y0 + 2, w: 22, h: 22 } : null;
  if (item) x += item.w + COUNTER_GAP;

  const counters: { icon: Rect; digits: Rect }[] = [];
  for (const digits of i.counters) {
    const w = Math.max(8, digits * DIGIT_W);
    counters.push({ icon: { x: x + Math.floor((w - 8) / 2), y: y0 + 2, w: 8, h: 8 }, digits: { x, y: y0 + 12, w, h: DIGIT_H } });
    x += w + COUNTER_GAP;
  }

  const rows = i.showHearts ? Math.max(1, Math.ceil(i.hearts / HEARTS_PER_ROW)) : 0;
  let lifeLabel: Rect | null = null;
  const hearts: Rect[] = [];
  let barBottom = Math.max(magic ? magic.y + magic.h : y0, item ? item.y + item.h : y0, counters.length ? y0 + 12 + DIGIT_H : y0);
  if (i.showHearts) {
    // Right-aligned like the original; drops below the counters when the screen is narrow.
    let lx = right - LIFE_W;
    let ly = y0;
    if (lx < x) {
      lx = left;
      ly = barBottom + 4;
    }
    lifeLabel = { x: lx, y: ly, w: LIFE_W, h: 7 };
    for (let n = 0; n < i.hearts; n++) {
      hearts.push({ x: lx + (n % HEARTS_PER_ROW) * HEART_SIZE, y: ly + 9 + Math.floor(n / HEARTS_PER_ROW) * HEART_SIZE, w: HEART_SIZE - 1, h: HEART_SIZE - 1 });
    }
    barBottom = Math.max(barBottom, ly + 9 + rows * HEART_SIZE);
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

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Digits a counter needs to show `max`. */
export function digitsFor(max: number): number {
  return Math.max(1, String(Math.max(0, Math.floor(max))).length);
}
