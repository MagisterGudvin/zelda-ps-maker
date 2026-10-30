// Integration test: runs the BUILT plugin bundle inside real Phaser 3.90 in
// headless Chromium, through the PS Maker host emulator (examples/harness).
// It verifies the Phaser adapter (keyboard, Arcade body sync, static-body
// collision, HUD scene, scene shutdown) that unit tests can only fake.
//
// Usage: npm run build && node tests/integration/run-phaser-smoke.mjs
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startServer } from "../../examples/harness/serve.mjs";

const ARTIFACTS = fileURLToPath(new URL("./.artifacts/", import.meta.url));
await mkdir(ARTIFACTS, { recursive: true });

const server = await startServer(0);
const url = `http://127.0.0.1:${server.address().port}/examples/harness/`;
const browser = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });

const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? "" });
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, detail: String(err?.message ?? err) });
    console.log(`  ✘ ${name} — ${err?.message ?? err}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);

async function teleport(x, y) {
  await ev(([x, y]) => {
    const p = window.__harness.player();
    p.setPosition(x, y);
    p.body.reset(x, y);
  }, [x, y]);
  await sleep(50);
}
async function tapKey(key, ms = 60) {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
}
async function waitForMap(id) {
  await page.waitForFunction((id) => window.ZeldaMakerToolkit?.session?.mapId === id && window.__harness.scene()?.player, id, { timeout: 10000 });
  await sleep(200);
}
const listenerCounts = () =>
  ev(() => {
    const s = window.__harness.scene();
    return { postupdate: s.events.listenerCount("postupdate"), keydown: s.input.keyboard.listenerCount("keydown"), pointerdown: s.input.listenerCount("pointerdown"), blur: window.__harness.game.events.listenerCount("blur") };
  });

console.log(`Harness: ${url}`);
await page.goto(url);
await waitForMap("field");
await page.click("#game canvas");

await check("plugin loads, toolkit starts on the field map, HUD scene is active", async () => {
  const info = await ev(() => {
    const api = window.ZeldaMakerToolkit;
    const hud = window.__harness.game.scene.getScene("ZeldaMakerToolkitHUD");
    return { map: api.session.mapId, enemies: api.session.world.count("enemy"), hud: !!hud && hud.sys.isActive() && hud.sys.isVisible(), version: api.version };
  });
  assert(info.map === "field", `map ${info.map}`);
  assert(info.enemies === 6, `expected 6 enemies, got ${info.enemies}`);
  assert(info.hud, "HUD scene active and visible");
  return `v${info.version}, ${info.enemies} enemies`;
});

await check("NPC placed in the editor is adopted as an enemy visual", async () => {
  const r = await ev(() => {
    const s = window.__harness.scene();
    const npc = s.children.list.find((o) => o.name === "npc_guard");
    const enemy = window.ZeldaMakerToolkit.session.world.get("npc_enemy@120,184");
    return { found: !!npc, bodyDisabled: npc?.body?.enable === false, same: npc && enemy && Math.abs(npc.x - enemy.x) < 0.01 };
  });
  assert(r.found && r.bodyDisabled && r.same, JSON.stringify(r));
});

// Clear the field so roaming enemies don't interfere with measurements.
await ev(() => {
  for (const e of window.ZeldaMakerToolkit.session.world.list("enemy")) e.die();
});
await sleep(600);

await check("real keyboard: one sword swing deals damage exactly once", async () => {
  await teleport(150, 180);
  await tapKey("ArrowRight", 80);
  await ev(() => window.ZeldaMakerToolkit.spawnEnemy("slime", window.__harness.player().body.center.x + 20, window.__harness.player().body.center.y, { id: "dummy", overrides: { hp: 20, speed: 0, chaseSpeed: 0, detectRange: 0, contactDamage: false, knockbackResist: 1 } }));
  await tapKey("x", 60);
  await sleep(700);
  const hp = await ev(() => window.ZeldaMakerToolkit.session.world.get("dummy").hp);
  assert(hp === 18, `hp ${hp}, expected 18`);
  return "hp 20 → 18";
});

await check("player movement is locked during the swing, free afterwards (Arcade body sync)", async () => {
  await ev(() => window.ZeldaMakerToolkit.session.world.get("dummy")?.die());
  await teleport(150, 180);
  await page.keyboard.down("ArrowRight");
  await sleep(150);
  await page.keyboard.down("x");
  await sleep(30);
  const x0 = await ev(() => window.__harness.player().x);
  await sleep(150);
  const x1 = await ev(() => window.__harness.player().x);
  await page.keyboard.up("x");
  await sleep(450);
  const x2 = await ev(() => window.__harness.player().x);
  await page.keyboard.up("ArrowRight");
  assert(Math.abs(x1 - x0) < 1, `moved ${x1 - x0}px during the swing`);
  assert(x2 - x1 > 10, `did not resume moving (${x2 - x1}px)`);
  return `Δ during swing ${(x1 - x0).toFixed(2)}px, after ${(x2 - x1).toFixed(1)}px`;
});

await check("contact damage knocks the real Arcade player back once", async () => {
  await teleport(200, 150);
  await sleep(1100);
  const before = await ev(() => ({ x: window.__harness.player().x, hp: window.ZeldaMakerToolkit.getState().player.hp }));
  await ev(() => window.ZeldaMakerToolkit.spawnEnemy("slime", window.__harness.player().body.center.x + 9, window.__harness.player().body.center.y, { id: "bumper", overrides: { speed: 0, chaseSpeed: 0, detectRange: 0, damage: 1 } }));
  await sleep(400);
  const after = await ev(() => ({ x: window.__harness.player().x, hp: window.ZeldaMakerToolkit.getState().player.hp }));
  await ev(() => window.ZeldaMakerToolkit.session.world.get("bumper")?.die());
  assert(after.hp === before.hp - 1, `hp ${before.hp} → ${after.hp}`);
  assert(after.x < before.x - 5, `x ${before.x.toFixed(1)} → ${after.x.toFixed(1)}`);
  return `hp ${before.hp}→${after.hp}, pushed ${(before.x - after.x).toFixed(1)}px left`;
});

await check("toolkit solids block the player (walking up into a chest)", async () => {
  await sleep(1000);
  await teleport(200, 70);
  await page.keyboard.down("ArrowUp");
  await sleep(600);
  await page.keyboard.up("ArrowUp");
  const r = await ev(() => {
    const b = window.__harness.player().body;
    const chest = window.ZeldaMakerToolkit.session.world.get("chest@200,40");
    return { top: b.y, chestBottom: chest.y + chest.hh };
  });
  assert(r.top >= r.chestBottom - 1, JSON.stringify(r));
  return `player top ${r.top.toFixed(1)} ≥ chest bottom ${r.chestBottom}`;
});

await check("Z opens the chest in front (boomerang obtained)", async () => {
  await tapKey("z");
  await sleep(200);
  const has = await ev(() => window.ZeldaMakerToolkit.has("boomerang"));
  assert(has, "boomerang not in inventory");
});

await check("bomb spends one bomb and opens the cracked wall; the passage is walkable", async () => {
  await ev(() => window.ZeldaMakerToolkit.give("bombs", 3, true));
  await teleport(56, 120);
  await tapKey("ArrowUp", 40);
  await ev(() => window.ZeldaMakerToolkit.toolkit.inventory.equip("bomb"));
  await tapKey("c");
  await sleep(200);
  const bombs = await ev(() => window.ZeldaMakerToolkit.toolkit.inventory.count("bombs"));
  await teleport(56, 140);
  await sleep(2800);
  const wall = await ev(() => window.ZeldaMakerToolkit.session.world.get("bombable_wall@56,88").objState);
  await teleport(56, 110);
  await page.keyboard.down("ArrowUp");
  await sleep(500);
  await page.keyboard.up("ArrowUp");
  const y = await ev(() => window.__harness.player().body.center.y);
  assert(bombs === 2, `bombs ${bombs}`);
  assert(wall === "destroyed", `wall ${wall}`);
  assert(y < 85, `player y ${y.toFixed(1)} (still below the wall)`);
  return `bombs 3→2, wall destroyed, player reached y=${y.toFixed(0)}`;
});

await check("boomerang over the pits hits the switch; the rule opens the gate", async () => {
  await teleport(340, 112);
  await tapKey("ArrowUp", 30);
  await ev(() => window.ZeldaMakerToolkit.toolkit.inventory.equip("boomerang"));
  await tapKey("c");
  await sleep(1600);
  const r = await ev(() => ({ sw: window.ZeldaMakerToolkit.session.world.get("button@340,40").objState, gate: window.ZeldaMakerToolkit.session.world.get("door@392,112").objState }));
  assert(r.sw === "on" && r.gate === "opened", JSON.stringify(r));
});

await page.keyboard.press("F9");
await sleep(200);
await check("debug overlay: clicking the map shows and copies its coordinates", async () => {
  const box = await page.locator("#game canvas").boundingBox();
  // Game is 400x240 at zoom 2: map point (150, 100) is canvas pixel (300, 200).
  await page.mouse.click(box.x + 300, box.y + 200);
  await sleep(100);
  const label = await ev(() => window.__harness.scene().children.list.find((o) => o.type === "Text" && /^X: \d+ Y: \d+/.test(o.text ?? ""))?.text ?? "");
  assert(/^X: 150 Y: 100/.test(label), `label "${label}"`);
  return label;
});
await page.screenshot({ path: `${ARTIFACTS}field.png` });
await page.keyboard.press("F9");

await check("map transfer (the map sleeps and wakes up, as in PS Maker) does not leak listeners", async () => {
  // Phaser registers some listeners of its own when the HUD scene is first
  // created, so compare repeated visits: counts must not grow per transfer.
  await teleport(392, 112);
  await waitForMap("dungeon");
  const d1 = await listenerCounts();
  await teleport(4, 200);
  await waitForMap("field");
  const f2 = await listenerCounts();
  await teleport(392, 112);
  await waitForMap("dungeon");
  const d2 = await listenerCounts();
  await teleport(4, 200);
  await waitForMap("field");
  const f3 = await listenerCounts();
  await teleport(392, 112);
  await waitForMap("dungeon");
  assert(JSON.stringify(d1) === JSON.stringify(d2), `dungeon listeners grew: ${JSON.stringify(d1)} → ${JSON.stringify(d2)}`);
  assert(JSON.stringify(f2) === JSON.stringify(f3), `field listeners grew: ${JSON.stringify(f2)} → ${JSON.stringify(f3)}`);
  // Arcade Physics' own POST_UPDATE listener + exactly one toolkit frame listener.
  assert(d2.postupdate === 2, `postupdate listeners ${d2.postupdate}`);
  assert(d2.keydown === 1, `keydown listeners ${d2.keydown}`);
  assert(d2.pointerdown === 1, `pointerdown listeners ${d2.pointerdown}`);
  return JSON.stringify(d2);
});

await check("dungeon: push the block onto the plate, the shutter opens", async () => {
  await teleport(66, 168);
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(() => window.ZeldaMakerToolkit.session.world.get("pressure_plate@104,168").objState === "on", null, { timeout: 4000 });
  await page.keyboard.up("ArrowRight");
  await sleep(200);
  const door = await ev(() => window.ZeldaMakerToolkit.session.world.get("door@96,112").objState);
  assert(door === "opened", `door ${door}`);
});

await check("dungeon: key from the chest opens the locked door", async () => {
  await teleport(60, 74);
  // Walk up into the chest (it is solid) so the player faces it and stands within reach;
  // a short tap could fall between two simulation ticks under load.
  await tapKey("ArrowUp", 250);
  await tapKey("z");
  // Poll instead of a fixed delay: under load the chest can open a few frames later.
  await page.waitForFunction(() => window.ZeldaMakerToolkit.toolkit.inventory.count("key") > 0, null, { timeout: 1500 }).catch(() => {});
  const keys = await ev(() => window.ZeldaMakerToolkit.toolkit.inventory.count("key"));
  await teleport(180, 152);
  await page.keyboard.down("ArrowRight");
  await sleep(500);
  await page.keyboard.up("ArrowRight");
  const r = await ev(() => ({ door: window.ZeldaMakerToolkit.session.world.get("door@200,152").objState, keys: window.ZeldaMakerToolkit.toolkit.inventory.count("key") }));
  assert(keys === 1, `keys after chest ${keys}`);
  assert(r.door === "unlocked" && r.keys === 0, JSON.stringify(r));
});

await check("arena trigger starts waves at points picked on the map (Add Wave Enemy)", async () => {
  await teleport(224, 152);
  await sleep(300);
  const pts = await ev(() => window.ZeldaMakerToolkit.session.world.list("enemy").filter((e) => e.alive).map((e) => [Math.round(e.x), Math.round(e.y), e.cfg.template]));
  assert(pts.length === 2, `enemies ${JSON.stringify(pts)}`);
  assert(pts.every(([, , t]) => t === "slime"), JSON.stringify(pts));
  return JSON.stringify(pts);
});

await page.screenshot({ path: `${ARTIFACTS}dungeon.png` });

await check("progress persists across maps (opened chests stay open)", async () => {
  await teleport(4, 200);
  await waitForMap("field");
  const r = await ev(() => ({ chest: window.ZeldaMakerToolkit.session.world.get("chest@200,40").objState, wall: window.ZeldaMakerToolkit.session.world.get("bombable_wall@56,88").objState, gate: window.ZeldaMakerToolkit.session.world.get("door@392,112").objState, enemies: window.ZeldaMakerToolkit.session.world.count("enemy"), started: window.__harness.scene().onLoadRuns }));
  assert(r.chest === "opened" && r.wall === "destroyed" && r.gate === "opened", JSON.stringify(r));
  // "Map start" ran once; the Toolkit re-created the field's enemies and objects when it woke up.
  assert(r.started === 1 && r.enemies > 0, JSON.stringify(r));
  return JSON.stringify(r);
});

await check("PS Maker animations: picked player attack overlays the swing, picked walk animates an enemy", async () => {
  const r = await ev(async () => {
    const H = window.__harness;
    const scene = H.scene();
    // Two PS Maker sheets (4x4 frames of 16x16, rows = down, left, right, up) loaded the way
    // PS Maker 1.2.1 does: texture "<animationId>frames", project data in scene.sys.settings.data.story.
    const sheetCanvas = (hueBase) => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const g = c.getContext("2d");
      for (let i = 0; i < 16; i++) {
        g.fillStyle = `hsl(${hueBase + i * 20},80%,50%)`;
        g.fillRect((i % 4) * 16, Math.floor(i / 4) * 16, 16, 16);
      }
      return c;
    };
    scene.textures.addCanvas("ATK0frames", sheetCanvas(0));
    scene.textures.addCanvas("WLK0frames", sheetCanvas(180));
    const rows = (id) => [0, 1, 2, 3].map((row) => ({ id: id + row, startCol: 0, startRow: row, endCol: 3, endRow: row }));
    scene.sys.settings.data = {
      ...(scene.sys.settings.data ?? {}),
      story: {
        characters: [{ id: "MOB", name: "Mob", animationSets: [{ id: "m", animations: { down: "WLK0", left: "WLK1", right: "WLK2", up: "WLK3" } }] }],
        spritesheetAnimations: [
          { id: "ATK", name: "Sword Attack", src: "atk.png", frameWidth: 16, frameHeight: 16, frameRate: 8, ownerRef: { type: "player" }, animations: rows("ATK") },
          { id: "WLK", name: "Mob Walk", src: "wlk.png", frameWidth: 16, frameHeight: 16, frameRate: 6, ownerRef: { type: "npc", id: "MOB" }, animations: rows("WLK") },
        ],
        player: { animationSets: [{ id: "p", animations: { down: "ATK0", left: "ATK1", right: "ATK2", up: "ATK3" } }] },
      },
    };
    H.run("Zelda: Set Player Sprites", { attack: "ATK1", hidePlayer: true });
    H.run("Zelda: Define Enemy", { slot: "custom_enemy_6", basedOn: "slime", detectRange: 1 });
    H.run("Zelda: Create Enemy", { template: "custom_enemy_6", position: { x: 60, y: 200 }, walkAnimation: "WLK0" });
    await new Promise((ok) => setTimeout(ok, 400));
    const p = H.player();
    const before = p.alpha;
    scene.input.keyboard.emit("keydown", { code: "KeyX" });
    scene.input.keyboard.emit("keyup", { code: "KeyX" });
    await new Promise((ok) => setTimeout(ok, 120));
    const during = p.alpha;
    const overlay = scene.children.list.filter((o) => o.type === "Image" && o.visible && o.texture?.key === "ATK0frames" && String(o.frame?.name).startsWith("zmt_16x16_"));
    await new Promise((ok) => setTimeout(ok, 600));
    const after = p.alpha;
    const enemyImg = scene.children.list.find((o) => o.type === "Image" && o.texture?.key === "WLK0frames");
    return { before, during, after, overlay: overlay.length, overlayFrame: overlay[0]?.frame?.name, enemyFrame: enemyImg?.frame?.name ?? null };
  });
  assert(r.during === 0 && r.after === r.before, `player alpha ${r.before} → ${r.during} → ${r.after}`);
  assert(r.overlay >= 1, "attack overlay image not shown");
  assert(/^zmt_16x16_\d+$/.test(r.enemyFrame ?? ""), `enemy frame ${r.enemyFrame}`);
  return `overlay ${r.overlayFrame}, enemy ${r.enemyFrame}`;
});

await check("PS Maker project data: a character's sheets and collision box shape a Create Enemy", async () => {
  const r = await ev(async () => {
    const H = window.__harness;
    const scene = H.scene();
    // Story data in the PS Maker 1.2.1 format, kept in the Phaser JSON cache (one plausible place;
    // the real location is unconfirmed). The sheet texture is loaded under its file name.
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const g = c.getContext("2d");
    for (let i = 0; i < 16; i++) {
      g.fillStyle = `hsl(${i * 22},70%,50%)`;
      g.fillRect((i % 4) * 32, Math.floor(i / 4) * 32, 32, 32);
    }
    const src = "animation-t-RUN1-asset-z-Blob_Run.png";
    // PS Maker 1.2.1 loads each animation row as a whole-sheet texture "<animationId>frames".
    scene.textures.addCanvas("RUN10frames", c);
    const rowsOf = (id) => [0, 1, 2, 3].map((row) => ({ id: id + row, startCol: 0, startRow: row, endCol: 3, endRow: row }));
    // Added to the project data where PS Maker 1.2.1 keeps it (the previous check created it).
    const story = scene.sys.settings.data.story;
    story.characters.push({ id: "BLOB", name: "Blob", animationSets: [{ id: "s", animations: { down: "RUN10", left: "RUN11", right: "RUN12", up: "RUN13" }, collision: { enabled: true, box: { x: 10, y: 14, width: 12, height: 12 } } }] });
    story.spritesheetAnimations.push({ id: "RUN1", name: "Blob Run", src, frameWidth: 32, frameHeight: 32, frameRate: 8, ownerRef: { type: "npc", id: "BLOB" }, animations: rowsOf("RUN1") });
    const t0 = performance.now();
    H.run("Zelda: Create Enemy", { template: "slime", position: { x: 80, y: 60 }, id: "ps_blob", character: "BLOB" });
    const searchMs = performance.now() - t0;
    await new Promise((ok) => setTimeout(ok, 300));
    const img = scene.children.list.find((o) => o.type === "Image" && o.texture?.key === "RUN10frames");
    const e = window.ZeldaMakerToolkit.session.world.get("ps_blob");
    const diag = window.ZeldaMakerToolkit.session.host.describe().find((l) => l.startsWith("PS Maker data"));
    return { frame: img?.frame?.name ?? null, w: e?.cfg.width, diag, searchMs: Math.round(searchMs) };
  });
  assert(r.frame && r.frame.startsWith("zmt_32x32_"), `enemy frame ${r.frame}`);
  assert(r.w === 12, `hitbox width ${r.w}`);
  assert(/PS Maker data: scene\.story \(/.test(r.diag), r.diag);
  return `${r.frame}, ${r.diag}, search ${r.searchMs} ms`;
});

await check("PS Maker NPC bodies block enemies; sounds load from a URL and play", async () => {
  const r = await ev(async () => {
    const H = window.__harness;
    const scene = H.scene();
    const p = H.player().body.center;
    // A moving-body NPC (PS Maker 1.1 NPCs collide) standing between an enemy and the player.
    const npc = scene.physics.add.sprite(p.x + 40, p.y, "__WHITE").setDisplaySize(16, 16);
    npc.body.setSize(16, 16).setImmovable(true);
    window.ZeldaMakerToolkit.spawnEnemy("soldier", p.x + 80, p.y, { id: "npc_test", overrides: { lineOfSight: false, attackRange: 0 } });
    // A tiny generated WAV as a data URL.
    const rate = 8000;
    const n = 800;
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128 + Math.round(60 * Math.sin(i / 3)));
    let bin = "";
    new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
    H.run("Zelda: Set Sound", { moment: "enemyDefeated", sound: "", soundKey: `data:audio/wav;base64,${btoa(bin)}`, volume: 1 });
    await new Promise((ok) => setTimeout(ok, 2500));
    const e = window.ZeldaMakerToolkit.session.world.get("npc_test");
    const overlap = Math.abs(e.x - (npc.body.x + 8)) < e.hw + 8 && Math.abs(e.y - (npc.body.y + 8)) < e.hh + 8;
    const ex = e.x;
    const playedKeys = [];
    const origPlay = scene.sound.play.bind(scene.sound);
    scene.sound.play = (key, cfg) => {
      playedKeys.push(key);
      return origPlay(key, cfg);
    };
    e.die();
    await new Promise((ok) => setTimeout(ok, 800));
    const played = playedKeys.some((k) => String(k).startsWith("zmt_snd_")) && scene.cache.audio.exists(playedKeys[0]);
    scene.sound.play = origPlay;
    npc.destroy();
    return { overlap, ex, npcX: npc.x, played, audioCtx: !!scene.sound.context };
  });
  assert(!r.overlap, `enemy walked into the NPC (x=${r.ex})`);
  assert(r.played || !r.audioCtx, "sound was not played");
  return `enemy stopped at x=${Math.round(r.ex)} (NPC at ${Math.round(r.npcX)}), sound played: ${r.played}`;
});

await check("UI Layout: own pictures (PS Maker images) for hearts, counter icon and digit strip, item frame, magic meter and a 9-slice panel", async () => {
  const r = await ev(async () => {
    const H = window.__harness;
    const scene = H.scene();
    // Pictures as PS Maker loads the project's Images: textures under the image id.
    const pic = (key, w, h, paint) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      paint(c.getContext("2d"), w, h);
      scene.textures.addCanvas(key, c);
    };
    const fill = (color) => (g, w, h) => ((g.fillStyle = color), g.fillRect(0, 0, w, h));
    pic("IMG_HEART", 16, 14, fill("#e03040"));
    pic("IMG_HEART_E", 16, 14, fill("#402020"));
    pic("IMG_RUPEE", 12, 12, fill("#30c060"));
    pic("IMG_DIGITS", 80, 12, (g) => {
      for (let d = 0; d < 10; d++) ((g.fillStyle = `hsl(${d * 36},80%,60%)`), g.fillRect(d * 8, 0, 7, 12));
    });
    pic("IMG_BOX", 32, 32, fill("#806040"));
    pic("IMG_MFRAME", 12, 40, fill("#202020"));
    pic("IMG_MFILL", 12, 40, fill("#40e080"));
    pic("IMG_BAR", 32, 32, (g) => ((g.fillStyle = "#c0a070"), g.fillRect(0, 0, 32, 32), (g.fillStyle = "#302010"), g.fillRect(4, 4, 24, 24)));
    const layout = {
      v: 1,
      scale: 2,
      elements: [
        { id: "panel", type: "image", x: 2, y: 2, w: 120, h: 44, image: "IMG_BAR", mode: "nine", slice: 4 },
        { id: "magic", type: "bar", x: 6, y: 4, w: 12, h: 40, value: "magic", max: "maxMagic", fill: "IMG_MFILL", back: "IMG_MFRAME", dir: "up" },
        { id: "item", type: "item", x: 24, y: 8, w: 32, h: 32, frame: "IMG_BOX" },
        { id: "rupees", type: "counter", x: 64, y: 8, value: "rupees", icon: "IMG_RUPEE", digits: "IMG_DIGITS", places: 3 },
        { id: "hearts", type: "hearts", anchor: "tr", x: -200, y: 6, w: 170, h: 30, full: "IMG_HEART", empty: "IMG_HEART_E", perRow: 10 },
      ],
    };
    H.run("Zelda: UI Layout", { layout: JSON.stringify(layout) });
    window.ZeldaMakerToolkit.toolkit.inventory.give("rupees", 7, { silent: true });
    await new Promise((ok) => setTimeout(ok, 300));
    const hud = H.game.scene.getScene("ZeldaMakerToolkitHUD");
    const shown = hud.children.list.filter((o) => o.visible);
    const by = (key) => shown.filter((o) => o.texture?.key === key);
    const heart = by("IMG_HEART")[0] ?? by("IMG_HEART_E")[0];
    const images = hud.children.list.filter((o) => o.type === "Image" && o.visible);
    return {
      hearts: by("IMG_HEART").length + by("IMG_HEART_E").length,
      maxHearts: Math.ceil(window.ZeldaMakerToolkit.toolkit.state.player.maxHp / window.ZeldaMakerToolkit.toolkit.config.player.heartValue),
      heartScale: heart?.scaleX,
      rupee: by("IMG_RUPEE").length,
      digits: by("IMG_DIGITS").map((o) => o.frame.name).join(","),
      rupees: window.ZeldaMakerToolkit.toolkit.inventory.count("rupees"),
      box: by("IMG_BOX").length,
      magic: by("IMG_MFRAME").length + by("IMG_MFILL").length,
      panel: by("IMG_BAR").length,
      // The panel is the first element: drawn first, under the others.
      panelFirst: images.slice(0, 9).every((o) => o.texture.key === "IMG_BAR"),
    };
  });
  await page.screenshot({ path: `${ARTIFACTS}ui-layout.png` });
  await ev(() => window.__harness.run("Zelda: UI Layout", {}));
  assert(r.hearts === r.maxHearts && r.heartScale === 2, `hearts ${r.hearts}/${r.maxHearts} at ×${r.heartScale}`);
  assert(r.rupee === 1 && r.box === 1 && r.magic === 2, JSON.stringify(r));
  // The rupee counter's digits (3 places) come from the digit strip.
  const want = String(r.rupees).padStart(3, "0").split("").map((d) => `zmt_digit_${d}`);
  assert(want.every((f) => r.digits.split(",").includes(f)), `digits ${r.digits} for ${r.rupees} rupees`);
  assert(r.panel === 9 && r.panelFirst, `panel ${r.panel} pieces, under the others: ${r.panelFirst}`);
  return `${r.hearts} hearts, digits ${r.digits}, panel in ${r.panel} pieces`;
});

await check("UI Layout positions: anchor + offset × scale; an element shown only while the player has an item", async () => {
  const r = await ev(async () => {
    const H = window.__harness;
    const tk = window.ZeldaMakerToolkit.toolkit;
    // IMG_BAR: the picture of the check above.
    const layout = {
      v: 1,
      scale: 2,
      elements: [
        { id: "hearts", type: "hearts", x: 40, y: 60, w: 80, h: 16 },
        { id: "corner", type: "image", anchor: "br", x: -20, y: -10, w: 10, h: 5, image: "IMG_BAR" },
        { id: "bowOnly", type: "text", x: 4, y: 100, text: "BOW", show: { when: "item", id: "bow" } },
      ],
    };
    H.run("Zelda: UI Layout", { layout: JSON.stringify(layout) });
    tk.inventory.remove?.("bow");
    await new Promise((ok) => setTimeout(ok, 300));
    const hud = H.game.scene.getScene("ZeldaMakerToolkitHUD");
    const shown = () => hud.children.list.filter((o) => o.visible);
    const hearts = shown().filter((o) => /heart8_/.test(o.texture?.key ?? ""));
    const corner = shown().find((o) => o.texture?.key === "IMG_BAR");
    const bowBefore = shown().some((o) => o.type === "Text" && o.text === "BOW");
    tk.inventory.give("bow", 1, { silent: true });
    await new Promise((ok) => setTimeout(ok, 300));
    const bowAfter = shown().some((o) => o.type === "Text" && o.text === "BOW");
    return { first: hearts[0] && [hearts[0].x, hearts[0].y], corner: corner && [corner.x, corner.y], W: H.game.scale.width, H: H.game.scale.height, bowBefore, bowAfter, hadBow: tk.inventory.has("bow") };
  });
  await page.screenshot({ path: `${ARTIFACTS}ui-layout-places.png` });
  await ev(() => window.__harness.run("Zelda: UI Layout", {}));
  assert(r.first && r.first[0] === 80 && r.first[1] === 120, `first heart at ${JSON.stringify(r.first)}`);
  // Bottom-right anchor: the screen corner in layout pixels (whole pixels), then the offset.
  const cx = (Math.floor(r.W / 2) - 20) * 2;
  const cy = (Math.floor(r.H / 2) - 10) * 2;
  assert(r.corner && r.corner[0] === cx && r.corner[1] === cy, `corner at ${JSON.stringify(r.corner)}, want ${cx},${cy}`);
  assert(!r.bowBefore && r.bowAfter, `bow text before ${r.bowBefore}, after ${r.bowAfter}`);
  return `first heart at ${r.first.join(",")}, corner at ${r.corner.join(",")}, item-bound text shown with the bow`;
});

await check("UI Layout theme: own icons for built-in items (item box, inventory), own inventory panel (9-slice) and cursor", async () => {
  const r = await ev(async () => {
    const H = window.__harness;
    const scene = H.scene();
    const pic = (key, w, h, color) => {
      if (scene.textures.exists(key)) return;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      scene.textures.addCanvas(key, c);
    };
    pic("IMG_ICON_BOOM", 16, 16, "#c08030");
    pic("IMG_INV_PANEL", 24, 24, "#304060");
    pic("IMG_INV_CURSOR", 20, 20, "#ffd23a");
    const tk = window.ZeldaMakerToolkit.toolkit;
    const theme = { icons: { boomerang: "IMG_ICON_BOOM" }, panel: "IMG_INV_PANEL", panelSlice: 6, cursor: "IMG_INV_CURSOR" };
    H.run("Zelda: UI Layout", { layout: JSON.stringify({ v: 1, theme, elements: [{ id: "item", type: "item", x: 6, y: 6, w: 22, h: 22 }] }) });
    tk.inventory.give("boomerang", 1, { silent: true });
    tk.state.inventory.activeItem = "boomerang";
    window.ZeldaMakerToolkit.session.inventoryUi.setOpen(true);
    await new Promise((ok) => setTimeout(ok, 300));
    const hud = H.game.scene.getScene("ZeldaMakerToolkitHUD");
    const shown = hud.children.list.filter((o) => o.visible);
    const by = (key) => shown.filter((o) => o.texture?.key === key);
    return { title: shown.filter((o) => o.type === "Text" && o.text === "Items").map((t) => t.alpha), icons: by("IMG_ICON_BOOM").length, panel: by("IMG_INV_PANEL").length, cursor: by("IMG_INV_CURSOR").length, builtin: shown.filter((o) => /icon_boomerang/.test(o.texture?.key ?? "")).length };
  });
  await page.screenshot({ path: `${ARTIFACTS}ui-layout-inventory.png` });
  await ev(() => {
    window.ZeldaMakerToolkit.session.inventoryUi.setOpen(false);
    window.__harness.run("Zelda: UI Layout", {});
  });
  // The boomerang in the item box and in the inventory; the panel as 9 pieces.
  assert(r.icons === 2 && r.builtin === 0, `icons ${JSON.stringify(r)}`);
  assert(r.panel === 9 && r.cursor === 1, `panel ${JSON.stringify(r)}`);
  // The panel's title is drawn over the picture (pooled texts once kept a faded message's alpha 0).
  assert(r.title.length === 1 && r.title[0] === 1, `title ${JSON.stringify(r.title)}`);
  return `own icon ×${r.icons}, panel in ${r.panel} pieces, cursor, title visible`;
});

await check("UI Layout 0.24 elements: a shape bar drawn over the panel before it, a turned picture, an icon from a sheet, a quick slot, a minimap, an outlined text", async () => {
  const r = await ev(async () => {
    const H = window.__harness;
    const scene = H.scene();
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 16;
    const g = c.getContext("2d");
    for (let i = 0; i < 4; i++) ((g.fillStyle = ["#f00", "#0f0", "#00f", "#ff0"][i]), g.fillRect(i * 16, 0, 16, 16));
    if (!scene.textures.exists("IMG_SHEET")) scene.textures.addCanvas("IMG_SHEET", c);
    const tk = window.ZeldaMakerToolkit.toolkit;
    tk.inventory.give("boomerang", 1, { silent: true });
    const layout = {
      v: 1,
      scale: 2,
      elements: [
        { id: "panel", type: "image", x: 4, y: 4, w: 120, h: 60, image: "IMG_BAR", mode: "nine", slice: 4 },
        { id: "hp", type: "bar", x: 10, y: 10, w: 60, h: 10, value: "health", max: "maxHealth", shape: "round", fillColor: "#e04050", border: "#000000", text: "HP" },
        { id: "turned", type: "image", x: 80, y: 10, w: 16, h: 16, image: "IMG_SHEET", rotation: 90 },
        { id: "icon", type: "icon", x: 10, y: 30, w: 16, h: 16, image: "IMG_SHEET", cellW: 16, cellH: 16, index: 2 },
        { id: "slot", type: "slot", x: 30, y: 30, w: 20, h: 20, index: 1 },
        { id: "map", type: "minimap", x: 60, y: 28, w: 32, h: 32 },
        { id: "label", type: "text", x: 100, y: 30, text: "Hi", stroke: "#000000", strokeWidth: 1 },
      ],
    };
    H.run("Zelda: UI Layout", { layout: JSON.stringify(layout) });
    await new Promise((ok) => setTimeout(ok, 300));
    const hud = H.game.scene.getScene("ZeldaMakerToolkitHUD");
    const shown = hud.children.list.filter((o) => o.visible);
    const panel = shown.filter((o) => o.texture?.key === "IMG_BAR");
    const shapes = shown.filter((o) => o.type === "Graphics" && o.depth > 0 && o.depth < 0.9);
    const turned = shown.find((o) => o.texture?.key === "IMG_SHEET" && Math.abs(o.rotation - Math.PI / 2) < 1e-6);
    const icon = shown.find((o) => o.texture?.key === "IMG_SHEET" && o.frame?.name === "zmt_icon_16x16_2");
    const label = shown.find((o) => o.type === "Text" && o.text === "Hi");
    const hp = shown.find((o) => o.type === "Text" && o.text === "HP");
    return {
      panelDepth: Math.max(...panel.map((o) => o.depth)),
      shapeDepths: shapes.map((o) => o.depth).sort(),
      turned: !!turned,
      icon: !!icon,
      // Slot 1 shows the first quick-use item (whichever the earlier checks gave).
      slotIcon: shown.some((o) => /(^|_)icon_/.test(o.texture?.key ?? "") && !/^zmt_icon_\d/.test(o.frame?.name ?? "")),
      stroke: label?.style?.strokeThickness ?? 0,
      hp: !!hp,
    };
  });
  await page.screenshot({ path: `${ARTIFACTS}ui-layout-024.png` });
  await ev(() => window.__harness.run("Zelda: UI Layout", {}));
  assert(r.shapeDepths.length >= 2 && r.shapeDepths[0] > r.panelDepth, `the bar's graphics (${r.shapeDepths}) over the panel (${r.panelDepth})`);
  assert(r.turned && r.icon && r.slotIcon && r.hp, JSON.stringify(r));
  assert(r.stroke >= 2, `outline ${r.stroke}`);
  return `bar over the panel (depth ${r.shapeDepths[0].toFixed(3)} > ${r.panelDepth.toFixed(3)}), turned picture, icon #2 of the sheet, slot with an item icon, minimap, outline ${r.stroke}px`;
});

