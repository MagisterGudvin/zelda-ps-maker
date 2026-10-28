// UI pictures for the demo project: dialogue and menu panels, buttons, the HUD bar, hearts,
// counter icons, digits, item box and magic meter. Drawn here as pixel grids in a palette that
// goes with the built-in "Tiles 'N Such" assets (own drawings, no copied art), written as PNG
// with node:zlib only.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";

/** Palette: one character per colour ("." = transparent). */
export const UI_PALETTE = {
  k: "#1f1a24", // outline
  w: "#4a2f1c", // dark wood
  W: "#6e4a2b",
  L: "#9a6b3c", // light wood
  c: "#f2e4bb", // cream
  C: "#cdb88a",
  n: "#1c2236", // panel navy
  N: "#2b3552",
  T: "#141a2acc", // translucent navy (HUD bar)
  r: "#d43d3d",
  R: "#f6806b",
  d: "#6e1f2a",
  e: "#3a2c36", // empty heart
  g: "#3d9e4c",
  G: "#86d873",
  h: "#1f6338",
  y: "#e7b532",
  Y: "#fbe58b",
  o: "#93651a",
  s: "#8e9aa8",
  S: "#d6dde4",
  m: "#43c066",
  M: "#a6f2ad",
};

/** A frame: rings of colours from the outside in, then a fill. */
function frame(w, h, rings, fill) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      // Rounded outer corner: the corner pixel of the outline is left out.
      if (d === 0 && (x === 0 || x === w - 1) && (y === 0 || y === h - 1)) row += ".";
      else row += d < rings.length ? rings[d] : fill;
    }
    rows.push(row);
  }
  return rows;
}

const HEART = [".kk...kk.", "kRrk.kRrk", "kRrrkrrrk", "krrrrrrrk", ".krrrrrk.", "..krrrk..", "...krk...", "....k...."];
const heart = (mode) => HEART.map((row) => [...row].map((ch, x) => (ch === "." || ch === "k" ? ch : mode === "empty" || (mode === "half" && x > 4) ? "e" : ch)).join(""));

const GLYPHS = {
  0: [".cc.", "c..c", "c..c", "c..c", "c..c", "c..c", ".cc."],
  1: [".c..", "cc..", ".c..", ".c..", ".c..", ".c..", "ccc."],
  2: [".cc.", "c..c", "...c", "..c.", ".c..", "c...", "cccc"],
  3: ["ccc.", "...c", "...c", ".cc.", "...c", "...c", "ccc."],
  4: ["..c.", ".cc.", "c.c.", "c.c.", "cccc", "..c.", "..c."],
  5: ["cccc", "c...", "ccc.", "...c", "...c", "c..c", ".cc."],
  6: [".cc.", "c...", "c...", "ccc.", "c..c", "c..c", ".cc."],
  7: ["cccc", "...c", "..c.", "..c.", ".c..", ".c..", ".c.."],
  8: [".cc.", "c..c", "c..c", ".cc.", "c..c", "c..c", ".cc."],
  9: [".cc.", "c..c", "c..c", ".ccc", "...c", "...c", ".cc."],
};
/** Ten 5x8 digits in one row: cream with a dark shadow down-right. */
function digitStrip() {
  const rows = Array.from({ length: 8 }, () => Array(50).fill("."));
  for (let d = 0; d < 10; d++) {
    const g = GLYPHS[d];
    for (let y = 0; y < 7; y++) for (let x = 0; x < 4; x++) if (g[y][x] === "c") rows[y][d * 5 + x] = "c";
    for (let y = 0; y < 7; y++) for (let x = 0; x < 4; x++) if (g[y][x] === "c" && rows[y + 1][d * 5 + x + 1] === ".") rows[y + 1][d * 5 + x + 1] = "k";
  }
  return rows.map((r) => r.join(""));
}

/** Magic fill: the inside of the magic frame (border 2), green with a light left edge. */
function magicFill(w, h) {
  return frame(w, h, [".", "."], "m").map((row) => row.replace(/^(\.\.)m/, "$1M"));
}

