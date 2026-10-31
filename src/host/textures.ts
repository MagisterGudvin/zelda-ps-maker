/**
 * Original placeholder art, drawn at runtime with the Canvas 2D API (world
 * sprites as pixel grids from worldSprites.ts; no image files, no third-party or
 * Nintendo assets). Authors replace any
 * sprite by passing their own PS Maker texture key instead of a built-in id.
 */
import { WORLD_PALETTE, WORLD_SPRITES } from "./worldSprites.ts";

type Ctx = CanvasRenderingContext2D;
type Painter = (c: Ctx) => void;

interface SpriteDef {
  w: number;
  h: number;
  paint: Painter;
}

export const TEXTURE_PREFIX = "zmt_";

function rect(c: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}

function circle(c: Ctx, x: number, y: number, r: number, color: string): void {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

function poly(c: Ctx, pts: number[], color: string): void {
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fill();
}

function outline(c: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  c.strokeStyle = color;
  c.lineWidth = 1;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Draws a pixel grid: each char maps to a palette color ("." = transparent). */
function grid(c: Ctx, rows: string[], palette: Record<string, string>): void {
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const color = palette[rows[y][x]];
      if (color) rect(c, x, y, 1, 1, color);
    }
  }
}

/** 4x6 digit glyphs; drawn white with a 1px dark outline into a 6x8 cell. */
const DIGITS: string[][] = [
  ["####", "#..#", "#..#", "#..#", "#..#", "####"],
  [".##.", "###.", ".##.", ".##.", ".##.", "####"],
  ["####", "...#", "####", "#...", "#...", "####"],
  ["####", "...#", ".###", "...#", "...#", "####"],
  ["#..#", "#..#", "####", "...#", "...#", "...#"],
  ["####", "#...", "####", "...#", "...#", "####"],
  ["####", "#...", "####", "#..#", "#..#", "####"],
  ["####", "...#", "..#.", ".#..", ".#..", ".#.."],
  ["####", "#..#", "####", "#..#", "#..#", "####"],
  ["####", "#..#", "####", "...#", "...#", "####"],
];

function digit(c: Ctx, n: number): void {
  const g = DIGITS[n];
  for (let y = 0; y < g.length; y++) for (let x = 0; x < 4; x++) if (g[y][x] === "#") rect(c, x, y, 3, 3, "#101018");
  for (let y = 0; y < g.length; y++) for (let x = 0; x < 4; x++) if (g[y][x] === "#") rect(c, x + 1, y + 1, 1, 1, "#ffffff");
}

const HEART8 = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];

function heart8(c: Ctx, part: number): void {
  const at = (x: number, y: number) => HEART8[y]?.[x] === "#";
  for (let y = 0; y < HEART8.length; y++) {
    for (let x = 0; x < 7; x++) {
      if (!at(x, y)) continue;
      const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
      const filled = part >= 1 || (part > 0 && x <= 3);
      rect(c, x, y, 1, 1, edge ? "#200810" : filled ? "#e8303c" : "#4a3038");
    }
  }
  if (part > 0) rect(c, 1, 1, 1, 1, "#ffb8c0");
}

function heart(c: Ctx, fill: string, part: number): void {
  // part: 1 = full, 0.5 = half, 0 = empty (outline only)
  const shape = [1, 3, 3, 1, 5, 1, 7, 3, 9, 1, 11, 1, 13, 3, 13, 6, 7, 13, 1, 6];
  poly(c, shape, "#3a0d12");
  c.save();
  c.beginPath();
  c.rect(0, 0, part >= 1 ? 14 : part > 0 ? 7 : 0, 14);
  c.clip();
  poly(c, [2, 3.5, 3.5, 2, 5, 2, 7, 4, 9, 2, 10.5, 2, 12, 3.5, 12, 5.8, 7, 11.5, 2, 5.8], fill);
  c.restore();
  rect(c, 3, 3, 2, 1, "#ffd0d0");
}