await check("UI screens: Escape opens the pause menu (role Menu) and PS Maker's options menu does not (game paused, player still), arrows and Z press a button that runs a PS Maker event, a click closes it", async () => {
  await ev(() => {
    const H = window.__harness;
    window.__dialogues = [];
    // PS Maker's options menu listens like this (SystemMenusOverlay: window keydown, skips prevented events).
    window.__psOptions = 0;
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && !e.defaultPrevented && !e.repeat) window.__psOptions++;
    });
    const button = (id, y, action) => ({ id, type: "button", anchor: "c", x: -40, y, w: 80, h: 16, text: id, action });
    const layout = { v: 1, screen: { role: "menu", dim: "#00000099" }, elements: [button("Continue", -30, { kind: "close" }), button("Hint", -8, { kind: "event", id: "ev-hint" })] };
    H.run("Zelda: UI Layout", { name: "pause", layout: JSON.stringify(layout) });
  });
  const at = () => ev(() => window.__harness.player().body.center.x + "," + window.__harness.player().body.center.y);
  const before = await at();
  await tapKey("Escape");
  await new Promise((ok) => setTimeout(ok, 200));
  const opened = await ev(() => ({ name: window.ZeldaMakerToolkit.session.screens.current?.name, paused: window.ZeldaMakerToolkit.session.isPaused("screen"), psOptions: window.__psOptions }));
  await page.keyboard.down("ArrowDown");
  await new Promise((ok) => setTimeout(ok, 250));
  await page.keyboard.up("ArrowDown");
  const focus = await ev(() => window.ZeldaMakerToolkit.session.screens.current?.focus);
  const still = (await at()) === before;
  await page.screenshot({ path: `${ARTIFACTS}ui-screen.png` });
  await tapKey("z");
  await new Promise((ok) => setTimeout(ok, 200));
  const ran = await ev(() => (window.__dialogues ?? []).map((d) => d.actions.map((a) => `${a.type}:${a.storyEventId ?? ""}`).join("+")));
  await ev(() => window.__dialogues.forEach((d) => d.close()));
  // A click on Continue (its text, drawn by the HUD scene, in page pixels).
  const xy = await ev(() => {
    const hud = window.__harness.game.scene.getScene("ZeldaMakerToolkitHUD");
    const t = hud.children.list.find((o) => o.type === "Text" && o.visible && o.text === "Continue");
    const c = window.__harness.game.canvas.getBoundingClientRect();
    const k = c.width / window.__harness.game.scale.width;
    return t && [c.x + (t.x + t.width / 2) * k, c.y + (t.y + t.height / 2) * k];
  });
  await page.mouse.click(xy[0], xy[1]);
  await new Promise((ok) => setTimeout(ok, 200));
  const closed = await ev(() => ({ screen: window.ZeldaMakerToolkit.session.screens.current, paused: window.ZeldaMakerToolkit.session.isPaused("screen") }));
  // Without a pause menu Escape is PS Maker's again.
  await ev(() => window.ZeldaMakerToolkit.toolkit.uiScreens.delete("pause"));
  await tapKey("Escape");
  await new Promise((ok) => setTimeout(ok, 100));
  const psOptions = await ev(() => window.__psOptions);
  assert(opened.name === "pause" && opened.paused && opened.psOptions === 0, `opened ${JSON.stringify(opened)}`);
  assert(psOptions === 1, `without a pause menu PS Maker's options got Escape ${psOptions} times`);
  assert(focus === "Hint", `focus ${focus}`);
  assert(still, "the player moved while the menu was open");
  assert(ran.includes("runStoryEventAction:ev-hint"), `ran ${JSON.stringify(ran)}`);
  assert(closed.screen === null && !closed.paused, `closed ${JSON.stringify(closed)}`);
  return `opened by Escape (PS Maker's options menu skipped it), Down → Hint, Z ran ${ran.join(", ")}, click on Continue closed it; without a pause menu Escape went to PS Maker`;
});

