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
    const enemy = window.ZeldaMakerToolkit.session.world.get("knight_1");
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
    const chest = window.ZeldaMakerToolkit.session.world.get("boomerang_chest");
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
  const wall = await ev(() => window.ZeldaMakerToolkit.session.world.get("secret_wall").objState);
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
  const r = await ev(() => ({ sw: window.ZeldaMakerToolkit.session.world.get("gate_switch").objState, gate: window.ZeldaMakerToolkit.session.world.get("gate").objState }));
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

await check("map transfer restarts the scene without leaking listeners", async () => {
  // Phaser registers some listeners of its own when the HUD scene is first
  // created, so compare repeated visits: counts must not grow per transfer.
  await teleport(392, 120);
  await waitForMap("dungeon");
  const d1 = await listenerCounts();
  await teleport(4, 200);
  await waitForMap("field");
  const f2 = await listenerCounts();
  await teleport(392, 120);
  await waitForMap("dungeon");
  const d2 = await listenerCounts();
  await teleport(4, 200);
  await waitForMap("field");
  const f3 = await listenerCounts();
  await teleport(392, 120);
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
  await page.waitForFunction(() => window.ZeldaMakerToolkit.session.world.get("plate_1").objState === "on", null, { timeout: 4000 });
  await page.keyboard.up("ArrowRight");
  await sleep(200);
  const door = await ev(() => window.ZeldaMakerToolkit.session.world.get("puzzle_door").objState);
  assert(door === "opened", `door ${door}`);
});

await check("dungeon: key from the chest opens the locked door", async () => {
  await teleport(60, 74);
  await tapKey("ArrowUp", 40);
  await tapKey("z");
  // Poll instead of a fixed delay: under load the chest can open a few frames later.
  await page.waitForFunction(() => window.ZeldaMakerToolkit.toolkit.inventory.count("key") > 0, null, { timeout: 1500 }).catch(() => {});
  const keys = await ev(() => window.ZeldaMakerToolkit.toolkit.inventory.count("key"));
  await teleport(180, 120);
  await page.keyboard.down("ArrowRight");
  await sleep(500);
  await page.keyboard.up("ArrowRight");
  const r = await ev(() => ({ door: window.ZeldaMakerToolkit.session.world.get("key_door").objState, keys: window.ZeldaMakerToolkit.toolkit.inventory.count("key") }));
  assert(keys === 1, `keys after chest ${keys}`);
  assert(r.door === "unlocked" && r.keys === 0, JSON.stringify(r));
});