function enemyBody(c: Ctx, w: number, h: number, body: string, dark: string, eye = "#ffffff"): void {
  circle(c, w / 2, h / 2 + 1, w / 2 - 1, dark);
  circle(c, w / 2, h / 2, w / 2 - 2, body);
  rect(c, w / 2 - 4, h / 2 - 2, 3, 3, eye);
  rect(c, w / 2 + 1, h / 2 - 2, 3, 3, eye);
  rect(c, w / 2 - 3, h / 2 - 1, 1, 2, "#111");
  rect(c, w / 2 + 2, h / 2 - 1, 1, 2, "#111");
}

const DEFS: Record<string, SpriteDef> = {
  sword: {
    w: 16,
    h: 6,
    paint: (c) => {
      rect(c, 0, 2, 4, 2, "#7a4a1c");
      rect(c, 4, 0, 2, 6, "#d8b84a");
      poly(c, [6, 1.5, 14, 1.5, 16, 3, 14, 4.5, 6, 4.5], "#e8eef5");
      rect(c, 6, 3, 8, 1, "#9aa8b8");
    },
  },
  enemy_slime: {
    w: 14,
    h: 14,
    paint: (c) => {
      poly(c, [1, 13, 2, 6, 7, 1, 12, 6, 13, 13], "#1d5c2a");
      poly(c, [2, 12, 3, 6.5, 7, 2.5, 11, 6.5, 12, 12], "#4cc25e");
      rect(c, 4, 6, 2, 3, "#fff");
      rect(c, 8, 6, 2, 3, "#fff");
      rect(c, 5, 7, 1, 2, "#111");
      rect(c, 9, 7, 1, 2, "#111");
    },
  },
  enemy_soldier: {
    w: 14,
    h: 14,
    paint: (c) => {
      rect(c, 2, 5, 10, 8, "#2a3f8f");
      rect(c, 3, 6, 8, 6, "#4d6bd6");
      circle(c, 7, 4, 4, "#c9c9c9");
      rect(c, 4, 4, 6, 2, "#222");
      rect(c, 5, 4, 1, 1, "#f44");
      rect(c, 8, 4, 1, 1, "#f44");
    },
  },
  enemy_spitter: {
    w: 14,
    h: 14,
    paint: (c) => {
      enemyBody(c, 14, 14, "#d0623a", "#6b2a13");
      rect(c, 5, 10, 4, 3, "#2b0f05");
    },
  },
  enemy_knight: {
    w: 14,
    h: 14,
    paint: (c) => {
      rect(c, 2, 2, 10, 11, "#555c66");
      rect(c, 3, 3, 8, 9, "#8d98a6");
      rect(c, 4, 5, 6, 2, "#111");
      rect(c, 0, 6, 3, 7, "#b58b2c");
    },
  },
  enemy_sentry: {
    w: 14,
    h: 14,
    paint: (c) => {
      enemyBody(c, 14, 14, "#9a5bd1", "#43206b", "#ffe680");
    },
  },
  enemy_ogre: {
    w: 26,
    h: 26,
    paint: (c) => {
      circle(c, 13, 14, 12, "#3d2a14");
      circle(c, 13, 13, 11, "#8a6a3a");
      poly(c, [4, 6, 2, 0, 8, 4], "#e8e0c8");
      poly(c, [22, 6, 24, 0, 18, 4], "#e8e0c8");
      rect(c, 8, 10, 3, 3, "#ff3b1f");
      rect(c, 15, 10, 3, 3, "#ff3b1f");
      rect(c, 9, 17, 8, 3, "#2a1a08");
      rect(c, 10, 17, 1, 2, "#fff");
      rect(c, 15, 17, 1, 2, "#fff");
    },
  },
  enemy_shot: { w: 8, h: 8, paint: (c) => (circle(c, 4, 4, 3.5, "#5b1fa8"), circle(c, 4, 4, 2, "#d9a6ff")) },
  bomb: {
    w: 12,
    h: 12,
    paint: (c) => {
      circle(c, 6, 7, 5, "#1b1f3a");
      circle(c, 4.5, 5.5, 1.5, "#5a6390");
      rect(c, 6, 0, 1, 3, "#c9a24a");
      rect(c, 7, 0, 1, 1, "#ff9a2e");
    },
  },
  explosion: {
    w: 16,
    h: 16,
    paint: (c) => {
      circle(c, 8, 8, 8, "#ff7a1a");
      circle(c, 8, 8, 5.5, "#ffd23a");
      circle(c, 8, 8, 2.5, "#ffffff");
    },
  },
  spark: { w: 8, h: 8, paint: (c) => (poly(c, [4, 0, 5, 3, 8, 4, 5, 5, 4, 8, 3, 5, 0, 4, 3, 3], "#ffffff"), circle(c, 4, 4, 1, "#ffe066")) },
  poof: { w: 12, h: 12, paint: (c) => (circle(c, 4, 6, 3.5, "#e6e6e6"), circle(c, 8, 5, 3.5, "#f5f5f5"), circle(c, 6, 8, 3, "#cfcfcf")) },
  sparkle: { w: 12, h: 12, paint: (c) => (poly(c, [6, 0, 7, 5, 12, 6, 7, 7, 6, 12, 5, 7, 0, 6, 5, 5], "#9effa0"), circle(c, 6, 6, 1.5, "#fff")) },
  boomerang: { w: 10, h: 10, paint: (c) => (poly(c, [1, 1, 9, 1, 9, 4, 4, 4, 4, 9, 1, 9], "#b5622b"), rect(c, 2, 2, 6, 1, "#e8a066")) },
  // An arrow with a bomb for a head.
  bomb_arrow: { w: 16, h: 16, paint: (c) => (rect(c, 1, 7, 9, 2, "#c8a26a"), rect(c, 0, 6, 2, 1, "#e8e8e8"), rect(c, 0, 9, 2, 1, "#e8e8e8"), circle(c, 12, 8, 3.5, "#1b1f3a"), rect(c, 12, 3, 1, 2, "#ff9a2e")) },
  // A patch of dug-up earth (shovel).
  obj_dug: { w: 16, h: 16, paint: (c) => (circle(c, 8, 9, 6, "#5a3a1e"), circle(c, 8, 9, 4, "#3a2412"), rect(c, 2, 4, 2, 1, "#7a5a32"), rect(c, 12, 13, 2, 1, "#7a5a32")) },
  // A cloud of magic powder.
  powder_cloud: { w: 16, h: 16, paint: (c) => (circle(c, 8, 8, 6, "#c8a8f0"), circle(c, 5, 6, 3, "#e8d8ff"), circle(c, 11, 10, 3, "#e8d8ff"), rect(c, 3, 11, 1, 1, "#fff6b0"), rect(c, 12, 4, 1, 1, "#fff6b0")) },
  // The hook (pointing right) and one link of its chain.
  hookshot_head: { w: 8, h: 8, paint: (c) => (rect(c, 0, 3, 4, 2, "#a8b0ba"), poly(c, [3, 1, 8, 4, 3, 7, 4, 4], "#e0e6ee")) },
  hookshot_chain: { w: 4, h: 4, paint: (c) => (rect(c, 0, 1, 4, 2, "#8a929c"), rect(c, 1, 0, 2, 4, "#a8b0ba")) },
  // A wooden stake with an iron ring (hookshot target).
  obj_hook_post: { w: 16, h: 16, paint: (c) => (rect(c, 5, 6, 6, 9, "#8a5a2b"), rect(c, 5, 6, 6, 2, "#a8743a"), rect(c, 4, 14, 8, 2, "#4a2a10"), circle(c, 8, 4, 3, "#a8b0ba"), circle(c, 8, 4, 1.5, "#5a6270")) },
  arrow: {
    w: 14,
    h: 4,
    paint: (c) => {
      rect(c, 0, 1, 10, 2, "#8b5a2b");
      poly(c, [10, 0, 14, 2, 10, 4], "#c8d0da");
      rect(c, 0, 0, 2, 1, "#e8e8e8");
      rect(c, 0, 3, 2, 1, "#e8e8e8");
    },
  },
  fireball: { w: 10, h: 10, paint: (c) => (circle(c, 5, 5, 5, "#d1361a"), circle(c, 5, 5, 3, "#ffa32e"), circle(c, 5, 5, 1.5, "#fff3b0")) },
  pickup_heart: { w: 14, h: 14, paint: (c) => heart(c, "#e8323c", 1) },
  pickup_rupee: {
    w: 8,
    h: 12,
    paint: (c) => {
      poly(c, [4, 0, 8, 3, 8, 9, 4, 12, 0, 9, 0, 3], "#1f8a3a");
      poly(c, [4, 2, 6, 4, 6, 8, 4, 10, 2, 8, 2, 4], "#58e07a");
    },
  },
  pickup_magic: { w: 10, h: 12, paint: (c) => (rect(c, 3, 0, 4, 3, "#7a4a1c"), circle(c, 5, 7, 5, "#1a3fa0"), circle(c, 5, 7, 3, "#5aa0ff")) },
  pickup_bomb: { w: 12, h: 12, paint: (c) => DEFS.bomb.paint(c) },
  pickup_arrow: { w: 12, h: 12, paint: (c) => (rect(c, 1, 5, 8, 2, "#8b5a2b"), poly(c, [9, 3, 12, 6, 9, 9], "#c8d0da"), rect(c, 0, 4, 2, 4, "#e8e8e8")) },
  pickup_key: {
    w: 8,
    h: 14,
    paint: (c) => {
      circle(c, 4, 3.5, 3.5, "#c9a227");
      circle(c, 4, 3.5, 1.5, "#000");
      rect(c, 3, 6, 2, 8, "#c9a227");
      rect(c, 5, 10, 2, 1, "#c9a227");
      rect(c, 5, 12, 2, 1, "#c9a227");
    },
  },
  pickup_bigkey: {
    w: 12,
    h: 16,
    paint: (c) => {
      circle(c, 6, 5, 5, "#e3b81f");
      circle(c, 6, 5, 2, "#5c1010");
      rect(c, 5, 9, 3, 7, "#e3b81f");
      rect(c, 8, 12, 3, 2, "#e3b81f");
    },
  },
  pickup_container: { w: 14, h: 14, paint: (c) => (heart(c, "#ff5a8a", 1), outline(c, 0, 0, 14, 14, "#ffd700")) },
  obj_bush: {
    w: 16,
    h: 16,
    paint: (c) => {
      circle(c, 8, 9, 7.5, "#14491f");
      circle(c, 5, 7, 4.5, "#2f8f3a");
      circle(c, 11, 7, 4.5, "#2f8f3a");
      circle(c, 8, 11, 5, "#3daa47");
      rect(c, 5, 6, 2, 1, "#7fe07f");
    },
  },
  obj_stump: { w: 16, h: 16, paint: (c) => (circle(c, 8, 10, 4, "#14491f"), rect(c, 6, 9, 4, 3, "#6b4423")) },
  obj_grass: {
    w: 16,
    h: 16,
    paint: (c) => {
      for (let i = 0; i < 5; i++) poly(c, [1 + i * 3, 16, 3 + i * 3, 4 + (i % 2) * 3, 5 + i * 3, 16], i % 2 ? "#5fbf4a" : "#3f9a35");
    },
  },
  obj_grass_cut: { w: 16, h: 16, paint: (c) => rect(c, 2, 13, 12, 3, "#3f9a35") },
  obj_pot: {
    w: 16,
    h: 16,
    paint: (c) => {
      circle(c, 8, 9, 7, "#5a2e14");
      circle(c, 8, 9, 6, "#b8642e");
      rect(c, 4, 2, 8, 3, "#5a2e14");
      rect(c, 5, 3, 6, 1, "#2a1206");
      rect(c, 5, 8, 2, 3, "#e8a066");
    },
  },
  obj_shards: { w: 16, h: 16, paint: (c) => (poly(c, [2, 14, 5, 10, 7, 14], "#b8642e"), poly(c, [9, 15, 12, 11, 14, 15], "#8a8a8a")) },
  obj_rock: { w: 16, h: 16, paint: (c) => (circle(c, 8, 9, 7, "#3c3c44"), circle(c, 8, 8, 6, "#8a8a96"), rect(c, 5, 5, 3, 2, "#c0c0cc")) },
  obj_heavy_rock: { w: 16, h: 16, paint: (c) => (rect(c, 1, 2, 14, 13, "#2a2a30"), rect(c, 2, 3, 12, 11, "#5e5e6a"), rect(c, 3, 4, 4, 2, "#9a9aa8")) },
  obj_cracked: { w: 16, h: 16, paint: (c) => (rect(c, 0, 0, 16, 16, "#7d6b55"), poly(c, [8, 0, 9, 6, 6, 9, 10, 16, 7, 16, 4, 9, 7, 6], "#3a2e20")) },
  obj_rubble: { w: 16, h: 16, paint: (c) => (rect(c, 2, 11, 4, 3, "#7d6b55"), rect(c, 9, 12, 5, 3, "#5c4e3d")) },
  obj_wall_cracked: {
    w: 16,
    h: 16,
    paint: (c) => {
      rect(c, 0, 0, 16, 16, "#6d6a78");
      for (let y = 0; y < 16; y += 4) rect(c, 0, y, 16, 1, "#45434e");
      poly(c, [7, 2, 9, 7, 6, 10, 9, 14, 8, 14, 5, 10, 8, 7], "#1d1c22");
    },
  },
  obj_wall_hole: { w: 16, h: 16, paint: (c) => (rect(c, 0, 0, 16, 16, "#6d6a78"), circle(c, 8, 9, 6, "#0c0b10")) },
  obj_lever_off: { w: 16, h: 16, paint: (c) => (rect(c, 3, 11, 10, 4, "#5b4632"), poly(c, [7, 12, 9, 12, 5, 3, 3, 4], "#9aa8b8"), circle(c, 4, 3.5, 2, "#d33")) },
  obj_lever_on: { w: 16, h: 16, paint: (c) => (rect(c, 3, 11, 10, 4, "#5b4632"), poly(c, [7, 12, 9, 12, 13, 4, 11, 3], "#9aa8b8"), circle(c, 12, 3.5, 2, "#3d3")) },
  obj_switch_off: { w: 16, h: 16, paint: (c) => (circle(c, 8, 8, 7, "#2a2a40"), poly(c, [8, 2, 13, 8, 8, 14, 3, 8], "#d04a4a")) },
  obj_switch_on: { w: 16, h: 16, paint: (c) => (circle(c, 8, 8, 7, "#2a2a40"), poly(c, [8, 2, 13, 8, 8, 14, 3, 8], "#4ad0d0")) },
  obj_plate_up: { w: 16, h: 16, paint: (c) => (rect(c, 1, 1, 14, 14, "#4b4b55"), rect(c, 3, 3, 10, 9, "#a0a0b0"), rect(c, 3, 12, 10, 1, "#33333a")) },
  obj_plate_down: { w: 16, h: 16, paint: (c) => (rect(c, 1, 1, 14, 14, "#4b4b55"), rect(c, 3, 4, 10, 9, "#7a7a88")) },
  obj_block: {
    w: 16,
    h: 16,
    paint: (c) => {
      rect(c, 0, 0, 16, 16, "#3a3550");
      rect(c, 1, 1, 14, 14, "#7a70a8");
      rect(c, 3, 3, 10, 10, "#5c548a");
      rect(c, 1, 1, 14, 1, "#a69ed0");
    },
  },
  obj_chest: {
    w: 16,
    h: 14,
    paint: (c) => {
      rect(c, 0, 2, 16, 12, "#4a2a10");
      rect(c, 1, 3, 14, 10, "#a4612a");
      rect(c, 1, 6, 14, 1, "#4a2a10");
      rect(c, 6, 5, 4, 4, "#e3b81f");
    },
  },
  obj_chest_open: {
    w: 16,
    h: 14,
    paint: (c) => {
      rect(c, 0, 5, 16, 9, "#4a2a10");
      rect(c, 1, 6, 14, 7, "#a4612a");
      rect(c, 1, 0, 14, 5, "#6e3d16");
      rect(c, 2, 5, 12, 2, "#1a0e05");
    },
  },
  obj_door: {
    w: 16,
    h: 16,
    paint: (c) => {
      rect(c, 0, 0, 16, 16, "#3b2414");
      rect(c, 2, 2, 12, 14, "#7a4a24");
      rect(c, 7, 2, 2, 14, "#3b2414");
      rect(c, 6, 8, 4, 4, "#c9a227");
      rect(c, 7, 9, 2, 2, "#111");
    },
  },
  obj_door_open: { w: 16, h: 16, paint: (c) => (rect(c, 0, 0, 16, 3, "#3b2414"), rect(c, 0, 0, 2, 16, "#3b2414"), rect(c, 14, 0, 2, 16, "#3b2414")) },
  obj_stairs: {
    w: 16,
    h: 16,
    paint: (c) => {
      rect(c, 0, 0, 16, 16, "#1a1a22");
      for (let i = 0; i < 4; i++) rect(c, 2, 2 + i * 3.5, 12, 2, i % 2 ? "#6a6a7a" : "#8a8a9a");
    },
  },
  obj_torch: { w: 12, h: 16, paint: (c) => (rect(c, 4, 6, 4, 10, "#5b4632"), rect(c, 2, 4, 8, 3, "#3a3a42")) },
  obj_torch_lit: { w: 12, h: 16, paint: (c) => (DEFS.obj_torch.paint(c), circle(c, 6, 3, 3, "#ff7a1a"), circle(c, 6, 3.5, 1.5, "#ffe066")) },
  obj_reactive: { w: 16, h: 16, paint: (c) => (rect(c, 1, 1, 14, 14, "#3d3d55"), circle(c, 8, 8, 4, "#777799")) },
  obj_reactive_on: { w: 16, h: 16, paint: (c) => (rect(c, 1, 1, 14, 14, "#3d3d55"), circle(c, 8, 8, 4, "#ffd23a")) },
  obj_spikes: {
    w: 16,
    h: 16,
    paint: (c) => {
      rect(c, 0, 0, 16, 16, "#2c2c34");
      for (let x = 0; x < 16; x += 5) for (let y = 0; y < 16; y += 5) poly(c, [x + 1, y + 4, x + 2.5, y, x + 4, y + 4], "#c8d0da");
    },
  },
  obj_pit: { w: 16, h: 16, paint: (c) => (rect(c, 0, 0, 16, 16, "#06060a"), rect(c, 0, 0, 16, 2, "#26262e")) },
  obj_sign: { w: 16, h: 16, paint: (c) => (rect(c, 7, 9, 2, 7, "#5b4632"), rect(c, 1, 1, 14, 9, "#a4612a"), rect(c, 3, 4, 10, 1, "#4a2a10"), rect(c, 3, 6, 7, 1, "#4a2a10")) },
  icon_sword: { w: 16, h: 16, paint: (c) => (poly(c, [3, 13, 11, 5, 13, 3, 11, 5, 4, 14], "#e8eef5"), poly(c, [11, 2, 14, 2, 14, 5, 5, 14, 2, 11], "#c8d0da"), rect(c, 2, 11, 3, 3, "#d8b84a")) },
  icon_shield: { w: 16, h: 16, paint: (c) => (poly(c, [2, 2, 14, 2, 14, 8, 8, 15, 2, 8], "#1e3f8f"), poly(c, [4, 4, 12, 4, 12, 8, 8, 12.5, 4, 8], "#d63a3a")) },
  // Mirror Shield: a silver shield with a blue mirror face.
  icon_mirror_shield: { w: 16, h: 16, paint: (c) => (poly(c, [2, 2, 14, 2, 14, 8, 8, 15, 2, 8], "#c8d0da"), poly(c, [4, 4, 12, 4, 12, 8, 8, 12.5, 4, 8], "#5ab0e8"), rect(c, 5, 5, 2, 3, "#e8f6ff")) },
  // Pegasus Boots: a brown boot with a white wing.
  icon_boots: { w: 16, h: 16, paint: (c) => (rect(c, 5, 3, 5, 9, "#8a4b22"), rect(c, 5, 10, 9, 4, "#8a4b22"), rect(c, 5, 13, 9, 1, "#4a2a10"), poly(c, [10, 4, 15, 2, 14, 5, 11, 7], "#f0f0f0")) },
  // Roc's Feather: a long feather, its quill across.
  icon_feather: { w: 16, h: 16, paint: (c) => (poly(c, [3, 14, 6, 9, 11, 3, 14, 2, 13, 6, 8, 11], "#e8e0c8"), poly(c, [3, 14, 13, 3, 13.6, 3.6, 3.6, 14.6], "#9a7a4a")) },
  // Shovel: a wooden handle and a grey blade.
  icon_shovel: { w: 16, h: 16, paint: (c) => (poly(c, [10, 2, 12, 2, 6, 10, 4, 10], "#8a5a2b"), poly(c, [3, 9, 7, 9, 7, 13, 5, 15, 3, 13], "#b8c0c8")) },
  // Magic Powder: a small sack with sparkles.
  icon_magic_powder: { w: 16, h: 16, paint: (c) => (circle(c, 8, 10, 5, "#7a4fb5"), rect(c, 6, 4, 4, 3, "#7a4fb5"), rect(c, 6, 6, 4, 1, "#e8d070"), rect(c, 12, 2, 1, 1, "#fff6b0"), rect(c, 3, 3, 1, 1, "#fff6b0"), rect(c, 13, 6, 1, 1, "#fff6b0")) },
  // Hookshot: a grey launcher with a hook and a bit of chain.
  icon_hookshot: { w: 16, h: 16, paint: (c) => (rect(c, 2, 9, 7, 4, "#6a7280"), rect(c, 3, 13, 3, 2, "#8a5a2b"), rect(c, 8, 10, 2, 2, "#c8d0da"), rect(c, 10, 8, 2, 2, "#c8d0da"), poly(c, [12, 3, 15, 6, 13, 8, 11, 6], "#e0e6ee")) },
  icon_glove: { w: 16, h: 16, paint: (c) => (rect(c, 3, 6, 10, 8, "#c9a227"), rect(c, 3, 2, 2, 5, "#c9a227"), rect(c, 6, 1, 2, 5, "#c9a227"), rect(c, 9, 1, 2, 5, "#c9a227")) },
  icon_bomb: { w: 16, h: 16, paint: (c) => (circle(c, 8, 9, 6, "#1b1f3a"), circle(c, 6, 7, 2, "#5a6390"), rect(c, 8, 1, 1, 3, "#c9a24a"), rect(c, 9, 1, 1, 1, "#ff9a2e")) },
  icon_boomerang: { w: 16, h: 16, paint: (c) => poly(c, [2, 2, 14, 2, 14, 6, 6, 6, 6, 14, 2, 14], "#b5622b") },
  icon_bow: {
    w: 16,
    h: 16,
    paint: (c) => {
      c.strokeStyle = "#8b5a2b";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(4, 8, 7, -Math.PI / 2.4, Math.PI / 2.4);
      c.stroke();
      rect(c, 5, 2, 1, 12, "#e8e8e8");
    },
  },
  icon_fire_rod: { w: 16, h: 16, paint: (c) => (poly(c, [3, 14, 11, 6, 12, 7, 4, 15], "#8b2a1a"), circle(c, 12, 4, 3, "#ff7a1a"), circle(c, 12, 4, 1.5, "#ffe066")) },
  icon_healing_spell: { w: 16, h: 16, paint: (c) => (circle(c, 8, 8, 7, "#1d6b3a"), rect(c, 7, 3, 2, 10, "#bfffcf"), rect(c, 3, 7, 10, 2, "#bfffcf")) },
  icon_generic: { w: 16, h: 16, paint: (c) => (rect(c, 1, 1, 14, 14, "#444466"), rect(c, 5, 4, 6, 2, "#ddd"), rect(c, 9, 6, 2, 3, "#ddd"), rect(c, 7, 9, 2, 2, "#ddd"), rect(c, 7, 12, 2, 2, "#ddd")) },
  hud_heart_full: { w: 14, h: 14, paint: (c) => heart(c, "#e8323c", 1) },
  hud_heart_half: { w: 14, h: 14, paint: (c) => heart(c, "#e8323c", 0.5) },
  hud_heart_empty: { w: 14, h: 14, paint: (c) => heart(c, "#e8323c", 0) },
  hud_slot: { w: 20, h: 20, paint: (c) => (rect(c, 0, 0, 20, 20, "#f0e6c8"), rect(c, 2, 2, 16, 16, "#1c1c2a")) },
  pixel: { w: 1, h: 1, paint: (c) => rect(c, 0, 0, 1, 1, "#ffffff") },
  hud_heart8_full: { w: 7, h: 7, paint: (c) => heart8(c, 1) },
  hud_heart8_half: { w: 7, h: 7, paint: (c) => heart8(c, 0.5) },
  hud_heart8_empty: { w: 7, h: 7, paint: (c) => heart8(c, 0) },
  hud_rupee: { w: 8, h: 8, paint: (c) => grid(c, ["...o....", "..ogo...", ".oggGo..", ".ogGGo..", ".ogGGo..", ".oGGgo..", "..oGo...", "...o...."], { o: "#0a2a10", g: "#7cf09a", G: "#22a040" }) },
  hud_bomb: { w: 8, h: 8, paint: (c) => grid(c, [".....y..", "....o...", "..oooo..", ".obbbbo.", ".obwbbo.", ".obbbbo.", ".obbbbo.", "..oooo.."], { o: "#05050c", b: "#2a3060", w: "#a0b0ff", y: "#ffb030" }) },
  hud_arrow: { w: 8, h: 8, paint: (c) => grid(c, [".......w", "......ww", ".....bw.", "....b...", "...b....", "f.b.....", ".f......", "f.f....."], { w: "#e0e8f0", b: "#a06830", f: "#f0f0f0" }) },
  hud_key: { w: 8, h: 8, paint: (c) => grid(c, ["..yyy...", ".y...y..", ".y...y..", "..yyy...", "...y....", "...yy...", "...y....", "...yy..."], { y: "#f0c030" }) },
  hud_magic: { w: 8, h: 8, paint: (c) => grid(c, ["..bb....", "...b....", ".oooo...", "oggggo..", "oggggo..", "oggggo..", ".oooo...", "........"], { o: "#062010", g: "#3ad16b", b: "#a07040" }) },
  ...Object.fromEntries(DIGITS.map((_, n) => [`hud_digit_${n}`, { w: 6, h: 8, paint: (c: Ctx) => digit(c, n) }])),
};

