#!/usr/bin/env node
/**
 * Plays the demo project in the real PS Maker runtime, taken from a web export you made
 * yourself (PS Maker: Export → HTML5, unzipped). Nothing of the export is copied into this
 * repository: the check builds a temporary web export in tests/runtime/.artifacts/.
 *
 *   node scripts/runtime-check.mjs --export <unzipped PS Maker web export> --project <demo project folder> [--chrome <path>]
 *
 * The project is the folder made by make-demo-project.mjs. The check writes its story as the
 * export's game.dat (BSON, asset paths under game-assets/, as PS Maker 1.2.1 exports do), adds
 * plugins/manifest.json, then plays: the field starts, the dungeon puzzle, key door, waves and
 * guardian, and coming back to the field. Screenshots and the console go to the same folder.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "tests", "runtime", ".artifacts");

const opts = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith("--")) opts[process.argv[i].slice(2)] = process.argv[++i];
if (!opts.export || !opts.project) {
  console.log("Usage: node scripts/runtime-check.mjs --export <unzipped PS Maker web export> --project <demo project folder> [--chrome <path>]");
  process.exit(1);
}

/** BSON (the format of game.dat): documents, arrays, strings, int32/double, booleans, null. */
function bson(doc) {
  const enc = (o, isArr) => {
    const chunks = [];
    for (const [k, v] of isArr ? o.map((x, i) => [String(i), x]) : Object.entries(o)) {
      if (v === undefined) continue;
      const key = Buffer.concat([Buffer.from(k, "utf8"), Buffer.from([0])]);
      if (v === null) chunks.push(Buffer.from([10]), key);
      else if (typeof v === "boolean") chunks.push(Buffer.from([8]), key, Buffer.from([v ? 1 : 0]));
      else if (typeof v === "number" && Number.isInteger(v) && v >= -(2 ** 31) && v < 2 ** 31) {
        const b = Buffer.alloc(4);
        b.writeInt32LE(v);
        chunks.push(Buffer.from([16]), key, b);
      } else if (typeof v === "number") {
        const b = Buffer.alloc(8);
        b.writeDoubleLE(v);
        chunks.push(Buffer.from([1]), key, b);
      } else if (typeof v === "string") {
        const s = Buffer.from(v, "utf8");
        const l = Buffer.alloc(4);
        l.writeInt32LE(s.length + 1);
        chunks.push(Buffer.from([2]), key, l, s, Buffer.from([0]));
      } else if (typeof v === "object") chunks.push(Buffer.from([Array.isArray(v) ? 4 : 3]), key, enc(v, Array.isArray(v)));
      else throw new Error(`Cannot write ${typeof v} "${k}"`);
    }
    const body = Buffer.concat(chunks);
    const len = Buffer.alloc(4);
    len.writeInt32LE(body.length + 5);
    return Buffer.concat([len, body, Buffer.from([0])]);
  };
  return enc(doc, false);
}

function buildWebExport(project, runtime, out) {
  if (!existsSync(path.join(runtime, "index.html")) || !existsSync(path.join(runtime, "_app"))) throw new Error(`${runtime} is not an unzipped PS Maker web export (index.html and _app/ expected).`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(runtime)) if (!["game.dat", "game-assets", "plugins"].includes(f)) cpSync(path.join(runtime, f), path.join(out, f), { recursive: true });
  cpSync(path.join(project, "assets"), path.join(out, "game-assets"), { recursive: true });
  mkdirSync(path.join(out, "plugins"));
  const plugins = readdirSync(path.join(project, "plugins")).filter((f) => f.endsWith(".ps-maker.js"));
  for (const f of plugins) cpSync(path.join(project, "plugins", f), path.join(out, "plugins", f));
  writeFileSync(path.join(out, "plugins", "manifest.json"), JSON.stringify({ plugins }));
  const story = JSON.parse(readFileSync(path.join(project, "story.json"), "utf8"));
  const at = (v) => (v && !v.startsWith("game-assets/") ? `game-assets/${v}` : v);
  for (const s of [...(story.spritesheetAnimations ?? []), ...(story.animationStrips ?? []), ...(story.terrainTilesets ?? []), ...(story.mapObjects ?? [])]) s.src = at(s.src);
  for (const t of story.terrains ?? []) Object.assign(t, { terrainSrc: at(t.terrainSrc), autoTilesetSrc: at(t.autoTilesetSrc) });
  for (const f of story.gameUI?.fonts ?? []) f.key = at(f.key);
  writeFileSync(path.join(out, "game.dat"), bson(story));
}

