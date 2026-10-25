/**
 * PS Maker host EMULATOR for testing Zelda Maker Toolkit outside the editor.
 *
 * It reproduces only what the plugin API documents: a Phaser GameMap scene,
 * an Arcade-physics player Actor moved by the host (8 directions), map
 * collision rectangles as static bodies, NPC sprites, On-load events and
 * trigger areas that call plugin actions with `(params, { game, scene, player })`.
 * It is NOT PS Maker; see docs/TESTING.md for what still needs checking there.
 */
import plugin from "../../dist/zelda-maker-toolkit.ps-maker.js";
import { MAPS } from "./demo-maps.js";

const Phaser = window.Phaser;
const SPEED = 90;
// ?w=1980&h=1475&mapZoom=6 emulates a large PS Maker window (camera zoom on the map).
const Q = new URLSearchParams(location.search);
const GAME_W = Number(Q.get("w") ?? 400);
const GAME_H = Number(Q.get("h") ?? 240);
const MAP_ZOOM = Number(Q.get("mapZoom") ?? 1);
const CANVAS_ZOOM = Number(Q.get("zoom") ?? 2);

function action(name) {
  const ev = plugin.events.find((e) => e.name === name);
  if (!ev) throw new Error(`Plugin has no action "${name}"`);
  return ev;
}

/** Original placeholder hero drawn on a canvas (blue hood, brown boots). */
function makeTexture(scene, key, w, h, paint) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  paint(tex.context);
  tex.refresh();
}

class GameMap extends Phaser.Scene {
  constructor() {
    super("GameMap");
  }

  init(data) {
    this.mapId = data?.mapId ?? "field";
    this.spawnAt = data?.spawn ?? null;
    this.firedTriggers = new Set();
  }

  create() {
    const map = MAPS[this.mapId];
    this.def = map;
    this.cameras.main.setBackgroundColor(map.floor);
    const g = this.add.graphics();
    g.setDepth(-10000);
    for (let x = 0; x < map.size.w; x += 16) for (let y = 0; y < map.size.h; y += 16) if ((x + y) % 32 === 0) g.fillStyle(0x000000, 0.06).fillRect(x, y, 16, 16);

    this.walls = this.physics.add.staticGroup();
    for (const w of map.walls) {
      const r = this.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 0x2b2b38);
      r.setDepth(-5000);
      this.walls.add(r);
    }

    makeTexture(this, "demo_hero", 14, 16, (c) => {
      c.fillStyle = "#1d3f8f";
      c.fillRect(2, 0, 10, 8);
      c.fillStyle = "#f2c9a0";
      c.fillRect(4, 3, 6, 4);
      c.fillStyle = "#3d7bd6";
      c.fillRect(2, 8, 10, 6);
      c.fillStyle = "#6b4423";
      c.fillRect(3, 14, 3, 2);
      c.fillRect(8, 14, 3, 2);
    });
    const spawn = this.spawnAt ?? map.spawn;
    this.player = this.physics.add.sprite(spawn.x, spawn.y, "demo_hero");
    this.player.body.setSize(12, 12).setOffset(1, 4);
    this.player.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, map.size.w, map.size.h);
    this.physics.add.collider(this.player, this.walls);

    for (const n of map.npcs) {
      makeTexture(this, `npc_${n.name}`, 14, 16, (c) => {
        c.fillStyle = n.color;
        c.fillRect(1, 2, 12, 14);
        c.fillStyle = "#222";
        c.fillRect(3, 5, 8, 2);
      });
      const npc = this.physics.add.staticSprite(n.x, n.y, `npc_${n.name}`);
      npc.name = n.name;
    }

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys("W,A,S,D");
    this.cameras.main.setZoom(MAP_ZOOM);
    this.cameras.main.startFollow(this.player, true);
    if (MAP_ZOOM === 1) this.cameras.main.setBounds(0, 0, map.size.w, map.size.h);

    // PS Maker runs the map's On-load events after the map is built.
    this.playEvent(map.onLoad);
    window.dispatchEvent(new CustomEvent("demo:map-loaded", { detail: this.mapId }));
  }

  ctx(endAction) {
    return { game: this.game, scene: this, player: this.player, endAction };
  }

  /**
   * Like PS Maker's StoryRunner: the actions of an event run in order and each must call
   * ctx.endAction() before the next one starts; one that never does leaves the event waiting.
   * (Toolkit actions end synchronously, so the check is synchronous here.)
   */
  playEvent(list) {
    for (const [name, params] of list) {
      let ended = false;
      action(name).execute(params, this.ctx(() => (ended = true)));
      if (!ended) {
        console.error(`[harness] "${name}" did not call ctx.endAction(): the rest of the event would never run.`);
        return;
      }
    }
  }

  update() {
    // Host-controlled movement (like PS Maker's player controller).
    const k = this.cursors;
    const left = k.left.isDown || this.wasd.A.isDown;
    const right = k.right.isDown || this.wasd.D.isDown;
    const up = k.up.isDown || this.wasd.W.isDown;
    const down = k.down.isDown || this.wasd.S.isDown;
    let vx = (right ? 1 : 0) - (left ? 1 : 0);
    let vy = (down ? 1 : 0) - (up ? 1 : 0);
    if (vx && vy) {
      vx *= Math.SQRT1_2;
      vy *= Math.SQRT1_2;
    }
    this.player.setVelocity(vx * SPEED, vy * SPEED);

    const b = this.player.body;
    for (const t of this.def.triggers) {
      const r = t.rect;
      const inside = b.right > r.x && b.x < r.x + r.w && b.bottom > r.y && b.y < r.y + r.h;
      if (!inside) continue;
      if (t.transfer) {
        // "Transfer player": PS Maker fades and reloads the map scene.
        this.scene.restart({ mapId: t.transfer.map, spawn: { x: t.transfer.x, y: t.transfer.y } });
        return;
      }
      const key = JSON.stringify(r);
      if (t.once && this.firedTriggers.has(key)) continue;
      this.firedTriggers.add(key);
      this.playEvent(t.events);
    }
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: GAME_W,
  height: GAME_H,
  zoom: CANVAS_ZOOM,
  pixelArt: true,
  backgroundColor: "#000000",
  physics: { default: "arcade", arcade: { debug: false } },
  scene: [GameMap],
});

// Harness-only shortcuts that an author would wire to PS Maker menu events.
window.addEventListener("keydown", (e) => {
  const scene = game.scene.getScene("GameMap");
  if (!scene?.player) return;
  if (e.code === "F5") scene.playEvent([["Zelda: Save Progress", { slot: "default" }]]);
  else if (e.code === "F8") scene.playEvent([["Zelda: Load Progress", { slot: "default" }]]);
  else if (e.code === "F6") scene.playEvent([["Zelda: Reset Progress", { slot: "default", newGame: true }]]);
  else return;
  e.preventDefault();
});

window.__harness = {
  game,
  plugin,
  scene: () => game.scene.getScene("GameMap"),
  player: () => game.scene.getScene("GameMap")?.player,
  run: (name, params) => {
    game.scene.getScene("GameMap").playEvent([[name, params]]);
  },
  api: () => window.ZeldaMakerToolkit,
};