// World sprites drawn as pixel grids in the PS Maker pack's palette replace the older drawings.
for (const [id, rows] of Object.entries(WORLD_SPRITES)) DEFS[id] = { w: rows[0].length, h: rows.length, paint: (c) => grid(c, rows, WORLD_PALETTE) };

export function builtinSpriteIds(): string[] {
  return Object.keys(DEFS);
}

/** Minimal surface of Phaser's TextureManager that we rely on. */
export interface TextureManagerLike {
  exists(key: string): boolean;
  createCanvas(key: string, width: number, height: number): { context: CanvasRenderingContext2D; refresh(): unknown } | null;
}

/** Built-in sprite id → project image (Zelda: Set Item Sprites): drawn instead of the built-in picture. */
const projectImages = new Map<string, string>();

/** Draws a project image (its id, loaded by PS Maker) in place of a built-in sprite; "" = the built-in one again. */
export function setSpriteImage(builtin: string, imageId: string): void {
  if (imageId) projectImages.set(builtin, imageId);
  else projectImages.delete(builtin);
}

/** The built-in sprites a project image replaces now. */
export function spriteImages(): ReadonlyMap<string, string> {
  return projectImages;
}

/** Built-in sprites with a picture of their own (for the editor's lists). */
export function isBuiltinSprite(id: string): boolean {
  return id in DEFS;
}

/**
 * Resolves a sprite id to a texture key: a project image set for it (Set Item Sprites), then an
 * existing (author) texture; built-in ids are generated on first use and cached by the TextureManager.
 */
export function resolveTexture(textures: TextureManagerLike, id: string): string | null {
  if (!id) return null;
  const own = projectImages.get(id);
  if (own && textures.exists(own)) return own;
  if (textures.exists(id)) return id;
  const def = DEFS[id];
  if (!def) return null;
  const key = TEXTURE_PREFIX + id;
  if (textures.exists(key)) return key;
  const tex = textures.createCanvas(key, def.w, def.h);
  if (!tex) return null;
  tex.context.imageSmoothingEnabled = false;
  def.paint(tex.context);
  crispEdges(tex.context, def.w, def.h);
  tex.refresh();
  return key;
}

/**
 * Canvas circles and polygons get soft, half-transparent edges; magnified in a pixel-art game
 * they look blurred. Every pixel becomes fully opaque or fully transparent.
 */
export function crispEdges(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  try {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    if (!(d instanceof Uint8ClampedArray)) return;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
    ctx.putImageData(img, 0, 0);
  } catch {
    // No pixel access (headless test canvas): keep the drawing as it is.
  }
}
