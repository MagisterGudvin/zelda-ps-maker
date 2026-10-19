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
    return { postupdate: s.events.listenerCount("postupdate"), keydown: s.input.keyboard.listenerCount("keydown"), blur: window.__harness.game.events.listenerCount("blur") };
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
  await sleep(200);
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