/** Every picture: file name (asset key), display name in PS Maker, grid. */
export const UI_ASSETS = [
  { key: "zelda-ui-panel.png", name: "Zelda UI Panel", grid: frame(24, 24, ["k", "w", "L", "W", "k", "C"], "n"), slice: 7 },
  { key: "zelda-ui-button.png", name: "Zelda UI Button", grid: frame(24, 24, ["k", "C", "c", "k"], "N"), slice: 6 },
  { key: "zelda-ui-hud-bar.png", name: "Zelda HUD Bar", grid: frame(16, 16, ["k", "W", "w"], "T"), slice: 4 },
  { key: "zelda-ui-heart-full.png", name: "Zelda Heart Full", grid: heart("full") },
  { key: "zelda-ui-heart-half.png", name: "Zelda Heart Half", grid: heart("half") },
  { key: "zelda-ui-heart-empty.png", name: "Zelda Heart Empty", grid: heart("empty") },
  {
    key: "zelda-ui-rupee.png",
    name: "Zelda Rupee Icon",
    grid: ["....kk....", "...kGgk...", "..kGggGk..", "..kGgggk..", "..kGgggk..", "..kGgggk..", "..kGgghk..", "..khgghk..", "...khhk...", "....kk...."],
  },
  {
    key: "zelda-ui-bomb.png",
    name: "Zelda Bomb Icon",
    grid: [".......yY.", "......ko..", ".....k....", "...kkkk...", "..kNNnnk..", ".kNSnnnnk.", ".kNnnnnnk.", ".knnnnnnk.", "..knnnnk..", "...kkkk..."],
  },
  {
    key: "zelda-ui-arrow.png",
    name: "Zelda Arrow Icon",
    grid: [".......kSk", "......kSSk", ".....kSkk.", "....kWk...", "...kWk....", "..kWk.....", ".kWk......", "kcck......", "kck.......", "kk........"],
  },
  {
    key: "zelda-ui-key.png",
    name: "Zelda Key Icon",
    grid: ["..kkkk....", ".kyYYyk...", ".kyk.kyk..", ".kyk.kyk..", ".kyYYyk...", "..kyyk....", "...kyk....", "...kyyk...", "...kyk....", "...kyyk..."],
  },
  { key: "zelda-ui-digits.png", name: "Zelda Digits", grid: digitStrip() },
  { key: "zelda-ui-item-box.png", name: "Zelda Item Box", grid: frame(22, 22, ["k", "c", "C", "k"], "n") },
  { key: "zelda-ui-magic-frame.png", name: "Zelda Magic Frame", grid: frame(8, 30, ["k", "c"], "n") },
  { key: "zelda-ui-magic-fill.png", name: "Zelda Magic Fill", grid: magicFill(8, 30) },
];

function rgba(hex) {
  const v = hex.slice(1);
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), v.length === 8 ? parseInt(v.slice(6, 8), 16) : 255];
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG (8-bit RGBA, no filter) of a palette grid. */
export function pngOf(grid, palette = UI_PALETTE) {
  const h = grid.length;
  const w = grid[0].length;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  grid.forEach((row, y) => {
    if (row.length !== w) throw new Error(`row ${y} is ${row.length} wide, expected ${w}`);
    raw[y * (w * 4 + 1)] = 0;
    [...row].forEach((ch, x) => {
      const color = ch === "." ? [0, 0, 0, 0] : palette[ch] ? rgba(palette[ch]) : null;
      if (!color) throw new Error(`unknown colour "${ch}" at ${x},${y}`);
      raw.set(color, y * (w * 4 + 1) + 1 + x * 4);
    });
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Writes every UI picture into a project's assets folder. */
export function writeUiAssets(dir) {
  for (const a of UI_ASSETS) writeFileSync(path.join(dir, a.key), pngOf(a.grid));
  return UI_ASSETS.map((a) => a.key);
}
