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

await check("save (F5) and load (F8) restore progress from localStorage", async () => {
  await page.keyboard.press("F5");
  await sleep(100);
  const saved = await ev(() => !!localStorage.getItem("zelda-maker-toolkit:default"));
  const r0 = await ev(() => window.ZeldaMakerToolkit.toolkit.inventory.count("rupees"));
  await ev(() => window.ZeldaMakerToolkit.give("rupees", 77, true));
  await page.keyboard.press("F8");
  await sleep(100);
  const r1 = await ev(() => window.ZeldaMakerToolkit.toolkit.inventory.count("rupees"));
  assert(saved, "nothing in localStorage");
  assert(r1 === r0, `rupees ${r1}, expected ${r0}`);
  return `rupees restored to ${r0}`;
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
  assert(/scene\.data/.test(r.diag), r.diag);
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

await check("HUD Style: own pictures (PS Maker images) for hearts, icons, digits, item box, magic and a 9-slice bar", async () => {
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
    H.run("Zelda: HUD Style", { heartFull: "IMG_HEART", heartEmpty: "IMG_HEART_E", rupees: "IMG_RUPEE", digits: "IMG_DIGITS", itemBox: "IMG_BOX", magicFrame: "IMG_MFRAME", magicFill: "IMG_MFILL", bar: "IMG_BAR", barSlice: 4, scale: 2 });
    window.ZeldaMakerToolkit.toolkit.inventory.give("rupees", 7, { silent: true });
    await new Promise((ok) => setTimeout(ok, 300));
    const hud = H.game.scene.getScene("ZeldaMakerToolkitHUD");
    const shown = hud.children.list.filter((o) => o.visible);
    const by = (key) => shown.filter((o) => o.texture?.key === key);
    const heart = by("IMG_HEART")[0];
    const out = {
      hearts: by("IMG_HEART").length + by("IMG_HEART_E").length,
      maxHearts: Math.ceil(window.ZeldaMakerToolkit.toolkit.state.player.maxHp / window.ZeldaMakerToolkit.toolkit.config.player.heartValue),
      heartScale: heart?.scaleX,
      rupee: by("IMG_RUPEE").length,
      digits: by("IMG_DIGITS").map((o) => o.frame.name).join(","),
      box: by("IMG_BOX").length,
      magic: by("IMG_MFRAME").length + by("IMG_MFILL").length,
      bar: by("IMG_BAR").map((o) => `${o.type}:${o.depth}`).join(","),
    };
    return out;
  });
  await page.screenshot({ path: `${ARTIFACTS}hud-style.png` });
  await ev(() => window.__harness.run("Zelda: HUD Style", {}));
  assert(r.hearts === r.maxHearts && r.heartScale === 2, `hearts ${r.hearts}/${r.maxHearts} at ×${r.heartScale}`);
  assert(r.rupee === 1 && r.box === 1 && r.magic === 2, JSON.stringify(r));
  assert(r.digits.split(",").includes("zmt_digit_7"), `digits ${r.digits}`);
  assert(/^(NineSlice|Image):-[0-9.]+$/.test(r.bar), `bar ${r.bar} (must be behind the HUD)`);
  return `${r.hearts} hearts, digits ${r.digits}, bar ${r.bar}`;
});

await check("HUD Style positions: a placed part is drawn there in the game (HUD pixels × scale), each part on its own panel", async () => {
  const r = await ev(async () => {
    const H = window.__harness;
    // IMG_BAR: the picture of the check above.
    H.run("Zelda: HUD Style", { bar: "IMG_BAR", barSlice: 4, scale: 2, heartsX: 40, heartsY: 60 });
    await new Promise((ok) => setTimeout(ok, 300));
    const hud = H.game.scene.getScene("ZeldaMakerToolkitHUD");
    const shown = hud.children.list.filter((o) => o.visible);
    const hearts = shown.filter((o) => /heart8_/.test(o.texture?.key ?? ""));
    return { first: hearts[0] && [hearts[0].x, hearts[0].y], panels: shown.filter((o) => o.texture?.key === "IMG_BAR").length, keys: [...new Set(shown.map((o) => o.texture?.key))].join(",") };
  });
  await page.screenshot({ path: `${ARTIFACTS}hud-places.png` });
  await ev(() => window.__harness.run("Zelda: HUD Style", {}));
  // The hearts part starts with the LIFE label (7 px and a 2 px gap): its first heart is 9 HUD px lower.
  assert(r.first && r.first[0] === 80 && r.first[1] === (60 + 9) * 2, `first heart at ${JSON.stringify(r.first)} (${r.keys})`);
  assert(r.panels === 4, `${r.panels} panels`);
  return `first heart at ${r.first.join(",")} screen px, ${r.panels} panels`;
});

