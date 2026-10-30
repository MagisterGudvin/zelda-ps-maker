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
// Russian browser language, as the author's: Toolkit texts (Start Toolkit → Language: auto) are Russian.
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: "ru-RU" });
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
/** Puts the player at (x, y); again if PS Maker moved them back in the same frame (a dialogue closing). */
const tp = async (x, y) => {
  for (let i = 0; i < 5; i++) {
    const at = await ev(([x, y]) => {
      const p = window.game.scene.getScenes(true).find((m) => m.map).player;
      p.setPosition(x, y);
      return [p.x, p.y];
    }, [x, y]);
    await wait(100);
    const now = await ev(() => {
      const p = window.game.scene.getScenes(true).find((m) => m.map).player;
      return [p.x, p.y];
    });
    if (Math.hypot(now[0] - x, now[1] - y) < 6 && Math.hypot(at[0] - x, at[1] - y) < 1) return;
  }
};
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

/** Presses Z until neither a PS Maker dialogue nor the toolkit's message is open (item received...). */
const dismiss = async () => {
  for (let i = 0; i < 12; i++) {
    await wait(400);
    const open = await ev(() => window.game.scene.getScenes(true).find((m) => m.map)?.playingDialogue === true || window.ZeldaMakerToolkit?.session?.isPaused("message") === true);
    if (!open) return;
    await page.keyboard.press("z");
  }
};
const button = (label) => page.locator("button", { hasText: label }).first();
/** The toolkit's open screen and its selected button. */
const screenNow = () => ev(() => ({ screen: window.ZeldaMakerToolkit?.session?.screens?.current?.name ?? null, focus: window.ZeldaMakerToolkit?.session?.screens?.current?.focus ?? null, paused: window.ZeldaMakerToolkit?.session?.isPaused("screen") ?? false }));
/** Visible texts the toolkit draws (HUD scene). */
const hudTexts = () => ev(() => window.game.scene.getScene("ZeldaMakerToolkitHUD").children.list.filter((o) => o.type === "Text" && o.visible && o.text).map((o) => ({ text: o.text, font: o.style.fontFamily })));
await check("the game opens on the title screen made in the UI Designer (toolkit on the title map, HUD hidden, player hidden); Z on New game goes to the field", async () => {
  await page.waitForFunction(() => window.ZeldaMakerToolkit?.session?.screens?.current?.name === "title", null, { timeout: 30000 });
  await wait(1200);
  const onTitle = await ev(() => {
    const scene = window.game.scene.getScenes(true).find((m) => m.map);
    const hud = window.game.scene.getScene("ZeldaMakerToolkitHUD");
    const shown = hud.children.list.filter((o) => o.visible);
    return {
      map: scene?.map.id,
      hearts: shown.filter((o) => o.texture?.key === "zelda-ui-heart-full").length,
      buttons: shown.filter((o) => o.texture?.key === "zelda-ui-button").length,
      texts: shown.filter((o) => o.type === "Text").map((o) => o.text),
      player: scene.player.visible && scene.player.alpha > 0,
      domButtons: document.querySelectorAll("button").length,
    };
  });
  const focus = (await screenNow()).focus;
  await page.screenshot({ path: path.join(OUT, "title.png") });
  expect(onTitle.map === "zelda-demo-title" && onTitle.hearts === 0 && onTitle.buttons >= 4 * 9, JSON.stringify(onTitle));
  for (const t of ["New game", "Continue", "Settings", "Exit"]) expect(onTitle.texts.includes(t), `"${t}" not drawn (${onTitle.texts.join(", ")})`);
  expect(!onTitle.player, "the player shows on the title");
  expect(focus === "newGame", `selected ${focus}`);
  await page.keyboard.press("z");
  await page.waitForFunction(() => window.ZeldaMakerToolkit?.session?.mapId === "zelda-demo-field", null, { timeout: 15000 });
  await wait(1500);
  return `4 buttons in the demo's pictures (9-slice), no HUD; ${onTitle.domButtons} PS Maker buttons on the page`;
});
await check("the field starts: Toolkit, HUD, enemies from the PS Maker map start", async () => {
  const s = await state();
  expect(s.map === "zelda-demo-field" && s.toolkitMap === "zelda-demo-field" && s.enemies === 6, JSON.stringify(s));
  await page.screenshot({ path: path.join(OUT, "field.png") });
  return `${s.enemies} enemies`;
});
await check("HUD (Zelda: UI Layout): hearts, counters, item box, magic and 9-slice panels in the demo's pictures, one layout pixel per map pixel", async () => {
  const hud = () =>
    ev(() => {
      const scene = window.game.scene.getScene("ZeldaMakerToolkitHUD");
      const zoom = window.game.scene.getScenes(true).find((m) => m.map).cameras.main.zoom;
      const pics = scene.children.list.filter((o) => o.visible && o.texture?.key?.startsWith("zelda-ui-"));
      const count = (key) => pics.filter((o) => o.texture.key === key).length;
      const heart = pics.find((o) => o.texture.key.startsWith("zelda-ui-heart-"));
      return {
        keys: [...new Set(pics.map((o) => o.texture.key))].sort(),
        full: count("zelda-ui-heart-full"),
        half: count("zelda-ui-heart-half"),
        empty: count("zelda-ui-heart-empty"),
        // Screen pixels per picture pixel against screen pixels per map pixel.
        heartScale: heart ? heart.displayWidth / heart.frame.width : 0,
        zoom,
      };
    });
  const before = await hud();
  // One and a half hearts (the HUD is redrawn on toolkit events, as setHealth sends).
  await ev(() => {
    const tk = window.ZeldaMakerToolkit.toolkit;
    tk.state.player.hp = 3;
    tk.bus.emit("zelda:player:healthChanged", { hp: 3, maxHp: tk.state.player.maxHp, delta: 0 });
  });
  await wait(300);
  const after = await hud();
  // One heart left: the demo's "LOW HEALTH" warning shows and blinks (its opacity changes over time).
  await ev(() => {
    const tk = window.ZeldaMakerToolkit.toolkit;
    tk.state.player.hp = 2;
    tk.bus.emit("zelda:player:healthChanged", { hp: 2, maxHp: tk.state.player.maxHp, delta: 0 });
  });
  const blink = [];
  for (let i = 0; i < 6; i++) {
    await wait(130);
    blink.push(await ev(() => window.game.scene.getScene("ZeldaMakerToolkitHUD").children.list.find((o) => o.type === "Text" && o.visible && o.text === "LOW HEALTH")?.alpha ?? -1));
  }
  await ev(() => {
    // The checks spend a while near the start (sign, villager) while the field's enemies roam: a
    // larger health reserve keeps the player from dying and respawning in the middle of a check.
    const tk = window.ZeldaMakerToolkit.toolkit;
    tk.state.player.maxHp = tk.state.player.hp = 40;
  });
  await page.screenshot({ path: path.join(OUT, "hud.png") });
  for (const k of ["zelda-ui-heart-full", "zelda-ui-rupee", "zelda-ui-digits", "zelda-ui-item-box", "zelda-ui-magic-frame", "zelda-ui-hud-bar"]) expect(before.keys.includes(k), `${k} not drawn (${before.keys.join(", ")})`);
  expect(before.heartScale === before.zoom, `a heart pixel is ${before.heartScale} screen px, a map pixel ${before.zoom}`);
  expect(before.full === 3 && after.full === 1 && after.half === 1 && after.empty === 1, `hearts ${JSON.stringify([before, after].map((h) => [h.full, h.half, h.empty]))}`);
  expect(blink.every((a) => a >= 0) && blink.includes(0) && blink.includes(1), `LOW HEALTH opacity over time: ${blink}`);
  return `heart pixel = map pixel = ${before.zoom} screen px; 3 hearts → 1 + half; LOW HEALTH blinks at one heart (${blink.join(",")})`;
});
/** Whether a font draws Cyrillic itself: its width of "Жыщ" differs from that of the fallback alone. */
const cyrillicIn = (family) =>
  ev((family) => {
    const c = document.createElement("canvas").getContext("2d");
    const width = (font) => ((c.font = font), c.measureText("ЖыщЮя").width);
    return width(`32px "${family}", monospace`) !== width("32px monospace");
  }, family);
