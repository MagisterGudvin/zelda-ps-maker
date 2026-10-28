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
  for (const i of story.images ?? []) i.url = at(i.url);
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

const button = (label) => page.locator("button", { hasText: label }).first();
await check("the game opens on the main menu (PS Maker Add UI buttons); New game goes to the field", async () => {
  await button("New game").waitFor({ state: "visible", timeout: 30000 });
  await wait(800);
  const onTitle = await ev(() => ({ map: window.game.scene.getScenes(true).find((m) => m.map)?.map.id, toolkit: !!window.ZeldaMakerToolkit?.session }));
  expect(onTitle.map === "zelda-demo-title" && !onTitle.toolkit, JSON.stringify(onTitle));
  await page.screenshot({ path: path.join(OUT, "title.png") });
  await button("New game").click();
  await page.waitForFunction(() => window.ZeldaMakerToolkit?.session?.mapId === "zelda-demo-field", null, { timeout: 15000 });
  await wait(1500);
});
await check("the field starts: Toolkit, HUD, enemies from the PS Maker map start", async () => {
  const s = await state();
  expect(s.map === "zelda-demo-field" && s.toolkitMap === "zelda-demo-field" && s.enemies === 6, JSON.stringify(s));
  await page.screenshot({ path: path.join(OUT, "field.png") });
  return `${s.enemies} enemies`;
});
// The checks spend a while near the start (sign, villager) while the field's enemies roam: a
// larger health reserve keeps the player from dying and respawning in the middle of a check.
await ev(() => {
  const tk = window.ZeldaMakerToolkit.toolkit;
  tk.state.player.maxHp = tk.state.player.hp = 40;
  window.ZeldaMakerToolkit.session.hud?.markDirty();
});
await check("HUD Style: the toolkit HUD drawn with the project's UI pictures (Images)", async () => {
  const keys = await ev(() => {
    const hud = window.game.scene.getScene("ZeldaMakerToolkitHUD");
    return [...new Set(hud.children.list.filter((o) => o.visible && o.texture?.key?.startsWith("zelda-ui-")).map((o) => o.texture.key))].sort();
  });
  for (const k of ["zelda-ui-heart-full", "zelda-ui-rupee", "zelda-ui-digits", "zelda-ui-item-box", "zelda-ui-hud-bar"]) expect(keys.includes(k), `${k} not drawn: ${keys.join(", ")}`);
  return `${keys.length} pictures`;
});
await check("Message Style: reading the sign opens the toolkit box in the project's dialogue layout (9-slice panel); Z closes it", async () => {
  await tp(32, 142);
  await hold("ArrowUp", 200);
  await page.keyboard.press("z");
  await wait(700);
  const open = await ev(() => {
    const hud = window.game.scene.getScene("ZeldaMakerToolkitHUD");
    return {
      pieces: hud.children.list.filter((o) => o.visible && o.texture?.key === "zelda-ui-panel").length,
      text: hud.children.list.find((o) => o.type === "Text" && o.visible && o.depth === 16)?.text ?? "",
      paused: window.ZeldaMakerToolkit.session.isPaused("message"),
    };
  });
  await page.screenshot({ path: path.join(OUT, "sign-box.png") });
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("z");
    await wait(300);
  }
  const closed = await ev(() => !window.ZeldaMakerToolkit.session.isPaused("message"));
  expect(open.pieces === 9 && open.paused && open.text.startsWith("Arrows"), JSON.stringify(open));
  expect(closed, "box still open after Z");
  return `"${open.text.slice(0, 24)}…"`;
});
await check("the villager talks with PS Maker's own Dialogue (styled panel); the toolkit waits meanwhile", async () => {
  await tp(80, 140);
  await hold("ArrowUp", 150);
  await page.keyboard.press("z");
  await page.waitForFunction(() => document.body.innerText.includes("dangerous"), null, { timeout: 5000 }).catch(() => {});
  const during = await ev(() => ({ dialogue: window.game.scene.getScenes(true).find((m) => m.map)?.playingDialogue === true, paused: window.ZeldaMakerToolkit.session.isPaused("dialogue"), text: document.body.innerText.includes("dangerous"), name: document.body.innerText.includes("Villager") }));
  await page.screenshot({ path: path.join(OUT, "villager-dialogue.png") });
  // Z finishes a page, then turns it; stop once it closes (one more Z would talk to him again).
  let after = true;
  for (let i = 0; i < 10 && after; i++) {
    await page.keyboard.press("z");
    await wait(500);
    after = await ev(() => window.game.scene.getScenes(true).find((m) => m.map)?.playingDialogue === true);
  }
  expect(during.text && during.name && during.dialogue && during.paused, JSON.stringify(during));
  expect(!after, "dialogue still open");
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
await check("Escape opens the PS Maker options menu (game paused); Save game keeps the Toolkit's progress in the save", async () => {
  await page.keyboard.press("Escape");
  await button("Save game").waitFor({ state: "visible", timeout: 5000 });
  const t0 = await ev(() => window.ZeldaMakerToolkit.session.tick);
  await wait(500);
  const t1 = await ev(() => window.ZeldaMakerToolkit.session.tick);
  await page.screenshot({ path: path.join(OUT, "options.png") });
  await button("Save game").click();
  await wait(1500);
  const progress = await ev(() => JSON.parse(window.game.variables.get("zelda-progress").value || "{}"));
  // Toolkit sounds are scaled by the menu's Sound Volume (PlayerAudioSettings.scaleSoundVolume).
  const volume = await ev(() => window.game.audioSettings?.scaleSoundVolume?.(0.5));
  await page.keyboard.press("Escape");
  await wait(500);
  expect(t1 === t0, `toolkit ran while the menu was open (${t0} → ${t1})`);
  expect(typeof volume === "number", "game.audioSettings.scaleSoundVolume is missing");
  expect(progress.state?.objects?.["zelda-demo-field/chest@140,200"] === "opened", `progress variable: ${JSON.stringify(progress.state?.objects)}`);
  return "chest opened in the progress variable";
});
await check("walking into a solid toolkit object does not shake the screen (also on fast screens)", async () => {
  // Fewer toolkit ticks than rendered frames, as on a 120-144 Hz screen.
  await ev(() => (window.ZeldaMakerToolkit.toolkit.config.world.fixedStepHz = 15));
  // Lean from below on the cracked wall at (56, 88): it closes a row of map walls, so PS Maker
  // cannot steer the player around it (it does around a free-standing rock). Without toolkit solid
  // bodies the player is drawn inside it and pushed out again on every frame (the shake of 0.13):
  // 14 of 35 frames inside, 27 back-and-forth moves of the player and the camera.
  await tp(56, 100);
  await ev(() => {
    const s = window.game.scene.getScenes(true).find((m) => m.map);
    window.__shake = [];
    window.__shakeOn = () => {
      const b = s.player.body;
      window.__shake.push([b.x, b.y, b.width, b.height, Math.round(s.cameras.main.scrollX * 100), Math.round(s.cameras.main.scrollY * 100)]);
    };
    s.events.on("render", window.__shakeOn);
  });
  await hold("ArrowUp", 1200);
  const f = await ev(() => {
    const s = window.game.scene.getScenes(true).find((m) => m.map);
    s.events.off("render", window.__shakeOn);
    window.ZeldaMakerToolkit.toolkit.config.world.fixedStepHz = 60;
    return window.__shake;
  });
  const rock = { x: 48, y: 80, w: 16, h: 16 };
  const inside = f.filter(([x, y, w, h]) => x < rock.x + rock.w - 0.5 && x + w > rock.x + 0.5 && y < rock.y + rock.h - 0.5 && y + h > rock.y + 0.5);
  // Back and forth: a coordinate that moves one way and then the other on the next frame.
  const flips = (k) => {
    let n = 0;
    let last = 0;
    for (let a = 1; a < f.length; a++) {
      const d = Math.sign(Math.round((f[a][k] - f[a - 1][k]) * 100));
      if (d && last && d !== last) n++;
      if (d) last = d;
    }
    return n;
  };
  const back = { x: flips(0), y: flips(1), camX: flips(4), camY: flips(5) };
  expect(f.length >= 20, `only ${f.length} frames`);
  expect(inside.length === 0, `player inside the wall in ${inside.length} frames`);
  expect(Object.values(back).every((n) => n === 0), `back and forth ${JSON.stringify(back)}`);
  return `${f.length} frames, never inside, no back and forth`;
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
  // Walk to the door from the middle of the room: decor must not block the way.
  await tp(130, 152);
  await hold("ArrowRight", 1200);
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
await check("reload, Continue, load the save: the Toolkit starts on the restored map with its progress", async () => {
  await page.reload();
  await button("Continue").waitFor({ state: "visible", timeout: 30000 });
  await wait(800);
  const fresh = await ev(() => !!window.ZeldaMakerToolkit?.session);
  expect(!fresh, "toolkit running on the menu after reload");
  await button("Continue").click();
  await wait(1000);
  await page.screenshot({ path: path.join(OUT, "load-menu.png") });
  await page.locator("button", { hasText: /Save 1/ }).first().click({ timeout: 5000 });
  await page.waitForFunction(() => window.ZeldaMakerToolkit?.session?.mapId === "zelda-demo-field", null, { timeout: 15000 });
  await wait(2000);
  const s = await state();
  await page.screenshot({ path: path.join(OUT, "loaded.png") });
  expect(s.map === "zelda-demo-field" && s.enemies === 6 && s.chest === "opened", JSON.stringify(s));
  return "chest opened, 6 enemies";
});
const errors = logs.filter((l) => l.startsWith("[pageerror]") || (l.startsWith("[error]") && !/Failed to load resource/.test(l)));
await check("no page errors", async () => expect(errors.length === 0, errors.slice(0, 3).join(" | ")));
writeFileSync(path.join(OUT, "console.log"), logs.join("\n"));
await browser.close();
server.close();
console.log(failed ? `${failed} runtime check(s) failed. Output: ${OUT}` : `All runtime checks passed. Output: ${OUT}`);
process.exitCode = failed ? 1 : 0;