await check("HUD Style: own icons for built-in items (item box, inventory), own inventory panel (9-slice) and cursor", async () => {
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
    H.run("Zelda: HUD Style", { iconBoomerang: "IMG_ICON_BOOM", inventoryPanel: "IMG_INV_PANEL", panelSlice: 6, inventoryCursor: "IMG_INV_CURSOR" });
    tk.inventory.give("boomerang", 1, { silent: true });
    tk.state.inventory.activeItem = "boomerang";
    window.ZeldaMakerToolkit.session.inventoryUi.setOpen(true);
    await new Promise((ok) => setTimeout(ok, 300));
    const hud = H.game.scene.getScene("ZeldaMakerToolkitHUD");
    const shown = hud.children.list.filter((o) => o.visible);
    const by = (key) => shown.filter((o) => o.texture?.key === key);
    const out = { title: shown.filter((o) => o.type === "Text" && o.text === "Items").map((t) => t.alpha), icons: by("IMG_ICON_BOOM").length, panel: by("IMG_INV_PANEL").length, cursor: by("IMG_INV_CURSOR").length, builtin: shown.filter((o) => /icon_boomerang/.test(o.texture?.key ?? "")).length };
    return out;
  });
  await page.screenshot({ path: `${ARTIFACTS}hud-inventory-skin.png` });
  await ev(() => {
    window.ZeldaMakerToolkit.session.inventoryUi.setOpen(false);
    window.__harness.run("Zelda: HUD Style", {});
  });
  // The boomerang in the item box and in the inventory; the panel as 9 pieces.
  assert(r.icons === 2 && r.builtin === 0, `icons ${JSON.stringify(r)}`);
  assert(r.panel === 9 && r.cursor === 1, `panel ${JSON.stringify(r)}`);
  // The panel's title is drawn over the picture (pooled texts once kept a faded message's alpha 0).
  assert(r.title.length === 1 && r.title[0] === 1, `title ${JSON.stringify(r.title)}`);
  return `own icon ×${r.icons}, panel in ${r.panel} pieces, cursor, title visible`;
});

await check("Message Style: a sign's text in a box drawn like a PS Maker dialogue layout (9-slice picture), typed, closed with Z", async () => {
  const r = await ev(async () => {
    const H = window.__harness;
    const scene = H.scene();
    const c = document.createElement("canvas");
    c.width = 24;
    c.height = 24;
    const g = c.getContext("2d");
    g.fillStyle = "#6b4a2a";
    g.fillRect(0, 0, 24, 24);
    g.fillStyle = "#f0e0b0";
    g.fillRect(6, 6, 12, 12);
    scene.textures.addCanvas("IMG_PANEL", c);
    const data = scene.sys.settings.data ?? (scene.sys.settings.data = {});
    // The project data object stays the same in PS Maker (the toolkit keeps a reference to it).
    data.story = Object.assign(data.story ?? { characters: [], spritesheetAnimations: [] }, {
      gameConfig: { width: 1280, height: 720 },
      gameUI: {
        fonts: [],
        defaultDialogLayoutId: "wood",
        dialogLayouts: [{ id: "wood", name: "Wood", bottomGap: 14, typingSpeed: 60, textBox: { width: 896, height: 220, padding: { top: 24, right: 30, bottom: 24, left: 30 }, background: { type: "image", imageId: "IMG_PANEL", backgroundOpacity: 100, scalingMode: "nine-slice", borderWidth: 24, slice: { top: 6, right: 6, bottom: 6, left: 6 } }, textStyles: { fontFamily: "serif", fontAssetId: null, fontSize: 44, lineHeightPercent: 120, color: "#3a2a1a", textAlign: "left" } } }],
      },
    });
    H.run("Zelda: Message Style", { layout: "", kinds: ["sign", "item"] });
    H.run("Zelda: Show Message", { text: "It's dangerous to go alone! Take this.", box: true });
    await new Promise((ok) => setTimeout(ok, 200));
    const hud = H.game.scene.getScene("ZeldaMakerToolkitHUD");
    const texts = () => hud.children.list.filter((o) => o.type === "Text" && o.visible && o.depth === 16);
    const early = texts()[0]?.text ?? "";
    const pics = hud.children.list.filter((o) => o.visible && o.texture?.key === "IMG_PANEL").length;
    const paused = window.ZeldaMakerToolkit.session.isPaused("message");
    const press = async () => {
      scene.input.keyboard.emit("keydown", { code: "KeyZ", timeStamp: performance.now() });
      await new Promise((ok) => setTimeout(ok, 60));
      scene.input.keyboard.emit("keyup", { code: "KeyZ", timeStamp: performance.now() });
      await new Promise((ok) => setTimeout(ok, 120));
    };
    await press();
    const full = texts()[0]?.text ?? "";
    return { early, full, pics, paused, press: true };
  });
  await page.screenshot({ path: `${ARTIFACTS}message-box.png` });
  const closed = await ev(async () => {
    const scene = window.__harness.scene();
    scene.input.keyboard.emit("keydown", { code: "KeyZ", timeStamp: performance.now() });
    await new Promise((ok) => setTimeout(ok, 60));
    scene.input.keyboard.emit("keyup", { code: "KeyZ", timeStamp: performance.now() });
    await new Promise((ok) => setTimeout(ok, 150));
    const hud = window.__harness.game.scene.getScene("ZeldaMakerToolkitHUD");
    return { open: hud.children.list.some((o) => o.type === "Text" && o.visible && o.depth === 16), paused: window.ZeldaMakerToolkit.session.isPaused("message") };
  });
  await ev(() => (window.ZeldaMakerToolkit.toolkit.messageBox = null));
  assert(r.paused, "the game waits while the box is open");
  assert(r.pics === 9, `9-slice picture: ${r.pics} pieces`);
  assert(r.early.length > 0 && r.early.replace(/\n/g, " ").length < 38, `typing: "${r.early}"`);
  assert(r.full.replace(/\n/g, " ") === "It's dangerous to go alone! Take this.", `Z shows all: "${r.full}"`);
  assert(!closed.open && !closed.paused, `Z again closes: ${JSON.stringify(closed)}`);
  return `typed "${r.early.replace(/\n/g, " ")}" → all, 9 picture pieces`;
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