await check("the toolkit loads the project fonts itself when PS Maker has not (the demo font since the title screen, PixelOperator on request); the demo font has Cyrillic, PixelOperator has not", async () => {
  const r = await ev(async () => {
    const family = "ps-maker-font-zelda-font-pixelify-sans";
    window.ZeldaMakerToolkit.session.host.loadProjectFont("font-pixel-operator");
    const loaded = (fam) => [...document.fonts].some((f) => f.family.replace(/["']/g, "") === fam && f.status === "loaded");
    for (let i = 0; i < 30 && !(loaded(family) && loaded("ps-maker-font-font-pixel-operator")); i++) await new Promise((ok) => setTimeout(ok, 100));
    return { demo: loaded(family), operator: loaded("ps-maker-font-font-pixel-operator") };
  });
  expect(r.demo && r.operator, `loaded: ${JSON.stringify(r)}`);
  const demo = await cyrillicIn("ps-maker-font-zelda-font-pixelify-sans");
  const operator = await cyrillicIn("ps-maker-font-font-pixel-operator");
  expect(demo, "Pixelify Sans draws no Cyrillic");
  expect(!operator, "PixelOperator draws Cyrillic (the cause of the wrong font is elsewhere)");
  return "Pixelify Sans loaded from game-assets, has Cyrillic; PixelOperator has none (falls back to another font)";
});
await check("message screen (UI Designer, role Message): reading the sign types its text out in the designer's box in the demo font; Z turns the pages and closes it, and the sign is not read again", async () => {
  await tp(32, 142);
  await hold("ArrowUp", 200);
  await page.keyboard.press("z");
  await wait(250);
  const typing = (await hudTexts()).find((t) => "Arrows: move. X: sword, hold it to spin. Z: open, lift, talk.".startsWith(t.text));
  await page.waitForFunction(() => window.game.scene.getScene("ZeldaMakerToolkitHUD").children.list.some((o) => o.type === "Text" && o.visible && o.text.endsWith("lift, talk.")), null, { timeout: 6000 }).catch(() => {});
  const open = await ev(() => ({
    dialogue: window.game.scene.getScenes(true).find((m) => m.map)?.playingDialogue === true,
    screen: window.ZeldaMakerToolkit.session.screens.current?.name,
    paused: window.ZeldaMakerToolkit.session.isPaused("message"),
  }));
  const page1 = (await hudTexts()).find((t) => t.text.startsWith("Arrows: move"));
  await page.screenshot({ path: path.join(OUT, "sign-message.png") });
  await page.keyboard.press("z");
  await page.waitForFunction(() => window.game.scene.getScene("ZeldaMakerToolkitHUD").children.list.some((o) => o.type === "Text" && o.visible && o.text.startsWith("C and B")), null, { timeout: 6000 }).catch(() => {});
  const page2 = (await hudTexts()).some((t) => t.text.startsWith("C and B"));
  let still = true;
  for (let i = 0; i < 6 && still; i++) {
    await page.keyboard.press("z");
    await wait(500);
    still = await ev(() => window.ZeldaMakerToolkit.session.isPaused("message"));
  }
  await wait(600);
  const again = await ev(() => window.ZeldaMakerToolkit.session.isPaused("message") || window.ZeldaMakerToolkit.session.screens.current !== null);
  expect(typing && typing.text.length < 60, `typing ${JSON.stringify(typing)}`);
  expect(!open.dialogue && open.screen === "message" && open.paused, JSON.stringify(open));
  expect(page1 && /zelda-font-pixelify-sans/.test(page1.font), `page 1 ${JSON.stringify(page1)}`);
  expect(page2, "the second page did not show");
  expect(!still && !again, `still open ${still}, opened again ${again}`);
  return `typed ("${typing.text}"), 2 pages, closed`;
});
await check("the villager talks in the dialogue box made in the UI Designer (Zelda: Dialogue: name plate, two pages, then the answers \"Any advice?\" / \"Bye!\"); \"Any advice?\" runs a project event with his advice; Z closes it and he does not start again", async () => {
  const hudHas = (part) => page.waitForFunction((part) => window.game.scene.getScene("ZeldaMakerToolkitHUD").children.list.some((o) => o.type === "Text" && o.visible && o.text.includes(part)), part, { timeout: 6000 }).then(() => true, () => false);
  await tp(80, 140);
  await hold("ArrowUp", 150);
  await page.keyboard.press("z");
  const page1 = await hudHas("by the gate.");
  const during = await ev(() => ({
    screen: window.ZeldaMakerToolkit.session.screens.current?.name ?? null,
    psDialogue: window.game.scene.getScenes(true).find((m) => m.map)?.playingDialogue === true,
    paused: window.ZeldaMakerToolkit.session.isPaused("message"),
  }));
  const texts = (await hudTexts()).map((t) => t.text);
  await page.screenshot({ path: path.join(OUT, "villager-dialogue.png") });
  await page.keyboard.press("z");
  const page2 = await hudHas("what you need.");
  const answers = (await hudHas("Any advice?")) && (await hudHas("Bye!"));
  const view = await ev(() => window.ZeldaMakerToolkit.session.screens.messageView());
  await page.screenshot({ path: path.join(OUT, "villager-answers.png") });
  await page.keyboard.press("z");
  const advice = await hudHas("Hold V to raise the shield");
  await page.screenshot({ path: path.join(OUT, "villager-advice.png") });
  // Then "You got Shovel!" and how to dig (two pages); Z through all of it.
  let open = true;
  for (let i = 0; i < 16 && open; i++) {
    await page.keyboard.press("z");
    await wait(450);
    open = await ev(() => window.ZeldaMakerToolkit.session.screens.current !== null || window.ZeldaMakerToolkit.session.isPaused("message"));
  }
  await wait(800);
  const again = await ev(() => window.ZeldaMakerToolkit.session.screens.current !== null || window.ZeldaMakerToolkit.session.isPaused("message"));
  const shovel = await ev(() => window.ZeldaMakerToolkit.toolkit.inventory.owns("shovel"));
  expect(shovel, "the advice event did not give the shovel");
  expect(page1 && during.screen === "dialogue" && !during.psDialogue && during.paused, JSON.stringify(during));
  expect(texts.includes("Villager"), `texts ${texts.join(" | ")}`);
  expect(page2 && answers && view.choices.join() === "Any advice?,Bye!" && view.text.endsWith("what you need."), `page 2 ${page2}, answers ${answers}, ${JSON.stringify(view)}`);
  expect(advice, "his advice (the answer's event) did not show");
  expect(!open && !again, `still open ${open}, started again ${again}`);
  return "name plate, 2 pages, answers on plates, advice from the event (and his shovel), closed, not started again";
});
/** The leaf element of the page that shows a text, with its font. */
const textOnPage = (part) =>
  ev((part) => {
    const el = [...document.querySelectorAll("body *")].find((e) => e.children.length === 0 && e.textContent.includes(part));
    return el ? { text: el.textContent.trim(), font: getComputedStyle(el).fontFamily } : null;
  }, part);
await check("a chest opens with Z; the note \"Получено: Бомбы ×5\" is drawn by the notification screen of the UI Designer (its plate) in the demo font", async () => {
  await tp(140, 218);
  await hold("ArrowUp", 250);
  await page.keyboard.press("z");
  await page.waitForFunction(() => window.game.scene.getScene("ZeldaMakerToolkitHUD").children.list.some((o) => o.type === "Text" && o.visible && o.text.includes("Получено")), null, { timeout: 6000 }).catch(() => {});
  const note = await ev(() => {
    const hud = window.game.scene.getScene("ZeldaMakerToolkitHUD");
    const t = hud.children.list.find((o) => o.type === "Text" && o.visible && o.text.includes("Получено"));
    // The plate: a HUD bar picture under the note (the HUD's own bars are at the top edge).
    const cx = t ? t.x + t.width / 2 : 0;
    const cy = t ? t.y + t.height / 2 : 0;
    const plates = hud.children.list.filter((o) => o.visible && o.texture?.key === "zelda-ui-hud-bar" && o.x <= cx && cx <= o.x + o.displayWidth && o.y <= cy && cy <= o.y + o.displayHeight).length;
    return t ? { text: t.text, font: t.style.fontFamily, plates } : null;
  });
  await page.screenshot({ path: path.join(OUT, "chest-note.png") });
  await dismiss();
  const s = await state();
  expect(s.chest === "opened", JSON.stringify(s));
  expect(note && /zelda-font-pixelify-sans/.test(note.font), `note: ${JSON.stringify(note)}`);
  expect(note.plates > 0, `no notification plate under the note: ${JSON.stringify(note)}`);
  return `"${note.text}" in ${note.font.split(",")[0]}`;
});
await check("the boomerang chest: \"Получено: Бумеранг!\" shows in the message screen in the demo font, which draws its Cyrillic", async () => {
  await tp(200, 60);
  await hold("ArrowUp", 250);
  await page.keyboard.press("z");
  await page.waitForFunction(() => window.game.scene.getScene("ZeldaMakerToolkitHUD").children.list.some((o) => o.type === "Text" && o.visible && o.text.includes("Бумеранг")), null, { timeout: 6000 }).catch(() => {});
  const box = (await hudTexts()).find((t) => t.text.includes("Бумеранг"));
  const screen = (await screenNow()).screen;
  await page.screenshot({ path: path.join(OUT, "chest-message.png") });
  await dismiss();
  expect(screen === "message", `screen ${screen}`);
  expect(box && /zelda-font-pixelify-sans/.test(box.font), `message text: ${JSON.stringify(box)}`);
  expect(await cyrillicIn("ps-maker-font-zelda-font-pixelify-sans"), "the demo font has no Cyrillic");
  return `"${box.text}" in ${box.font.split(",")[0]}`;
});
await check("the shield: not owned at the start; the chest by the start gives it; V held up shows it in front of the player, released lowers it", async () => {
  const owned = () => ev(() => window.ZeldaMakerToolkit.toolkit.state.inventory.owned.includes("shield"));
  const before = await owned();
  await tp(88, 198);
  await hold("ArrowUp", 250);
  await page.keyboard.press("z");
  await wait(800);
  await dismiss();
  const after = await owned();
  const shown = () => ev(() => window.game.scene.getScenes(true).find((m) => m.map).children.list.some((o) => o.visible && o.texture?.key?.includes("icon_shield")));
  await hold("ArrowDown", 100);
  await page.keyboard.down("v");
  await wait(300);
  const up = await shown();
  await page.screenshot({ path: path.join(OUT, "shield-up.png") });
  await page.keyboard.up("v");
  await wait(300);
  const down = await shown();
  expect(!before && after, `owned before ${before}, after the chest ${after}`);
  expect(up && !down, `held ${up}, released ${down}`);
  return "picked up from the chest, drawn while V is held";
});
await check("items as in Link's Awakening: Pegasus Boots and Roc's Feather from chests; in the inventory B puts the feather on the second item button; B jumps (drawn above the ground, then back); the shield up halves the walking speed; the boots on C dash", async () => {
  for (const x of [136, 168]) {
    await tp(x, 62);
    await hold("ArrowUp", 200);
    await page.keyboard.press("z");
    await wait(800);
    await dismiss();
  }
  const owned = await ev(() => ["boots", "feather"].map((id) => window.ZeldaMakerToolkit.toolkit.inventory.owns(id)));
  /** Opens I, moves the cursor to an item, presses a key there (c or b), closes I. */
  const putOn = async (item, key) => {
    await page.keyboard.press("i");
    await wait(400);
    const target = await ev((item) => window.ZeldaMakerToolkit.session.screens.gridItems().indexOf(item), item);
    for (let n = 0; n < 16; n++) {
      const cur = await ev(() => window.ZeldaMakerToolkit.session.screens.current?.cursor ?? -1);
      if (cur === target || cur < 0) break;
      await page.keyboard.press(cur < target ? "ArrowRight" : "ArrowLeft");
      await wait(120);
    }
    await page.keyboard.press(key);
    await wait(200);
    await page.keyboard.press("i");
    await wait(400);
  };
  await putOn("feather", "b");
  const slots = await ev(() => [1, 2].map((n) => window.ZeldaMakerToolkit.toolkit.inventory.slotItem(n)));
  // B: the jump. What is drawn: the sprite's y against its body, at render time.
  // The row under the top chests: no enemies, the wall at x 288 far ahead.
  await tp(130, 64);
  await ev(() => {
    const scene = window.game.scene.getScenes(true).find((m) => m.map);
    window.__lift = [];
    window.__liftSampler = () => {
      const p = scene.player;
      window.__lift.push(p.body.center.y - p.y);
    };
    scene.events.on("render", window.__liftSampler);
  });
  await page.keyboard.press("b");
  await wait(250);
  await page.screenshot({ path: path.join(OUT, "feather-jump.png") });
  await wait(600);
  const lift = await ev(() => {
    window.game.scene.getScenes(true).find((m) => m.map).events.off("render", window.__liftSampler);
    const l = window.__lift;
    return { base: l[0], top: Math.max(...l), last: l[l.length - 1] };
  });
  // The shield up: PS Maker's walking speed (Player.getSpeed) halves, and comes back.
  const speed = () => ev(() => window.game.scene.getScenes(true).find((m) => m.map).player.getSpeed());
  const base = await speed();
  await page.keyboard.down("v");
  await wait(250);
  const shielded = await speed();
  await page.keyboard.up("v");
  await wait(250);
  const back = await speed();
  // The boots on C: hold it, run up, dash to the right.
  await putOn("boots", "c");
  // Slimes wander onto the row: a hit during the dash stops it (knockback), so then it is tried again.
  let x0 = 0;
  let x1 = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    await tp(130, 64);
    await hold("ArrowRight", 60);
    await wait(1200);
    const hp0 = await ev(() => window.ZeldaMakerToolkit.toolkit.state.player.hp);
    x0 = await ev(() => window.game.scene.getScenes(true).find((m) => m.map).player.body.center.x);
    await page.keyboard.down("c");
    await wait(600);
    await page.screenshot({ path: path.join(OUT, "boots-dash.png") });
    await page.keyboard.up("c");
    await wait(200);
    x1 = await ev(() => window.game.scene.getScenes(true).find((m) => m.map).player.body.center.x);
    const hp1 = await ev(() => window.ZeldaMakerToolkit.toolkit.state.player.hp);
    if (x1 - x0 > 25 || hp1 === hp0) break;
  }
  expect(owned.every(Boolean), `owned ${owned}`);
  expect(slots[1] === "feather", `item buttons ${JSON.stringify(slots)}`);
  expect(lift.top - lift.base > 6 && Math.abs(lift.last - lift.base) < 0.5, `lift ${JSON.stringify(lift)}`);
  expect(Math.abs(shielded - base * 0.5) < 0.01 && back === base, `speed ${base} → ${shielded} → ${back}`);
  expect(x1 - x0 > 25, `dash ${x1 - x0}`);
  return `buttons C=${slots[0]}, B=${slots[1]}; jump ${(lift.top - lift.base).toFixed(1)} px; speed ${base} → ${shielded} → ${back}; dash ${Math.round(x1 - x0)} px`;
});
await check("the shovel digs up the Magic Powder buried below the start (Create Chest: Buried); the powder (10) is sprinkled; bow and bombs on C and B pressed together shoot a bomb arrow that explodes", async () => {
  const putOn = async (item, key) => {
    await page.keyboard.press("i");
    await wait(400);
    const target = await ev((item) => window.ZeldaMakerToolkit.session.screens.gridItems().indexOf(item), item);
    for (let n = 0; n < 16; n++) {
      const cur = await ev(() => window.ZeldaMakerToolkit.session.screens.current?.cursor ?? -1);
      if (cur === target || cur < 0) break;
      await page.keyboard.press(cur < target ? "ArrowRight" : "ArrowLeft");
      await wait(120);
    }
    await page.keyboard.press(key);
    await wait(200);
    await page.keyboard.press("i");
    await wait(400);
  };
  const inv = () => ev(() => { const t = window.ZeldaMakerToolkit.toolkit; return { powderItem: t.inventory.owns("magic_powder"), powder: t.inventory.count("powder"), arrows: t.inventory.count("arrows"), bombs: t.inventory.count("bombs"), spot: window.ZeldaMakerToolkit.session.world.get("buried@48,172")?.objState }; });
  await putOn("shovel", "c");
  await tp(48, 154);
  await hold("ArrowDown", 60);
  await wait(200);
  await page.keyboard.press("c");
  await wait(900);
  await page.screenshot({ path: path.join(OUT, "shovel-dug.png") });
  await dismiss();
  const dug = await inv();
  await putOn("magic_powder", "c");
  await tp(130, 64);
  await hold("ArrowRight", 60);
  await wait(200);
  await page.keyboard.press("c");
  await wait(150);
  await page.screenshot({ path: path.join(OUT, "magic-powder.png") });
  await wait(400);
  const sprinkled = await inv();
  // The bow from its chest; bow on C, bombs on B; both pressed together.
  await tp(248, 62);
  await hold("ArrowUp", 200);
  await page.keyboard.press("z");
  await wait(800);
  await dismiss();
  await putOn("bow", "c");
  await putOn("bomb", "b");
  await tp(130, 64);
  await hold("ArrowRight", 60);
  await wait(200);
  const before = await inv();
  await ev(() => {
    window.__booms = 0;
    window.ZeldaMakerToolkit.toolkit.bus.on("zelda:bomb:exploded", () => window.__booms++);
  });
  await page.keyboard.down("c");
  await page.keyboard.down("b");
  await wait(80);
  await page.keyboard.up("c");
  await page.keyboard.up("b");
  await wait(250);
  await page.screenshot({ path: path.join(OUT, "bomb-arrow.png") });
  await wait(1200);
  const after = await inv();
  const booms = await ev(() => window.__booms);
  expect(dug.powderItem && dug.powder === 10 && dug.spot === "revealed", `dug ${JSON.stringify(dug)}`);
  expect(sprinkled.powder === 9, `powder ${sprinkled.powder}`);
  expect(booms === 1 && after.arrows === before.arrows - 1 && after.bombs === before.bombs - 1, `booms ${booms}, ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  return `Magic Powder dug up (10), sprinkled (9 left); a bomb arrow: 1 explosion, arrows ${before.arrows}→${after.arrows}, bombs ${before.bombs}→${after.bombs}`;
});
await check("hookshot from its chest: fired up at the hook post it pulls the player over the pits onto the switch ledge (no fall); a placed bomb is picked up with Z, thrown with Z and goes off where it lands", async () => {
  const putOn = async (item, key) => {
    await page.keyboard.press("i");
    await wait(400);
    const target = await ev((item) => window.ZeldaMakerToolkit.session.screens.gridItems().indexOf(item), item);
    for (let n = 0; n < 16; n++) {
      const cur = await ev(() => window.ZeldaMakerToolkit.session.screens.current?.cursor ?? -1);
      if (cur === target || cur < 0) break;
      await page.keyboard.press(cur < target ? "ArrowRight" : "ArrowLeft");
      await wait(120);
    }
    await page.keyboard.press(key);
    await wait(200);
    await page.keyboard.press("i");
    await wait(400);
  };
  const pos = () => ev(() => { const b = window.game.scene.getScenes(true).find((m) => m.map).player.body; return { x: b.center.x, y: b.center.y, hp: window.ZeldaMakerToolkit.toolkit.state.player.hp }; });
  await tp(216, 126);
  await hold("ArrowUp", 200);
  await page.keyboard.press("z");
  await wait(800);
  await dismiss();
  const owned = await ev(() => window.ZeldaMakerToolkit.toolkit.inventory.owns("hookshot"));
  await putOn("hookshot", "c");
  await ev(() => {
    window.__falls = 0;
    window.ZeldaMakerToolkit.toolkit.bus.on("zelda:player:takeDamage", (e) => e.type === "fall" && window.__falls++);
  });
  await tp(364, 106);
  await hold("ArrowUp", 50);
  await wait(300);
  const before = await pos();
  await page.keyboard.press("c");
  await wait(250);
  await page.screenshot({ path: path.join(OUT, "hookshot.png") });
  await wait(1200);
  const after = await pos();
  // A placed bomb: Z picks it up, Z throws it.
  await putOn("bomb", "b");
  await tp(130, 64);
  await hold("ArrowRight", 60);
  await wait(300);
  await ev(() => {
    window.__boomAt = null;
    window.ZeldaMakerToolkit.toolkit.bus.on("zelda:bomb:exploded", (e) => (window.__boomAt = e));
  });
  await page.keyboard.press("b");
  await wait(300);
  await page.keyboard.press("z");
  await wait(200);
  const carrying = await ev(() => window.ZeldaMakerToolkit.session.interactions.isCarrying());
  await page.screenshot({ path: path.join(OUT, "bomb-carried.png") });
  const from = await pos();
  await page.keyboard.press("z");
  await wait(3200);
  const boom = await ev(() => window.__boomAt);
  expect(owned, "the hookshot chest");
  const falls = await ev(() => window.__falls);
  // (A shot of the fiery slime below may hit meanwhile: only a fall counts here.)
  expect(after.y < 80 && before.y > 95 && falls === 0, `pulled ${JSON.stringify(before)} → ${JSON.stringify(after)}, falls ${falls}`);
  expect(carrying, "the bomb was not picked up");
  expect(boom && boom.x > from.x + 40, `blast ${JSON.stringify(boom)} from ${from.x}`);
  return `pulled from y ${Math.round(before.y)} to ${Math.round(after.y)} over the pits; bomb thrown, blast ${Math.round(boom.x - from.x)} px ahead`;
});
await check("I opens the inventory screen (UI Designer, role Inventory): the items in a grid of the demo's item boxes, the cursor, the selected item's name; arrows move it; I closes", async () => {
  const look = () =>
    ev(() => {
      const hud = window.game.scene.getScene("ZeldaMakerToolkitHUD");
      const shown = hud.children.list.filter((o) => o.visible);
      const sc = window.ZeldaMakerToolkit.session.screens;
      return {
        screen: sc.current?.name ?? null,
        cursor: sc.current?.cursor ?? -1,
        items: sc.gridItems().length,
        panel: shown.filter((o) => o.texture?.key === "zelda-ui-panel").length,
        boxes: shown.filter((o) => o.texture?.key === "zelda-ui-item-box").length,
        cursors: shown.filter((o) => o.texture?.key === "zelda-ui-cursor").length,
        texts: shown.filter((o) => o.type === "Text").map((o) => o.text),
        name: sc.cursorItem() ? window.ZeldaMakerToolkit.toolkit.inventory.displayName(sc.cursorItem()) : "",
      };
    });
  await page.keyboard.press("i");
  await wait(500);
  const inv = await look();
  await page.screenshot({ path: path.join(OUT, "inventory.png") });
  await page.keyboard.press("ArrowRight");
  await wait(300);
  const moved = await look();
  await page.keyboard.press("i");
  await wait(400);
  const closed = await screenNow();
  expect(inv.screen === "inventory" && inv.panel === 9 && inv.boxes >= 12 && inv.cursors === 1 && inv.items >= 3, JSON.stringify(inv));
  expect(inv.texts.some((t) => /Предметы|Items/.test(t)) && inv.texts.includes(inv.name), `texts ${inv.texts.join(", ")} (name ${inv.name})`);
  expect(moved.cursor === inv.cursor + 1 || inv.cursor === inv.items - 1, `cursor ${inv.cursor} → ${moved.cursor}`);
  expect(closed.screen === null && !closed.paused, `closed ${JSON.stringify(closed)}`);
  return `${inv.items} items, "${inv.name}", cursor ${inv.cursor} → ${moved.cursor}`;
});
await check("Escape opens the pause menu (UI Designer, role Menu), not PS Maker's options menu; its Settings button opens PS Maker's options menu (game paused), where Save game keeps the Toolkit's progress; Escape closes the options, then the pause menu", async () => {
  const player = () => ev(() => { const b = window.game.scene.getScenes(true).find((m) => m.map).player.body; return `${Math.round(b.x)},${Math.round(b.y)}`; });
  const options = () => button("Save game").isVisible();
  await page.keyboard.press("Escape");
  await wait(400);
  const opened = await screenNow();
  const optionsOnEscape = await options();
  const at = await player();
  await page.keyboard.press("ArrowDown");
  await wait(300);
  const moved = await screenNow();
  const still = (await player()) === at;
  await page.screenshot({ path: path.join(OUT, "pause.png") });
  await page.keyboard.press("z");
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
  await wait(600);
  const back = await screenNow();
  const optionsAfter = await options();
  await page.keyboard.press("Escape");
  await wait(400);
  const closed = await screenNow();
  const optionsAtEnd = await options();
  expect(opened.screen === "pause" && opened.paused && opened.focus === "continue" && !optionsOnEscape, `opened ${JSON.stringify(opened)}, PS Maker options ${optionsOnEscape}`);
  expect(moved.focus === "settings", `down → ${moved.focus}`);
  expect(still, "the player walked while the pause menu was open");
  expect(t1 === t0, `toolkit ran while the options menu was open (${t0} → ${t1})`);
  expect(typeof volume === "number", "game.audioSettings.scaleSoundVolume is missing");
  expect(progress.state?.objects?.["zelda-demo-field/chest@140,200"] === "opened", `progress variable: ${JSON.stringify(progress.state?.objects)}`);
  expect(back.screen === "pause" && !optionsAfter, `after the options menu: ${JSON.stringify(back)}, options ${optionsAfter}`);
  expect(closed.screen === null && !closed.paused && !optionsAtEnd, `closed ${JSON.stringify(closed)}, options ${optionsAtEnd}`);
  return "Escape → pause → Settings → PS Maker options (saved) → Escape → pause → Escape → game";
});
await check("gamepad (browser Gamepad API, an Xbox pad stood in for): the stick walks the player through PS Maker's own movement, A swings the sword, View opens the pause menu; the Controls screen rebinds the sword key, Reset brings X back", async () => {
  const body = () => ev(() => { const b = window.game.scene.getScenes(true).find((m) => m.map).player.body; return { x: b.center.x, y: b.center.y }; });
  await tp(130, 64);
  await wait(300);
  await ev(() => {
    const mk = (n) => Array.from({ length: n }, () => ({ pressed: false, value: 0 }));
    window.__pad = { id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", connected: true, buttons: mk(17), axes: [0, 0, 0, 0] };
    navigator.getGamepads = () => [window.__pad];
  });
  const a0 = await body();
  await ev(() => (window.__pad.axes = [1, 0, 0, 0]));
  await wait(500);
  await ev(() => (window.__pad.axes = [0, 0, 0, 0]));
  await wait(200);
  const a1 = await body();
  const setButton = (i, on) => ev(([i, on]) => (window.__pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }), [i, on]);
  await setButton(0, true);
  let swung = false;
  for (let i = 0; i < 12 && !swung; i++) {
    await wait(30);
    swung = await ev(() => window.ZeldaMakerToolkit.session.sword.isAttacking());
  }
  await setButton(0, false);
  await wait(400);
  await setButton(8, true);
  await wait(150);
  await setButton(8, false);
  await wait(300);
  const paused = await screenNow();
  const options = await button("Save game").isVisible();
  await ev(() => (navigator.getGamepads = () => []));
  await wait(100);
  // Controls: the last button of the pause menu.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowDown");
    await wait(150);
  }
  await page.keyboard.press("z");
  await wait(400);
  const opened = await screenNow();
  await page.screenshot({ path: path.join(OUT, "controls.png") });
  await page.keyboard.press("z");
  await wait(300);
  await page.keyboard.press("j");
  await wait(400);
  const rebound = await ev(() => window.ZeldaMakerToolkit.toolkit.config.controls.sword[0]);
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("ArrowDown");
    await wait(120);
  }
  const focus = (await screenNow()).focus;
  await page.keyboard.press("z");
  await wait(300);
  const reset = await ev(() => window.ZeldaMakerToolkit.toolkit.config.controls.sword[0]);
  await page.keyboard.press("Escape");
  await wait(300);
  await page.keyboard.press("Escape");
  await wait(400);
  const closed = await screenNow();
  expect(a1.x - a0.x > 20, `the stick moved the player ${a1.x - a0.x}`);
  expect(swung, "A did not swing the sword");
  expect(paused.screen === "pause" && !options, `View: ${JSON.stringify(paused)}, PS Maker options ${options}`);
  expect(opened.screen === "controls", `controls ${JSON.stringify(opened)}`);
  expect(rebound === "KeyJ" && focus === "reset" && reset === "KeyX", `rebound ${rebound}, focus ${focus}, reset ${reset}`);
  expect(closed.screen === null, `closed ${JSON.stringify(closed)}`);
  return `stick → ${Math.round(a1.x - a0.x)} px, A → sword, View → pause; Controls: sword X → J → Reset → X`;
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
await check("the dungeon has no UI Layout of its own: it shows the project's shared HUD (made on the field) and its pause menu opens with Escape", async () => {
  const keys = await ev(() => [...new Set(window.game.scene.getScene("ZeldaMakerToolkitHUD").children.list.filter((o) => o.visible && o.texture?.key?.startsWith("zelda-ui-")).map((o) => o.texture.key))].sort());
  const own = await ev(() => window.game.scene.getScenes(true).find((m) => m.map).map.initialActions.some((a) => a.actionName === "Zelda: UI Layout"));
  await page.keyboard.press("Escape");
  await wait(400);
  const screen = await ev(() => window.ZeldaMakerToolkit.session.screens.current?.name ?? null);
  await page.keyboard.press("Escape");
  await wait(400);
  const closed = await ev(() => window.ZeldaMakerToolkit.session.screens.current);
  expect(!own, "the dungeon has its own UI Layout");
  for (const k of ["zelda-ui-hud-bar", "zelda-ui-heart-full", "zelda-ui-digits", "zelda-ui-item-box"]) expect(keys.includes(k), `${k} not drawn in the dungeon (${keys.join(", ")})`);
  expect(screen === "pause" && closed === null, `pause ${screen}, then ${JSON.stringify(closed)}`);
  return `shared HUD in the demo's pictures, pause opened and closed`;
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
  await dismiss();
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
await check("pause menu → Main menu: the title map wakes up with its title screen again (HUD hidden); New game goes back to the field", async () => {
  await page.keyboard.press("Escape");
  await wait(400);
  await page.keyboard.press("ArrowDown");
  await wait(200);
  await page.keyboard.press("ArrowDown");
  await wait(200);
  const focus = (await screenNow()).focus;
  await page.keyboard.press("z");
  await page.waitForFunction(() => window.ZeldaMakerToolkit?.session?.mapId === "zelda-demo-title", null, { timeout: 15000 });
  await wait(1500);
  const title = await ev(() => {
    const shown = window.game.scene.getScene("ZeldaMakerToolkitHUD").children.list.filter((o) => o.visible);
    return { screen: window.ZeldaMakerToolkit.session.screens.current?.name ?? null, hearts: shown.filter((o) => o.texture?.key === "zelda-ui-heart-full").length, hudBar: shown.filter((o) => o.texture?.key === "zelda-ui-hud-bar").length };
  });
  await page.screenshot({ path: path.join(OUT, "title-again.png") });
  await page.keyboard.press("z");
  await page.waitForFunction(() => window.ZeldaMakerToolkit?.session?.mapId === "zelda-demo-field", null, { timeout: 15000 });
  await wait(1500);
  const s = await state();
  expect(focus === "mainMenu", `selected ${focus}`);
  expect(title.screen === "title" && title.hearts === 0 && title.hudBar === 0, JSON.stringify(title));
  expect(s.map === "zelda-demo-field" && s.chest === "opened", JSON.stringify(s));
  return "title screen again, no HUD; back on the field with its progress";
});
await check("reload, Continue, load the save: the Toolkit starts on the restored map with its progress", async () => {
  await page.reload();
  await page.waitForFunction(() => window.ZeldaMakerToolkit?.session?.screens?.current?.name === "title", null, { timeout: 30000 });
  await wait(1200);
  // Continue: the second button of the title screen.
  await page.keyboard.press("ArrowDown");
  await wait(300);
  const focus = (await screenNow()).focus;
  expect(focus === "continue", `selected ${focus}`);
  await page.keyboard.press("z");
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