await check("message screen (role Message): a sign's text types out in the designer's box, Z shows it whole then closes it; the game waits", async () => {
  const hudText = (t) => ev((t) => {
    const hud = window.__harness.game.scene.getScene("ZeldaMakerToolkitHUD");
    return hud.children.list.filter((o) => o.type === "Text" && o.visible && o.text.length > 0 && t.startsWith(o.text)).map((o) => o.text);
  }, t);
  await ev(() => {
    const layout = { v: 1, screen: { role: "message", kinds: ["sign", "item"], typing: 20, dim: "" }, elements: [{ id: "panel", type: "image", anchor: "b", x: -100, y: -40, w: 200, h: 36, color: "#000000cc" }, { id: "text", type: "text", anchor: "b", x: -94, y: -36, w: 188, h: 28, text: "{message}", wrap: true }] };
    window.__harness.run("Zelda: UI Layout", { name: "message", layout: JSON.stringify(layout) });
    window.__dialogues = [];
    window.ZeldaMakerToolkit.toolkit.bus.emit("zelda:message", { text: "It's dangerous to go alone! Take this.", durationMs: 1000, kind: "sign" });
  });
  await sleep(300);
  const typing = await hudText("It's dangerous to go alone! Take this.");
  const paused = await ev(() => window.ZeldaMakerToolkit.session.isPaused("message"));
  await tapKey("z");
  await sleep(150);
  const whole = await hudText("It's dangerous to go alone! Take this.");
  await page.screenshot({ path: `${ARTIFACTS}message-screen.png` });
  await tapKey("z");
  await sleep(250);
  const after = await ev(() => ({ paused: window.ZeldaMakerToolkit.session.isPaused("message"), screen: window.ZeldaMakerToolkit.session.screens.current, dialogues: window.__dialogues.length }));
  await ev(() => window.ZeldaMakerToolkit.toolkit.uiScreens.delete("message"));
  assert(typing.length === 1 && typing[0].length < 38, `typing ${JSON.stringify(typing)}`);
  assert(paused, "the game waits");
  assert(whole.includes("It's dangerous to go alone! Take this."), `whole ${JSON.stringify(whole)}`);
  assert(!after.paused && after.screen === null && after.dialogues === 0, JSON.stringify(after));
  return `typed "${typing[0]}", Z: whole page, Z: closed; no PS Maker dialogue`;
});