await check("arena trigger starts waves at points picked on the map (Add Wave Enemy)", async () => {
  await teleport(224, 120);
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
  const r = await ev(() => ({ chest: window.ZeldaMakerToolkit.session.world.get("boomerang_chest").objState, wall: window.ZeldaMakerToolkit.session.world.get("secret_wall").objState, gate: window.ZeldaMakerToolkit.session.world.get("gate").objState }));
  assert(r.chest === "opened" && r.wall === "destroyed" && r.gate === "opened", JSON.stringify(r));
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

await check("sprite sheets: data-URL and texture-key sheets, attack overlay, enemy animation, preview", async () => {
  const r = await ev(async () => {
    const H = window.__harness;
    const scene = H.scene();
    // A 4x2 sheet of 16x16 frames with distinct colors, as a texture and as a data URL.
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 32;
    const g = c.getContext("2d");
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `hsl(${i * 45},80%,50%)`;
      g.fillRect((i % 4) * 16, Math.floor(i / 4) * 16, 16, 16);
    }
    scene.textures.addCanvas("test_sheet_tex", c);
    H.run("Zelda: Define Sprite Sheet", { id: "hero", image: "test_sheet_tex", imageKey: "", frameWidth: 16, frameHeight: 16, margin: 0, spacing: 0 });
    H.run("Zelda: Define Sprite Sheet", { id: "url_sheet", image: { url: c.toDataURL() }, imageKey: "", frameWidth: 16, frameHeight: 16, margin: 0, spacing: 0 });
    H.run("Zelda: Define Animation", { id: "slash", sheet: "hero", frames: "0, 1, 2, 3", framesUp: "", framesLeft: "", framesRight: "4, 5, 6, 7", fps: 0, loop: false });
    H.run("Zelda: Define Animation", { id: "blob_walk", sheet: "url_sheet", frames: "1,2", fps: 6, loop: true });
    H.run("Zelda: Set Player Sprites", { attack: "slash", weaponAttack: "", spin: "", weaponSpin: "", charge: "", weaponCharge: "", hurt: "", behindUp: true, behindDown: false, behindLeft: false, behindRight: false, hidePlayer: true, offsetX: 0, offsetY: 0 });
    H.run("Zelda: Define Enemy", { name: "blind_slime", basedOn: "slime", hp: 0, damage: 0, speed: 0, detectRange: 1, boss: false, immuneTo: "" });
    H.run("Zelda: Create Enemy", { template: "blind_slime", position: { x: 60, y: 200 }, id: "anim_slime", group: "", hp: 0, damage: 0, speed: 0, walkAnimation: "blob_walk", attackAnimation: "", hurtAnimation: "", deathAnimation: "", patrol: "" });
    await new Promise((ok) => setTimeout(ok, 400));
    const p = H.player();
    const before = p.alpha;
    scene.input.keyboard.emit("keydown", { code: "KeyX" });
    scene.input.keyboard.emit("keyup", { code: "KeyX" });
    await new Promise((ok) => setTimeout(ok, 120));
    const during = p.alpha;
    const overlay = scene.children.list.filter((o) => o.type === "Image" && o.visible && o.texture?.key === "test_sheet_tex" && String(o.frame?.name).startsWith("zmt_16x16_"));
    await new Promise((ok) => setTimeout(ok, 600));
    const after = p.alpha;
    const enemyImg = scene.children.list.find((o) => o.type === "Image" && String(o.texture?.key).startsWith("zmt_sheet_url_sheet"));
    H.run("Zelda: Preview Sprite Sheet", { sheet: "hero", show: true });
    await new Promise((ok) => setTimeout(ok, 100));
    const hud = H.game.scene.getScene("ZeldaMakerToolkitHUD");
    const labels = hud.children.list.filter((o) => o.type === "Text" && o.visible && /^[0-7]$/.test(o.text)).length;
    H.run("Zelda: Preview Sprite Sheet", { sheet: "hero", show: false });
    return { before, during, after, overlay: overlay.length, overlayFrame: overlay[0]?.frame?.name, enemyFrame: enemyImg?.frame?.name ?? null, labels };
  });
  assert(r.during === 0 && r.after === r.before, `player alpha ${r.before} → ${r.during} → ${r.after}`);
  assert(r.overlay >= 1, "attack overlay image not shown");
  assert(r.enemyFrame === "zmt_16x16_1" || r.enemyFrame === "zmt_16x16_2", `enemy frame ${r.enemyFrame}`);
  assert(r.labels === 8, `preview labels ${r.labels}`);
  return `overlay ${r.overlayFrame}, enemy ${r.enemyFrame}, preview ${r.labels} frames`;
});

await check("PS Maker project data: a character's sheets animate a Create Enemy (real Phaser scene search)", async () => {
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
    scene.textures.addCanvas(src, c);
    const rowsOf = (id) => [0, 1, 2, 3].map((row) => ({ id: id + row, startCol: 0, startRow: row, endCol: 3, endRow: row }));
    H.game.cache.json.add("story", {
      characters: [{ id: "BLOB", name: "Blob", animationSets: [{ id: "s", animations: { down: "RUN10", left: "RUN11", right: "RUN12", up: "RUN13" }, collision: { enabled: true, box: { x: 10, y: 14, width: 12, height: 12 } } }] }],
      spritesheetAnimations: [{ id: "RUN1", name: "Blob Run", src, frameWidth: 32, frameHeight: 32, frameRate: 8, ownerRef: { type: "npc", id: "BLOB" }, animations: rowsOf("RUN1") }],
    });
    const t0 = performance.now();
    H.run("Zelda: Create Enemy", { template: "slime", position: { x: 80, y: 60 }, id: "ps_blob", character: "BLOB" });
    const searchMs = performance.now() - t0;
    await new Promise((ok) => setTimeout(ok, 300));
    const img = scene.children.list.find((o) => o.type === "Image" && o.texture?.key === src);
    const e = window.ZeldaMakerToolkit.session.world.get("ps_blob");
    const diag = window.ZeldaMakerToolkit.session.host.describe().find((l) => l.startsWith("PS Maker data"));
    return { frame: img?.frame?.name ?? null, w: e?.cfg.width, diag, searchMs: Math.round(searchMs) };
  });
  assert(r.frame && r.frame.startsWith("zmt_32x32_"), `enemy frame ${r.frame}`);
  assert(r.w === 12, `hitbox width ${r.w}`);
  assert(/cache\.json/.test(r.diag), r.diag);
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