const web = path.join(OUT, "web");
buildWebExport(path.resolve(opts.project), path.resolve(opts.export), web);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf" };
const server = http
  .createServer((req, res) => {
    const p = path.join(web, decodeURIComponent(new URL(req.url, "http://x").pathname));
    const f = existsSync(p) && !p.endsWith(path.sep) && !p.endsWith("/") ? p : path.join(p, "index.html");
    if (!f.startsWith(web) || !existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" }).end(readFileSync(f));
  })
  .listen(0, "127.0.0.1");
const browser = await chromium.launch(opts.chrome ? { executablePath: opts.chrome } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);

const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const hold = async (key, ms) => {
  await page.keyboard.down(key);
  await wait(ms);
  await page.keyboard.up(key);
};
const tp = (x, y) => ev(([x, y]) => window.game.scene.getScenes(true).find((m) => m.map).player.setPosition(x, y), [x, y]);
const state = () =>
  ev(() => {
    const z = window.ZeldaMakerToolkit;
    const w = z?.session?.world;
    const g = (id) => w?.get(id)?.objState;
    return {
      map: window.game.scene.getScenes(true).find((m) => m.map)?.map.id,
      toolkitMap: z?.session?.mapId,
      enemies: w ? w.list("enemy").filter((e) => e.alive).length : 0,
      gate: g("door@392,112"),
      chest: g("chest@140,200"),
      plate: g("pressure_plate@104,168"),
      shutter: g("door@96,112"),
      keyDoor: g("door@200,152"),
      secret: g("chest@300,60"),
      keys: z?.toolkit.inventory.count("key"),
    };
  });
let failed = 0;
const check = async (name, fn) => {
  try {
    const note = await fn();
    console.log(`  ✔ ${name}${note ? ` — ${note}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`  ✘ ${name} — ${e.message}`);
  }
};
const expect = (ok, what) => {
  if (!ok) throw new Error(what);
};

await page.waitForFunction(() => window.ZeldaMakerToolkit?.session && window.game?.scene?.getScenes(true).some((m) => m.map), null, { timeout: 30000 });
await wait(1500);
await check("the field starts: Toolkit, HUD, enemies from the PS Maker map start", async () => {
  const s = await state();
  expect(s.map === "zelda-demo-field" && s.toolkitMap === "zelda-demo-field" && s.enemies === 6, JSON.stringify(s));
  await page.screenshot({ path: path.join(OUT, "field.png") });
  return `${s.enemies} enemies`;
});
await check("a chest opens with Z", async () => {
  await tp(140, 218);
  await hold("ArrowUp", 250);
  await page.keyboard.press("z");
  await wait(1500);
  await page.keyboard.press("z");
  const s = await state();
  expect(s.chest === "opened", JSON.stringify(s));
});
await check("PS Maker Change map trigger takes the player to the dungeon", async () => {
  await ev(() => window.ZeldaMakerToolkit.session.world.get("button@340,40").setState("on"));
  await wait(300);
  await tp(370, 112);
  await wait(300);
  await tp(398, 112);
  await page.waitForFunction(() => window.ZeldaMakerToolkit.session?.mapId === "zelda-demo-dungeon", null, { timeout: 8000 });
  await wait(1000);
});
await check("the block slides onto the plate and the shutter opens", async () => {
  await tp(66, 168);
  await hold("ArrowRight", 1500);
  await wait(500);
  const s = await state();
  expect(s.plate === "on" && s.shutter === "opened", JSON.stringify(s));
});
await check("the key from the chest opens the locked door", async () => {
  await tp(60, 66);
  await hold("ArrowUp", 250);
  await page.keyboard.press("z");
  await wait(1500);
  await page.keyboard.press("z");
  await tp(170, 150);
  await hold("ArrowRight", 700);
  await wait(300);
  const s = await state();
  expect(s.keyDoor === "unlocked", JSON.stringify(s));
});
await check("walking into the arena starts the waves; the guardian reveals the chest", async () => {
  await hold("ArrowRight", 900);
  await wait(1500);
  const counts = [];
  for (let i = 0; i < 3; i++) {
    counts.push((await state()).enemies);
    await ev(() => window.ZeldaMakerToolkit.session.world.list("enemy").forEach((e) => e.alive && e.die()));
    await wait(2500);
  }
  const s = await state();
  await page.screenshot({ path: path.join(OUT, "dungeon.png") });
  expect(counts.join() === "2,2,1" && s.secret === "revealed", `${counts} ${JSON.stringify(s)}`);
  return `waves ${counts.join(" → ")}`;
});
await check("back on the field (the map wakes up): enemies again, opened chest and gate stay", async () => {
  await tp(30, 200);
  await wait(300);
  await tp(3, 200);
  await page.waitForFunction(() => window.ZeldaMakerToolkit.session?.mapId === "zelda-demo-field", null, { timeout: 8000 });
  await wait(1000);
  const s = await state();
  expect(s.enemies === 6 && s.chest === "opened" && s.gate === "opened", JSON.stringify(s));
  await page.screenshot({ path: path.join(OUT, "field-again.png") });
});
const errors = logs.filter((l) => l.startsWith("[pageerror]") || (l.startsWith("[error]") && !/Failed to load resource/.test(l)));
await check("no page errors", async () => expect(errors.length === 0, errors.slice(0, 3).join(" | ")));
writeFileSync(path.join(OUT, "console.log"), logs.join("\n"));
await browser.close();
server.close();
console.log(failed ? `${failed} runtime check(s) failed. Output: ${OUT}` : `All runtime checks passed. Output: ${OUT}`);
process.exitCode = failed ? 1 : 0;