await check("inventory screen (role Inventory): I opens it, arrows move the cursor over the items, Z takes one in hand, its name shows; I closes", async () => {
  await ev(() => {
    const tk = window.ZeldaMakerToolkit.toolkit;
    for (const id of ["boomerang", "bow"]) tk.inventory.give(id, 1, { silent: true });
    const layout = { v: 1, screen: { role: "inventory" }, elements: [{ id: "grid", type: "inventory", anchor: "c", x: -60, y: -30, w: 120, h: 44, cols: 5, cell: 20, gap: 4 }, { id: "name", type: "text", anchor: "c", x: -60, y: 20, w: 120, h: 10, text: "{inv.name}" }] };
    window.__harness.run("Zelda: UI Layout", { name: "items", layout: JSON.stringify(layout) });
  });
  await tapKey("i");
  await sleep(150);
  const opened = await ev(() => window.ZeldaMakerToolkit.session.screens.current?.name);
  const items = await ev(() => window.ZeldaMakerToolkit.session.screens.gridItems());
  const target = items.indexOf("bow");
  for (let n = 0; n < 12 && (await ev(() => window.ZeldaMakerToolkit.session.screens.current.cursor)) !== target; n++) {
    const cur = await ev(() => window.ZeldaMakerToolkit.session.screens.current.cursor);
    await tapKey(cur < target ? "ArrowRight" : "ArrowLeft");
    await sleep(80);
  }
  await tapKey("z");
  await sleep(150);
  await page.screenshot({ path: `${ARTIFACTS}inventory-screen.png` });
  const r = await ev(() => {
    const hud = window.__harness.game.scene.getScene("ZeldaMakerToolkitHUD");
    const tk = window.ZeldaMakerToolkit.toolkit;
    return { active: tk.state.inventory.activeItem, name: tk.inventory.displayName("bow"), texts: hud.children.list.filter((o) => o.type === "Text" && o.visible).map((o) => o.text), icons: hud.children.list.filter((o) => o.visible && /(^|_)icon_/.test(o.texture?.key ?? "")).length };
  });
  await tapKey("i");
  await sleep(150);
  const closed = await ev(() => ({ screen: window.ZeldaMakerToolkit.session.screens.current, paused: window.ZeldaMakerToolkit.session.isPaused() }));
  await ev(() => window.ZeldaMakerToolkit.toolkit.uiScreens.delete("items"));
  assert(opened === "items", `opened ${opened}`);
  assert(r.active === "bow" && r.texts.includes(r.name), JSON.stringify(r));
  assert(r.icons >= items.length, `icons ${r.icons} for ${items.length} items`);
  assert(closed.screen === null && !closed.paused, JSON.stringify(closed));
  return `${items.length} items, ${r.icons} icons; bow taken in hand, "${r.name}" shown; I closed it`;
});

await check("shield: none at the start of the demo; given, V held up shows the built-in shield in front of the player, released hides it", async () => {
  const shieldShown = () => ev(() => window.__harness.scene().children.list.some((o) => o.visible && o.texture?.key?.includes("icon_shield")));
  const start = await ev(() => window.ZeldaMakerToolkit.toolkit.config.player.startItems);
  await ev(() => window.ZeldaMakerToolkit.toolkit.inventory.give("shield", 1, { silent: true }));
  await page.keyboard.down("v");
  await sleep(200);
  const up = await shieldShown();
  await page.screenshot({ path: `${ARTIFACTS}shield-up.png` });
  await page.keyboard.up("v");
  await sleep(200);
  const down = await shieldShown();
  assert(!start.includes("shield"), `start items ${start}`);
  assert(up && !down, `held ${up}, released ${down}`);
  return "start items without the shield; shown while V is held";
});

await check("Roc's Feather: B jumps — the sprite is drawn above its body with a shadow, the body stays on the ground, and all is back after; Pegasus Boots on C: a dash", async () => {
  await ev(() => {
    const inv = window.ZeldaMakerToolkit.toolkit.inventory;
    inv.give("feather", 1, { silent: true });
    inv.give("boots", 1, { silent: true });
    inv.assign(2, "feather");
    inv.assign(1, "boots");
    window.__hop = [];
    const scene = window.__harness.scene();
    // Sample what is drawn: the sprite's y against its body at render time.
    window.__hopSampler = () => {
      const p = window.__harness.player();
      window.__hop.push(p.body.center.y - p.y);
    };
    scene.events.on("render", window.__hopSampler);
  });
  await tapKey("b");
  await sleep(220);
  const mid = await ev(() => ({ lift: Math.max(...window.__hop), airborne: window.ZeldaMakerToolkit.session.moves.isAirborne, shadow: window.__harness.scene().children.list.some((o) => o.type === "Graphics" && o.visible && o.commandBuffer?.length > 0 && o.depth < window.__harness.player().depth) }));
  await page.screenshot({ path: `${ARTIFACTS}feather-jump.png` });
  await sleep(500);
  const after = await ev(() => {
    window.__harness.scene().events.off("render", window.__hopSampler);
    const p = window.__harness.player();
    return { airborne: window.ZeldaMakerToolkit.session.moves.isAirborne, offset: p.body.center.y - p.y, base: window.__hop[0] };
  });
  // Pegasus Boots: in the open, facing right, hold C: run up, dash.
  await teleport(60, 160);
  await tapKey("ArrowRight", 80);
  await sleep(200);
  const x0 = await ev(() => window.__harness.player().body.center.x);
  await page.keyboard.down("c");
  await sleep(550);
  const dashing = await ev(() => window.ZeldaMakerToolkit.session.moves.isDashing);
  await page.keyboard.up("c");
  await sleep(150);
  const x1 = await ev(() => window.__harness.player().body.center.x);
  assert(mid.airborne && mid.lift - after.base > 6, `lift ${mid.lift} vs ${after.base}`);
  assert(mid.shadow, "no shadow under the jump");
  assert(!after.airborne && Math.abs(after.offset - after.base) < 0.5, JSON.stringify(after));
  assert(dashing && Math.abs(x1 - x0) > 20, `dash ${dashing}, moved ${x1 - x0}`);
  return `drawn ${(mid.lift - after.base).toFixed(1)} px up, shadow, back on the ground; dash ${Math.round(Math.abs(x1 - x0))} px`;
});

await check("no page errors or console errors", async () => {
  assert(pageErrors.length === 0, pageErrors.join("\n"));
  assert(consoleErrors.length === 0, consoleErrors.join("\n"));
});

await writeFile(`${ARTIFACTS}report.json`, JSON.stringify({ date: new Date().toISOString(), phaser: await ev(() => window.Phaser.VERSION), results }, null, 2));
await browser.close();
server.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} integration checks passed. Screenshots: ${ARTIFACTS}`);
process.exit(failed === 0 ? 0 : 1);
