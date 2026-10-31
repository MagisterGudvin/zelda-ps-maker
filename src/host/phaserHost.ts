import type { ToolkitConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { type AABB, type Facing, makeBox, overlaps } from "../core/math.ts";
import { SpatialHash } from "../core/spatialHash.ts";
import type { DebugDraw, EntityView, GameControl, HostAdapter, HudSink, OverlayLayer, Renderer, ViewSpec } from "./types.ts";
import { GAME_KEY_MARK, KeyboardInput, normalizeKey } from "./keyboardInput.ts";
import { GamepadBridge, gamepadMapping, padFamily, type PadSnapshot } from "./gamepadBridge.ts";
import { resolveTexture } from "./textures.ts";
import { ensureProjectFont } from "./projectFonts.ts";
import { getHud } from "./phaserHud.ts";
import { SheetLibrary } from "./sheets.ts";
import { storyOfScene, sheetImage, type PsSheet, type PsStory } from "./psmakerAssets.ts";

/**
 * The PS Maker plugin context, typed only as far as the toolkit uses it.
 * (`@ps-maker/plugin-api` declares scene/player as `any`.)
 */
export interface PluginContextLike {
  game: any;
  scene: any;
  player: any;
}

/**
 * The scene the player lives in. PS Maker documents `ctx.scene` as the map
 * scene, but the player's own scene is the safest source (it is where the
 * camera, physics and map collision are).
 */
export function mapSceneOf(ctx: PluginContextLike): any {
  const s = ctx.player?.scene;
  return s && s.sys && s.add ? s : ctx.scene;
}

/** PS Maker's default keys of the controls the player can change (features/controls/controls.ts: builtInControls). */
const PS_MAKER_CONTROL_KEYS: Record<GameControl, string[]> = {
  moveUp: ["KeyW", "ArrowUp"],
  moveDown: ["KeyS", "ArrowDown"],
  moveLeft: ["KeyA", "ArrowLeft"],
  moveRight: ["KeyD", "ArrowRight"],
  interact: ["KeyZ", "Enter"],
};

const OVERLAY_DEPTH = 100000;
const DEBUG_DEPTH = 200000;

interface StaticBox extends AABB {
  body: any;
}

/** Depth provider: lets views follow PS Maker's own sorting (see world.depthMode). */
interface DepthSource {
  depthFor(y: number, layer: number): number;
  sheetFrame(sheet: string, frame: number): { key: string; frame: string } | null;
}

/** First row of a Phaser frame with a visible pixel, or null (no canvas / unreadable image). */
function opaqueTopRow(frame: any): number | null {
  try {
    const src = frame.source?.image;
    const w = frame.cutWidth ?? frame.width;
    const h = frame.cutHeight ?? frame.height;
    const doc = (globalThis as { document?: { createElement(t: string): any } }).document;
    if (!src || !doc || !w || !h) return null;
    const canvas = doc.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(src, frame.cutX ?? 0, frame.cutY ?? 0, w, h, 0, 0, w, h);
    const data: Uint8ClampedArray = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 16) return y;
    return null;
  } catch {
    return null;
  }
}

/** "key#frame" names one frame of a sheet texture (a map object look); plain keys use the whole image. */
export function spriteKey(sprite: string): string {
  const i = sprite.lastIndexOf("#");
  return i > 0 ? sprite.slice(0, i) : sprite;
}
export function spriteFrame(sprite: string): string | undefined {
  const i = sprite.lastIndexOf("#");
  return i > 0 ? sprite.slice(i + 1) : undefined;
}

/** Per-axis scale that fits a sprite to an entity when the entity is a whole multiple of it, else 1. */
export function wholeScale(texW: number, texH: number, w: number, h: number): [number, number] {
  const fx = texW > 0 && w % texW === 0 ? w / texW : 1;
  const fy = texH > 0 && h % texH === 0 ? h / texH : 1;
  return [Math.max(1, fx), Math.max(1, fy)];
}

/** A Phaser Image owned by the toolkit. */
class ImageView implements EntityView {
  private readonly scene: any;
  private readonly img: any;
  private readonly spec: ViewSpec;
  private readonly host: DepthSource;
  private sprite: string;
  private frameKey = "";
  private depthY: number | null = null;

  constructor(scene: any, host: DepthSource, spec: ViewSpec, textureKey: string) {
    this.scene = scene;
    this.host = host;
    this.spec = spec;
    this.sprite = spec.sprite;
    this.img = scene.add.image(0, 0, textureKey, spriteFrame(spec.sprite));
    this.fitSize();
    if (spec.tint !== undefined) this.img.setTint(spec.tint);
    if (spec.originX !== undefined || spec.originY !== undefined) this.img.setOrigin(spec.originX ?? 0.5, spec.originY ?? 0.5);
    if (spec.overlay) this.img.setDepth(OVERLAY_DEPTH);
  }

  private fitSize(): void {
    if (this.spec.scale) {
      this.img.setScale(this.spec.scale);
      return;
    }
    // Author textures (from PS Maker image params) are scaled to the entity size.
    const key: string = this.img.texture?.key ?? "";
    if (!key.startsWith("zmt_") && this.spec.width && this.spec.height) this.img.setDisplaySize(this.spec.width, this.spec.height);
    // Built-in pixel sprites only by whole multiples (a 16 px door on a 32 px gate), so pixels stay square.
    else if (key.startsWith("zmt_") && this.spec.width && this.spec.height) this.img.setScale(...wholeScale(this.img.width, this.img.height, this.spec.width, this.spec.height));
  }

  setPosition(x: number, y: number): void {
    this.img.setPosition(x + (this.spec.offsetX ?? 0), y + (this.spec.offsetY ?? 0));
    if (this.spec.overlay) return;
    this.img.setDepth(this.host.depthFor(this.depthY ?? y, this.spec.layer ?? 0));
  }
  setDepthY(y: number | null): void {
    this.depthY = y;
  }
  setVisible(visible: boolean): void {
    this.img.setVisible(visible);
  }
  setAlpha(alpha: number): void {
    this.img.setAlpha(alpha);
  }
  setTint(color: number | null): void {
    if (color === null) {
      if (this.spec.tint !== undefined) this.img.setTint(this.spec.tint);
      else this.img.clearTint();
    } else this.img.setTint(color);
  }
  setSprite(sprite: string): void {
    if (sprite === this.sprite && !this.frameKey) return;
    const key = resolveTexture(this.scene.textures, spriteKey(sprite));
    if (!key) return;
    this.sprite = sprite;
    this.frameKey = "";
    this.img.setTexture(key, spriteFrame(sprite));
    this.fitSize();
  }
  setAnimFrame(sheet: string, frame: number, flipX: boolean): void {
    const ref = this.host.sheetFrame(sheet, frame);
    if (ref) {
      const id = `${ref.key}|${ref.frame}`;
      if (id !== this.frameKey) {
        this.frameKey = id;
        this.img.setTexture(ref.key, ref.frame);
        this.img.setScale(this.spec.scale ?? 1);
      }
    }
    this.img.setFlipX(flipX);
  }
  setRotation(r: number): void {
    this.img.setRotation(r);
  }
  setScale(s: number): void {
    this.img.setScale(s * (this.spec.scale ?? 1));
  }
  setFlipX(flip: boolean): void {
    this.img.setFlipX(flip);
  }
  destroy(): void {
    this.img.destroy();
  }
}

/**
 * Wraps a PS Maker NPC object used as an enemy/object visual. We do not own
 * it: its own physics body is disabled while adopted (so it does not block or
 * drag the entity) and it is hidden instead of destroyed.
 */
class AdoptedView implements EntityView {
  private readonly obj: any;
  private readonly hadBody: boolean;

  constructor(obj: any) {
    this.obj = obj;
    this.hadBody = !!obj.body && obj.body.enable !== false;
    if (this.hadBody) obj.body.enable = false;
  }

  setPosition(x: number, y: number): void {
    this.obj.x = x;
    this.obj.y = y;
  }
  setVisible(visible: boolean): void {
    this.obj.setVisible?.(visible);
  }
  setAlpha(alpha: number): void {
    this.obj.setAlpha?.(alpha);
  }
  setTint(color: number | null): void {
    if (color === null) this.obj.clearTint?.();
    else this.obj.setTint?.(color);
  }
  setSprite(): void {
    // Adopted NPCs keep their own PS Maker animation set.
  }
  setRotation(): void {}
  setScale(): void {}
  setFlipX(flip: boolean): void {
    this.obj.setFlipX?.(flip);
  }
  setAnimFrame(): void {
    // Adopted NPCs keep their own PS Maker animation set.
  }
  destroy(): void {
    this.obj.setVisible?.(false);
    this.obj.clearTint?.();
  }
}

/**
 * Debug overlay plus a coordinate picker: while the overlay is on (F9), a
 * click on the map marks the point, shows "X: … Y: …" and copies "x, y" to the
 * clipboard, so the numbers can be pasted into Position fields of plugin
 * actions (the editor shows plugin positions as number fields, not a picker).
 */
class PhaserDebug implements DebugDraw {
  private readonly g: any;
  private readonly labels: any[] = [];
  private used = 0;
  private readonly scene: any;
  private readonly pickG: any;
  private readonly pickText: any;
  private readonly cfg: ToolkitConfig;
  private readonly logger: Logger;
  private readonly onPointer = (pointer: any) => this.pick(pointer);

  constructor(scene: any, cfg: ToolkitConfig, logger: Logger) {
    this.scene = scene;
    this.cfg = cfg;
    this.logger = logger;
    this.g = scene.add.graphics();
    this.g.setDepth(DEBUG_DEPTH);
    this.g.setVisible(false);
    this.pickG = scene.add.graphics();
    this.pickG.setDepth(DEBUG_DEPTH + 2);
    this.pickText = scene.add.text(0, 0, "", { fontFamily: "monospace", fontSize: "8px", color: "#ffff66", backgroundColor: "#000000cc" });
    this.pickText.setDepth(DEBUG_DEPTH + 3);
    this.pickText.setVisible(false);
    scene.input?.on?.("pointerdown", this.onPointer);
  }

  /** Converts a click to map coordinates (pixels, and tiles when positionUnits = tiles). */
  private pick(pointer: any): void {
    if (!this.g.visible || !pointer) return;
    const x = Math.round(pointer.worldX ?? pointer.x);
    const y = Math.round(pointer.worldY ?? pointer.y);
    const t = this.cfg.world.tileSize;
    const tiles = this.cfg.world.positionUnits === "tiles";
    const vx = tiles ? Math.floor(x / t) : x;
    const vy = tiles ? Math.floor(y / t) : y;
    this.pickG.clear();
    this.pickG.lineStyle(1, 0xffff66, 1);
    this.pickG.strokeCircle(x, y, 4);
    this.pickG.lineBetween(x - 7, y, x + 7, y);
    this.pickG.lineBetween(x, y - 7, x, y + 7);
    const text = `X: ${vx} Y: ${vy}${tiles ? " (tiles)" : ""}`;
    this.pickText.setText(`${text}  copied`).setPosition(x + 6, y + 6).setVisible(true);
    this.logger.info(`Picked ${text} (pixels ${x}, ${y}).`);
    try {
      void navigator?.clipboard?.writeText?.(`${vx}, ${vy}`)?.catch?.(() => undefined);
    } catch {
      // Clipboard may be unavailable (insecure context); the label still shows the numbers.
    }
  }

  clear(): void {
    this.g.clear();
    for (let i = 0; i < this.used; i++) this.labels[i].setVisible(false);
    this.used = 0;
  }
  rect(box: AABB, color: number, alpha = 0.3): void {
    this.g.fillStyle(color, alpha);
    this.g.fillRect(box.x - box.hw, box.y - box.hh, box.hw * 2, box.hh * 2);
    this.g.lineStyle(1, color, 1);
    this.g.strokeRect(box.x - box.hw, box.y - box.hh, box.hw * 2, box.hh * 2);
  }
  circle(x: number, y: number, r: number, color: number, alpha = 0.3): void {
    this.g.fillStyle(color, alpha);
    this.g.fillCircle(x, y, r);
    this.g.lineStyle(1, color, 1);
    this.g.strokeCircle(x, y, r);
  }
  label(x: number, y: number, text: string): void {
    let t = this.labels[this.used];
    if (!t) {
      t = this.scene.add.text(0, 0, "", { fontFamily: "monospace", fontSize: "8px", color: "#ffffff", backgroundColor: "#000000aa" });
      t.setDepth(DEBUG_DEPTH + 1);
      this.labels.push(t);
    }
    this.used++;
    t.setText(text);
    t.setPosition(x, y);
    t.setVisible(this.g.visible);
  }
  setVisible(visible: boolean): void {
    this.g.setVisible(visible);
    if (!visible) {
      for (const t of this.labels) t.setVisible(false);
      this.pickG.clear();
      this.pickText.setVisible(false);
    }
  }
  dispose(): void {
    this.scene.input?.off?.("pointerdown", this.onPointer);
    this.pickG.destroy();
    this.pickText.destroy();
    this.g.destroy();
    for (const t of this.labels) t.destroy();
    this.labels.length = 0;
  }
}

/**
 * HostAdapter for PS Maker. Everything engine-specific is here; the rest of
 * the toolkit only sees the HostAdapter interface. All listeners and objects
 * created here are released in `dispose()`.
 */
export class PhaserHost implements HostAdapter, DepthSource {
  readonly input: KeyboardInput;
  /** Gamepads → key events (PS Maker has no gamepad support of its own). */
  private readonly pads: GamepadBridge;
  readonly renderer: Renderer;
  readonly hud: HudSink | null;
  readonly debug: PhaserDebug | null;
  readonly scene: any;
  readonly game: any;
  player: any;

  private readonly cfg: ToolkitConfig;
  private readonly logger: Logger;
  private locked = false;
  private pinX = 0;
  private pinY = 0;
  private hiddenByUs = false;
  private tintedByUs = false;
  private readonly staticIndex = new SpatialHash<StaticBox>(64);
  private readonly staticPool: StaticBox[] = [];
  private staticCount = -1;
  private readonly candidates: StaticBox[] = [];
  /** Moving NPC bodies, refreshed every tick (they move). */
  private readonly npcBoxes: AABB[] = [];
  private npcCount = 0;
  private frameListener: ((time: number, delta: number) => void) | null = null;
  private preUpdateListener: (() => void) | null = null;
  /** Roc's Feather: how high the player is drawn, the lift applied this frame, the shadow, the camera's own follow offset. */
  private hop = 0;
  private hopApplied = 0;
  private hopShadow: any = null;
  private followBase: number | null = null;
  /** The engine's walking speed before the toolkit slowed it (shield up), or null. */
  private baseSpeed: number | null = null;
  private shutdownListener: (() => void) | null = null;
  private disposed = false;
  private readonly probe = makeBox();
  private readonly sheets: SheetLibrary;
  private playerDepth = 0;
  private playerY = 0;
  private ySorted = true;
  private overlayImgs: any[] = [];
  /** Arcade static bodies standing in for toolkit solids (pooled zones) and their collider. */
  private solidGroup: any = null;
  private solidCollider: any = null;
  private solidColliderPlayer: any = null;
  private readonly solidZones: any[] = [];
  private solidSig = "";
  private overlayHidPlayer = false;
  private savedAlpha = 1;

  constructor(ctx: PluginContextLike, cfg: ToolkitConfig, logger: Logger) {
    this.scene = mapSceneOf(ctx);
    if (ctx.scene && this.scene !== ctx.scene) logger.info("ctx.scene differs from the player's scene; using the player's scene for toolkit objects.");
    this.game = ctx.game ?? this.scene?.game;
    this.player = ctx.player;
    this.cfg = cfg;
    this.logger = logger;
    const keyboard = this.scene?.input?.keyboard ?? null;
    if (!keyboard) logger.warn("Phaser keyboard plugin not available on the map scene: toolkit controls are disabled.");
    const pointer = typeof this.scene?.input?.on === "function" ? this.scene.input : null;
    this.input = new KeyboardInput(cfg, keyboard, this.game?.events ?? null, pointer);
    this.pads = new GamepadBridge({
      readPads: () => this.readPads(),
      send: (type, code) => this.sendKey(type, code),
      mapping: () => gamepadMapping(cfg, this.moveKeys()),
      deadzone: () => cfg.controls.gamepad.deadzone,
      onUse: (family) => (this.input.device = { kind: "gamepad", family }),
    });
    // A right-click bound to an action must not open the browser's menu over the game.
    if (this.usesMouse("MouseRight")) this.scene?.input?.mouse?.disableContextMenu?.();
    const scene = this.scene;
    this.renderer = {
      createView: (spec: ViewSpec): EntityView => {
        if (spec.adopt && typeof spec.adopt === "object") return new AdoptedView(spec.adopt);
        let key = resolveTexture(scene.textures, spriteKey(spec.sprite));
        if (!key) {
          logger.warnOnce(`tex-${spec.sprite}`, `Sprite "${spec.sprite}" is neither a loaded texture nor a built-in sprite; using a placeholder.`);
          key = resolveTexture(scene.textures, "icon_generic")!;
        }
        return new ImageView(scene, this, spec, key);
      },
    };
    this.sheets = new SheetLibrary(scene, logger);
    this.hud = this.game?.scene ? getHud(this.game, logger) : null;
    this.debug = scene?.add ? new PhaserDebug(scene, cfg, logger) : null;
  }

  /** Hooks the per-frame callback and scene shutdown. */
  attach(onFrame: (deltaMs: number) => void, onShutdown: () => void): void {
    const events = this.scene?.events;
    if (!events) throw new Error("Map scene has no event emitter; cannot attach the toolkit.");
    this.frameListener = (_time: number, delta: number) => {
      // Pad buttons become key events now; the game reads them in the next frame, as real keys.
      this.pads.poll();
      this.enforceLock();
      onFrame(delta);
      this.applyHop();
    };
    // The jump lifts only the drawing: the real position is back before physics runs.
    this.preUpdateListener = () => this.restoreHop();
    events.on("preupdate", this.preUpdateListener);
    this.shutdownListener = () => onShutdown();
    // POST_UPDATE runs after Arcade Physics has synced bodies to sprites, so our
    // position corrections (knockback, solids, locks) are what gets rendered.
    events.on("postupdate", this.frameListener);
    events.once("shutdown", this.shutdownListener);
    events.once("destroy", this.shutdownListener);
  }

  updatePlayer(player: any): void {
    if (player && player !== this.player) this.player = player;
  }

  /** Gamepads through the browser (navigator.getGamepads): every connected pad, standard mapping. */
  private readPads(): PadSnapshot[] {
    if (!this.cfg.controls.gamepad.enabled) return [];
    const nav = (globalThis as { navigator?: { getGamepads?: () => (Gamepad | null)[] } }).navigator;
    let list: (Gamepad | null)[] = [];
    try {
      list = nav?.getGamepads?.() ?? [];
    } catch {
      return [];
    }
    const out: PadSnapshot[] = [];
    for (const g of list) if (g && g.connected !== false) out.push({ id: g.id, buttons: g.buttons.map((b) => b.pressed || b.value > 0.5), axes: g.axes });
    return out;
  }

  /** PS Maker's movement keys for the d-pad and the stick: the first key of each project control (moveUp...). */
  private moveKeys(): { up: string; down: string; left: string; right: string } {
    const b = (this.psMakerStory() as { controls?: { bindings?: Record<string, string[]> } } | null)?.controls?.bindings ?? {};
    // A direction the player gave a key of their own: that key (it is handed on to PS Maker like a pressed one).
    const m = this.cfg.controls.move;
    const pick = (id: GameControl, dir: "up" | "down" | "left" | "right", fallback: string) => (this.gameKeysOwn.has(id) && m[dir][0] ? m[dir][0] : (b[id]?.[0] ?? fallback));
    return { up: pick("moveUp", "up", "ArrowUp"), down: pick("moveDown", "down", "ArrowDown"), left: pick("moveLeft", "left", "ArrowLeft"), right: pick("moveRight", "right", "ArrowRight") };
  }

  /**
   * A key event on the page, as a real key would send it: PS Maker, Phaser and the toolkit all read
   * window key events. It starts at the page body and bubbles up to the window, as a real key does,
   * so listeners that capture on the window (the toolkit taking Escape for its pause menu) run
   * before the window's own ones (PS Maker's options menu); sent at the window itself, the
   * browser ran PS Maker's listener first.
   */
  private sendKey(type: "keydown" | "keyup", code: string, mark = false, repeat = false): void {
    const g = globalThis as unknown as { document?: { body?: EventTarget | null }; dispatchEvent?: (e: Event) => boolean; KeyboardEvent?: typeof KeyboardEvent };
    if (typeof g.KeyboardEvent !== "function") return;
    const target: EventTarget | null = g.document?.body ?? (typeof g.dispatchEvent === "function" ? (g as unknown as EventTarget) : null);
    const event = new g.KeyboardEvent(type, { code, key: keyOfCode(code), bubbles: true, cancelable: true, repeat });
    if (mark) Object.defineProperty(event, GAME_KEY_MARK, { value: true });
    target?.dispatchEvent(event);
  }

  /** Player key (normalized) → the PS Maker key sent in its place; PS Maker keys the player moved away from. */
  private readonly gameKeyFor = new Map<string, string>();
  private readonly gameKeysFreed = new Set<string>();
  /** Controls the player gave keys of their own. */
  private readonly gameKeysOwn = new Set<GameControl>();
  private gameKeysListening = false;

  /**
   * The player's own keys for PS Maker's walking and Interact. PS Maker reads them from `keydown` /
   * `keyup` on `window` (Game.ts: handleMovementKeyDown — which skips an event whose default was
   * prevented, so does Phaser's keyboard — and handleMovementKeyUp; the controls'
   * keys: the project's bindings, else builtInControls). So on `window`, before them (capture
   * phase), a player's key is taken (default prevented, counted by the toolkit itself) and PS
   * Maker gets its own key for it (an event marked for the toolkit to skip); a PS Maker key the
   * player moved away from is taken too, so it no longer walks.
   */
  setPlayerGameKeys(keys: Partial<Record<GameControl, string[]>>): void {
    this.gameKeyFor.clear();
    this.gameKeysFreed.clear();
    this.gameKeysOwn.clear();
    const bindings = (this.psMakerStory() as { controls?: { bindings?: Record<string, string[]> } } | null)?.controls?.bindings ?? {};
    for (const id of Object.keys(PS_MAKER_CONTROL_KEYS) as GameControl[]) {
      const mine = (keys[id] ?? []).map(normalizeKey);
      if (!mine.length) continue;
      this.gameKeysOwn.add(id);
      const ps = Array.isArray(bindings[id]) ? bindings[id] : PS_MAKER_CONTROL_KEYS[id];
      // PS Maker's key to send: one the player still uses, else its first.
      const target = ps.find((k) => mine.includes(normalizeKey(k))) ?? ps[0];
      if (!target) continue;
      for (const k of mine) if (!ps.some((p) => normalizeKey(p) === k)) this.gameKeyFor.set(k, target);
      for (const p of ps) if (!mine.includes(normalizeKey(p))) this.gameKeysFreed.add(normalizeKey(p));
    }
    if (this.gameKeyFor.size || this.gameKeysFreed.size) this.listenGameKeys();
  }

  private listenGameKeys(): void {
    const win = globalThis as unknown as { addEventListener?: (t: string, f: (e: KeyboardEvent) => void, c: boolean) => void };
    if (this.gameKeysListening || typeof win.addEventListener !== "function") return;
    win.addEventListener("keydown", this.onGameKey, true);
    win.addEventListener("keyup", this.onGameKey, true);
    this.gameKeysListening = true;
  }

  private gameKeysClaim: (() => boolean) | null = null;

  /**
   * While `wants()` is true (a toolkit screen that takes the keys is open), PS Maker gets none of its
   * walking and Interact keys: they are the toolkit's (a press in the pause menu must not also talk
   * to the NPC in front, through PS Maker's interact). Releases still reach PS Maker.
   */
  claimGameKeys(wants: () => boolean): () => void {
    this.gameKeysClaim = wants;
    this.listenGameKeys();
    return () => {
      if (this.gameKeysClaim === wants) this.gameKeysClaim = null;
    };
  }

  /** PS Maker's walking and Interact keys now (normalized): the project's bindings, else its defaults. */
  private psGameKeys(): Set<string> {
    const bindings = (this.psMakerStory() as { controls?: { bindings?: Record<string, string[]> } } | null)?.controls?.bindings ?? {};
    const out = new Set<string>();
    for (const id of Object.keys(PS_MAKER_CONTROL_KEYS) as GameControl[]) for (const k of Array.isArray(bindings[id]) ? bindings[id] : PS_MAKER_CONTROL_KEYS[id]) out.add(normalizeKey(k));
    return out;
  }

  private readonly onGameKey = (e: KeyboardEvent): void => {
    if (this.disposed || (e as unknown as Record<string, unknown>)[GAME_KEY_MARK] || typeof e.code !== "string") return;
    const target = e.target as { isContentEditable?: boolean; matches?: (q: string) => boolean } | null;
    if (target?.isContentEditable || target?.matches?.("input, textarea, select")) return;
    const code = normalizeKey(e.code);
    const to = this.gameKeyFor.get(code);
    const held = e.type === "keydown" && this.gameKeysClaim?.() === true && (!!to || this.psGameKeys().has(code));
    if (!to && !this.gameKeysFreed.has(code) && !held) return;
    e.preventDefault();
    if (e.type === "keydown") this.input.inject(e);
    else this.input.injectUp(e);
    // A release always goes on (a key held when the menu opened must not stay down for PS Maker).
    if (to && !held) this.sendKey(e.type === "keydown" ? "keydown" : "keyup", to, true, e.repeat === true);
  };

  private usesMouse(code: string): boolean {
    const c = this.cfg.controls;
    return [c.sword, c.useItem, c.useItem2, c.shield, c.action, c.nextItem, c.prevItem, c.inventory, c.menu].some((keys) => keys.includes(code));
  }

  capturePadButton(cb: ((button: number) => void) | null): void {
    this.pads.captureNext(cb);
  }

  /** The kind of the first connected pad, if any. */
  padFamily(): ReturnType<typeof padFamily> | null {
    const pad = this.readPads()[0];
    return pad ? padFamily(pad.id) : null;
  }

  readPlayerBox(out: AABB): boolean {
    const p = this.player;
    if (!p || p.active === false) return false;
    const body = p.body;
    if (body && body.enable !== false && typeof body.width === "number" && body.width > 0) {
      out.x = body.x + body.width / 2;
      out.y = body.y + body.height / 2;
      out.hw = body.width / 2;
      out.hh = body.height / 2;
      return true;
    }
    const w = p.displayWidth ?? p.width ?? 16;
    const h = p.displayHeight ?? p.height ?? 16;
    out.x = p.x;
    out.y = p.y;
    out.hw = w / 2;
    out.hh = h / 2;
    return true;
  }

  readPlayerFacingHint(current: Facing): Facing | null {
    if (this.cfg.player.facingFromInput) {
      const fromKeys = this.input.directionHint(current);
      if (fromKeys) return fromKeys;
    }
    if (!this.cfg.player.facingFromAnimation) return null;
    const key: string = this.player?.anims?.currentAnim?.key ?? "";
    const k = key.toLowerCase();
    if (k.includes("up")) return "up";
    if (k.includes("down")) return "down";
    if (k.includes("left")) return "left";
    if (k.includes("right")) return "right";
    return null;
  }

  movePlayerBy(dx: number, dy: number): void {
    const p = this.player;
    if (!p) return;
    p.x += dx;
    p.y += dy;
    if (this.locked) {
      this.pinX += dx;
      this.pinY += dy;
    }
    this.syncBody();
  }

  setPlayerPosition(x: number, y: number): void {
    const p = this.player;
    if (!p) return;
    // Callers pass the hurtbox center; keep the body-to-sprite offset.
    const box = this.probe;
    if (!this.readPlayerBox(box)) return;
    p.x += x - box.x;
    p.y += y - box.y;
    if (this.locked) {
      this.pinX = p.x;
      this.pinY = p.y;
    }
    this.syncBody();
  }

  private syncBody(): void {
    const body = this.player?.body;
    if (body && typeof body.updateFromGameObject === "function") body.updateFromGameObject();
  }

  setPlayerHop(height: number): void {
    this.hop = Math.max(0, height);
  }

  /**
   * Draws the player `hop` pixels higher until the next frame's physics: the sprite (and its
   * animation overlay) moves up and back, the camera's follow offset moves with it so the view stays
   * still, and a shadow stays on the ground at the body's feet.
   */
  private applyHop(): void {
    const p = this.player;
    const cam = this.scene?.cameras?.main;
    const follows = !!cam && cam._follow === p && cam.followOffset && typeof cam.followOffset.y === "number";
    if (this.hop <= 0 || !p) {
      this.hopShadow?.clear?.();
      if (follows && this.followBase !== null) cam.followOffset.y = this.followBase;
      this.followBase = null;
      return;
    }
    p.y -= this.hop;
    this.hopApplied = this.hop;
    for (const img of this.overlayImgs) if (img.visible) img.y -= this.hop;
    if (follows) {
      this.followBase ??= cam.followOffset.y;
      cam.followOffset.y = this.followBase! - this.hop;
    }
    this.hopShadow ??= this.scene.add?.graphics?.() ?? null;
    const g = this.hopShadow;
    if (!g) return;
    const feet = typeof p.body?.bottom === "number" ? p.body.bottom : p.y + this.hop;
    const w = Math.max(6, (p.body?.width ?? 10) * 0.9);
    g.clear();
    g.fillStyle(0x000000, 0.3);
    g.fillEllipse(p.x, feet - 1, w * (1 - this.hop / 40), 4);
    g.setDepth?.((p.depth ?? 0) - 0.02);
  }

  private restoreHop(): void {
    if (!this.hopApplied) return;
    const p = this.player;
    if (p) p.y += this.hopApplied;
    for (const img of this.overlayImgs) if (img.visible) img.y += this.hopApplied;
    this.hopApplied = 0;
  }

  /** Walking speed of PS Maker's player (Player.getSpeed / setSpeed) times `factor`; 1 sets the player's own speed back. */
  setPlayerSpeedFactor(factor: number): void {
    const p = this.player;
    if (typeof p?.getSpeed !== "function" || typeof p.setSpeed !== "function") return;
    if (factor === 1) {
      if (this.baseSpeed !== null) p.setSpeed(this.baseSpeed);
      this.baseSpeed = null;
      return;
    }
    this.baseSpeed ??= p.getSpeed();
    p.setSpeed(this.baseSpeed! * factor);
  }

  setPlayerLocked(locked: boolean): void {
    if (locked && !this.locked && this.player) {
      this.pinX = this.player.x;
      this.pinY = this.player.y;
    }
    this.locked = locked;
  }

  /** Cancels PS Maker's own movement for this frame while locked. */
  private enforceLock(): void {
    if (!this.locked || !this.player) return;
    const p = this.player;
    p.x = this.pinX;
    p.y = this.pinY;
    p.body?.velocity?.set?.(0, 0);
    this.syncBody();
  }

  setPlayerBlink(visible: boolean): void {
    const p = this.player;
    if (!p?.setVisible) return;
    if (!visible) {
      if (p.visible !== false) {
        p.setVisible(false);
        this.hiddenByUs = true;
      }
    } else if (this.hiddenByUs) {
      p.setVisible(true);
      this.hiddenByUs = false;
    }
  }

  setPlayerTint(color: number | null): void {
    const p = this.player;
    if (!p?.setTint) return;
    if (color === null) {
      if (this.tintedByUs) p.clearTint?.();
      this.tintedByUs = false;
    } else {
      p.setTint(color);
      this.tintedByUs = true;
    }
  }

  /**
   * Depth for a toolkit object at `y`. In "auto" mode the toolkit detects
   * whether PS Maker y-sorts characters (player depth == player y) and either
   * uses y as well, or stays on the player's layer with a tiny y offset, so
   * objects are never hidden under map layers.
   */
  depthFor(y: number, layer: number): number {
    const w = this.cfg.world;
    if (w.depthMode === "fixed") return w.depthBase + layer;
    if (w.depthMode === "y" || this.ySorted) return w.depthBase + y + layer;
    return this.playerDepth + (y - this.playerY) * 0.001 + layer * 0.0001;
  }

  sheetFrame(sheet: string, frame: number): { key: string; frame: string } | null {
    const def = this.cfg.sprites.sheets[sheet];
    if (!def) {
      this.logger.warnOnce(`sheet-${sheet}`, `Sprite sheet "${sheet}" is not defined (Zelda: Define Sprite Sheet).`);
      return null;
    }
    return this.sheets.frame(sheet, def, frame);
  }

  readPlayerVisual(out: AABB): boolean {
    const p = this.player;
    if (!p || p.active === false || typeof p.x !== "number") return false;
    const w = p.displayWidth ?? p.width ?? 16;
    const h = p.displayHeight ?? p.height ?? 16;
    const ox = typeof p.originX === "number" ? p.originX : 0.5;
    const oy = typeof p.originY === "number" ? p.originY : 0.5;
    out.x = p.x + (0.5 - ox) * w;
    out.y = p.y + (0.5 - oy) * h;
    out.hw = w / 2;
    out.hh = h / 2;
    return true;
  }

  /**
   * Toolkit solids as Arcade static bodies colliding with the PS Maker player. Without them PS
   * Maker moved the player into a block each rendered frame and the toolkit pushed it back on its
   * own 60 Hz ticks; on faster screens the player (and the camera following it) shook.
   */
  syncSolids(boxes: readonly AABB[]): void {
    const physics = this.scene?.physics;
    const p = this.player;
    if (!this.cfg.world.solidBodies || !physics?.add?.staticGroup || !physics.add.collider || !p?.body || !this.scene.add?.zone) return;
    if (this.solidColliderPlayer !== p) {
      this.solidCollider?.destroy?.();
      this.solidGroup ??= physics.add.staticGroup();
      this.solidCollider = physics.add.collider(p, this.solidGroup);
      this.solidColliderPlayer = p;
    }
    let sig = "";
    for (const b of boxes) sig += `${Math.round(b.x * 4)},${Math.round(b.y * 4)},${Math.round(b.hw * 4)},${Math.round(b.hh * 4)};`;
    if (sig === this.solidSig) return;
    this.solidSig = sig;
    boxes.forEach((b, i) => {
      let z = this.solidZones[i];
      if (!z) {
        z = this.scene.add.zone(b.x, b.y, b.hw * 2, b.hh * 2);
        z.zmtSolid = true;
        this.solidGroup.add(z);
        this.solidZones.push(z);
      }
      z.setPosition(b.x, b.y);
      z.setSize(b.hw * 2, b.hh * 2);
      z.body.enable = true;
      z.body.updateFromGameObject();
    });
    for (let i = boxes.length; i < this.solidZones.length; i++) this.solidZones[i].body.enable = false;
  }

  textureSize(sprite: string): { w: number; h: number } | null {
    const tex = this.scene?.textures;
    const key = spriteKey(sprite);
    if (!tex?.exists?.(key)) return null;
    const frame = tex.getFrame?.(key, spriteFrame(sprite));
    return frame && frame.width > 0 ? { w: frame.width, h: frame.height } : null;
  }

  readPlayerTouching(): { up: boolean; down: boolean; left: boolean; right: boolean } | null {
    const t = this.player?.body?.touching;
    return t ? { up: !!t.up, down: !!t.down, left: !!t.left, right: !!t.right } : null;
  }

  private readonly opaqueTops = new Map<string, number | null>();

  /**
   * World y of the highest drawn pixel of the player's current frame (the head). PS Maker
   * character frames (e.g. 64x64) have empty space above the head, so the sprite bounds are too
   * high. Rows are scanned once per frame and cached; null when the image cannot be read.
   */
  readPlayerTop(): number | null {
    const p = this.player;
    const f = p?.frame;
    if (!p || !f?.texture || typeof p.y !== "number") return null;
    const key = `${f.texture.key}|${f.name}`;
    let row = this.opaqueTops.get(key);
    if (row === undefined) {
      row = opaqueTopRow(f);
      if (this.opaqueTops.size > 256) this.opaqueTops.clear();
      this.opaqueTops.set(key, row);
    }
    if (row === null) return null;
    const scaleY = Math.abs(p.scaleY ?? 1);
    const top = p.y - (p.displayOriginY ?? (p.originY ?? 0.5) * (f.height ?? 0)) * scaleY;
    return top + row * scaleY;
  }

  /** Overlay images copy the player's transform each frame; layers behind use a lower depth. */
  setPlayerOverlay(layers: OverlayLayer[] | null): void {
    const p = this.player;
    if (!layers || layers.length === 0 || !p) {
      for (const img of this.overlayImgs) img.setVisible(false);
      if (this.overlayHidPlayer && p) p.setAlpha?.(this.savedAlpha);
      this.overlayHidPlayer = false;
      return;
    }
    while (this.overlayImgs.length < layers.length) this.overlayImgs.push(this.scene.add.image(0, 0, resolveTexture(this.scene.textures, "pixel")));
    const sp = this.cfg.player.sprites;
    let shown = 0;
    layers.forEach((layer, i) => {
      const img = this.overlayImgs[i];
      const ref = this.sheetFrame(layer.sheet, layer.frame);
      if (!ref) {
        img.setVisible(false);
        return;
      }
      img.setTexture(ref.key, ref.frame);
      img.setOrigin(p.originX ?? 0.5, p.originY ?? 0.5);
      img.setScale(p.scaleX ?? 1, p.scaleY ?? 1);
      img.setPosition(p.x + sp.offsetX, p.y + sp.offsetY);
      img.setFlipX(layer.flipX);
      img.setDepth((p.depth ?? 0) + (layer.behind ? -0.01 : 0.01) + i * 0.001);
      img.setVisible(!this.hiddenByUs && p.visible !== false);
      shown++;
    });
    for (let i = layers.length; i < this.overlayImgs.length; i++) this.overlayImgs[i].setVisible(false);
    if (shown > 0 && sp.hidePlayer && !this.overlayHidPlayer) {
      this.savedAlpha = typeof p.alpha === "number" ? p.alpha : 1;
      p.setAlpha?.(0);
      this.overlayHidPlayer = true;
    }
  }

  private readonly soundKeys = new Map<string, string>();
  private readonly soundLoading = new Set<string>();

  /**
   * Plays an audio key already in Phaser's cache (PS Maker assets) or loads a
   * URL once and plays it when ready. Unknown sources are reported once.
   */
  playSound(src: string, raw: number): void {
    const sound = this.scene?.sound;
    const cache = this.scene?.cache?.audio;
    if (!sound || !src) return;
    // The "Sound Volume" slider of PS Maker's options menu (PlayerAudioSettings), as PS Maker's own sounds.
    const scaled = this.game?.audioSettings?.scaleSoundVolume?.(raw);
    const volume = typeof scaled === "number" && Number.isFinite(scaled) ? scaled : raw;
    try {
      if (cache?.exists?.(src)) {
        sound.play(src, { volume });
        return;
      }
      let key = this.soundKeys.get(src);
      if (!key) {
        key = `zmt_snd_${this.soundKeys.size}`;
        this.soundKeys.set(src, key);
      }
      if (cache?.exists?.(key)) {
        sound.play(key, { volume });
        return;
      }
      if (!/^(data:|blob:|https?:|\/|\.{0,2}\/)|\.(ogg|mp3|wav|m4a|webm)(\?.*)?$/i.test(src)) {
        this.logger.warnOnce(`snd-${src}`, `Sound "${src}" is neither a loaded audio key nor an audio URL.`);
        return;
      }
      if (this.soundLoading.has(key)) return;
      const loader = this.scene.load;
      this.soundLoading.add(key);
      const k = key;
      loader.once(`filecomplete-audio-${k}`, () => {
        this.soundLoading.delete(k);
        if (!this.disposed) sound.play(k, { volume });
      });
      loader.audio(k, src);
      if (!loader.isLoading?.()) loader.start();
    } catch (err) {
      this.logger.warnOnce(`snd-err-${src}`, `Could not play sound "${src}":`, err);
    }
  }

  /** PS Maker's map zoom (GameMap.CAMERA_ZOOM: map.zoom or gameConfig.zoom), else the camera's. */
  /** Runs one of PS Maker's own actions on this map's story runner (as runStoryEvent). */
  runBuiltInAction(action: { type: string; [k: string]: unknown }): Promise<unknown> | null {
    const runner = this.scene?.storyRunner;
    if (!runner || typeof runner.playActions !== "function") return null;
    const full = { id: `zmt-${action.type}-${++this.dialogueSeq}`, name: action.type, ...action };
    try {
      return Promise.resolve(runner.playActions([full])).catch((err: unknown) => this.logger.warn(`PS Maker action "${action.type}" failed:`, err));
    } catch (err) {
      this.logger.warn(`PS Maker action "${action.type}" failed:`, err);
      return null;
    }
  }

  /**
   * The player's volumes as PS Maker's options menu shows and sets them (OptionsMenuRenderer.svelte):
   * `game.audioSettings.musicVolumePercent` / `soundVolumePercent` (PlayerAudioSettings, kept in
   * the browser by PS Maker), set through `game.musicManager.setPlayerMusicVolume` (the music
   * playing now follows) and `game.audioSettings.setSoundVolume`.
   */
  audioVolumes(): { music: number; sound: number } | null {
    const a = this.game?.audioSettings;
    if (!a || typeof a.musicVolumePercent !== "number" || typeof a.soundVolumePercent !== "number") return null;
    return { music: a.musicVolumePercent, sound: a.soundVolumePercent };
  }

  setAudioVolume(channel: "music" | "sound", percent: number): boolean {
    const g = this.game;
    const v = Math.max(0, Math.min(100, Math.round(percent)));
    if (channel === "music" && typeof g?.musicManager?.setPlayerMusicVolume === "function") g.musicManager.setPlayerMusicVolume(v);
    else if (channel === "music" && typeof g?.audioSettings?.setMusicVolume === "function") g.audioSettings.setMusicVolume(v);
    else if (channel === "sound" && typeof g?.audioSettings?.setSoundVolume === "function") g.audioSettings.setSoundVolume(v);
    else return false;
    return true;
  }

  /** PS Maker's fullscreen is the page's (utils/fullscreen.ts: document.fullscreenElement). */
  isFullscreen(): boolean {
    return !!(globalThis as { document?: { fullscreenElement?: unknown } }).document?.fullscreenElement;
  }

  /**
   * PS Maker draws its options button (the gear, SystemMenusOverlay.svelte: button.open-options-button)
   * while Game UI → Options menu → "Options button in game" is ticked. With the toolkit's own
   * settings screen it would open the options menu that screen replaces, so it is hidden by a style
   * rule on the page (the project's setting is not changed).
   */
  hideOptionsButton(hidden: boolean): void {
    const doc = (globalThis as { document?: any }).document;
    if (!doc?.head || !doc.createElement) return;
    const id = "zelda-maker-toolkit-hide-options-button";
    const el = doc.getElementById?.(id);
    if (hidden && !el) {
      const style = doc.createElement("style");
      style.id = id;
      style.textContent = "button.open-options-button { display: none !important; }";
      doc.head.appendChild(style);
    } else if (!hidden && el) el.remove();
  }

  mapZoom(): number {
    const z = Number(this.scene?.CAMERA_ZOOM ?? this.scene?.cameras?.main?.zoom ?? 0);
    return Number.isFinite(z) && z > 0 ? z : 0;
  }

  private dialogueSeq = 0;

  /**
   * Runs a PS Maker "Dialogue" action on this map's story runner (GameMap.storyRunner.playActions,
   * as the map runs its own events; StoryRunner.ts). The promise resolves when the dialogue ends.
   */
  playDialogue(source: string): Promise<void> | null {
    const runner = this.scene?.storyRunner;
    if (!runner || typeof runner.playActions !== "function") return null;
    const action = { id: `zmt-message-${++this.dialogueSeq}`, name: "Dialogue", type: "dialogueAction", dialogueSource: source };
    try {
      return Promise.resolve(runner.playActions([action])).then(
        () => undefined,
        (err: unknown) => this.logger.warn("PS Maker Dialogue for a toolkit message failed:", err),
      );
    } catch (err) {
      this.logger.warn("PS Maker Dialogue for a toolkit message failed:", err);
      return null;
    }
  }

  /**
   * Runs a PS Maker event by id through PS Maker's own "Run event" action (runStoryEventAction:
   * it finds the event among the project's and this map's and plays its actions on the map's story
   * runner). False when the map has no story runner.
   */
  runStoryEvent(eventId: string): Promise<unknown> | null {
    const runner = this.scene?.storyRunner;
    if (!eventId || !runner || typeof runner.playActions !== "function") return null;
    const action = { id: `zmt-run-${++this.dialogueSeq}`, name: "Run event", type: "runStoryEventAction", storyEventId: eventId, loopMode: "none", waitForCompletion: true };
    try {
      return Promise.resolve(runner.playActions([action])).catch((err: unknown) => this.logger.warn(`PS Maker event "${eventId}" failed:`, err));
    } catch (err) {
      this.logger.warn(`PS Maker event "${eventId}" failed:`, err);
      return null;
    }
  }

  loadProjectFont(fontId: string): void {
    if (!fontId || !this.scene?.textures) return;
    const story = this.psMakerStory();
    void ensureProjectFont(story, this.scene.textures, fontId).then((family) => {
      // Texts drawn before the font arrived were drawn in the fallback font.
      if (family && !this.disposed) this.hud?.redraw?.();
      if (!family) this.logger.warnOnce(`font-${fontId}`, `Font "${fontId}" could not be loaded by the toolkit; PS Maker loads it when it first shows its own text with it.`);
    });
  }

  /** The project data of the map scene (GameMap.story). */
  psMakerStory(): PsStory | null {
    return storyOfScene(this.scene);
  }


  /** PS Maker project variables (game.variables: get(id) → { type, value }, set(id, value)). */
  getVariable(id: string): string | number | boolean | undefined {
    return this.game?.variables?.get?.(id)?.value;
  }

  setVariable(id: string, value: string | number | boolean): boolean {
    const vars = this.game?.variables;
    const v = vars?.get?.(id);
    if (!v || typeof vars.set !== "function") return false;
    const typed = v.type === "boolean" ? (typeof value === "boolean" ? value : Number(value) !== 0 && value !== "false" && value !== "") : v.type === "number" ? (typeof value === "boolean" ? (value ? 1 : 0) : Number(value) || 0) : String(value);
    vars.set(id, typed);
    return true;
  }

  /**
   * PS Maker opens its options menu on Escape from a window keydown listener (SystemMenusOverlay)
   * that skips events whose default was prevented, as Phaser's keyboard does. A capture listener
   * on the window runs before both: when the toolkit wants the Menu key, it prevents the default and
   * hands the press to the toolkit's input itself. While PS Maker pauses the game (its menus are
   * open) the key stays theirs.
   */
  claimMenuKeys(wants: () => boolean): () => void {
    const win = globalThis as unknown as { addEventListener?: (t: string, f: (e: KeyboardEvent) => void, c: boolean) => void; removeEventListener?: (t: string, f: (e: KeyboardEvent) => void, c: boolean) => void };
    if (typeof win.addEventListener !== "function") return () => {};
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || this.disposed || this.game?.isPaused) return;
      const target = e.target as { isContentEditable?: boolean; matches?: (q: string) => boolean } | null;
      if (target?.isContentEditable || target?.matches?.("input, textarea, select")) return;
      if (!this.input.isBound(e.code, "menu") || !wants()) return;
      e.preventDefault();
      this.input.inject(e);
    };
    win.addEventListener("keydown", onKey, true);
    return () => win.removeEventListener?.("keydown", onKey, true);
  }

  /** True while a PS Maker dialogue is on screen (GameMap.playingDialogue). */
  isDialogueOpen(): boolean {
    return this.scene?.playingDialogue === true;
  }

  /** Columns of a PS Maker sheet's loaded texture (frame numbering follows the image width). */
  psMakerSheetColumns(sheet: PsSheet): number | null {
    const key = this.psMakerSheetImage(sheet);
    const textures = this.scene?.textures;
    let width: unknown;
    try {
      width = key && textures?.exists(key) ? textures.get?.(key)?.source?.[0]?.width : undefined;
    } catch {
      width = undefined;
    }
    return typeof width === "number" && width > 0 && sheet.frameWidth > 0 ? Math.floor(width / sheet.frameWidth) : null;
  }

  /** Texture key or URL of a PS Maker sheet (see psmakerAssets.sheetImage). */
  psMakerSheetImage(sheet: PsSheet): string | null {
    return this.scene?.textures ? sheetImage(this.scene.textures, sheet) : null;
  }

  describe(): string[] {
    const s = this.scene;
    const p = this.player;
    const cam = s?.cameras?.main;
    const n = (v: unknown) => (typeof v === "number" ? Math.round(v * 10) / 10 : "?");
    const lines = [
      `scene "${s?.sys?.settings?.key ?? "?"}"  camera scroll ${n(cam?.scrollX)},${n(cam?.scrollY)} zoom ${n(cam?.zoom)} view ${n(cam?.width)}x${n(cam?.height)}`,
      `player sprite ${n(p?.x)},${n(p?.y)} depth ${n(p?.depth)} size ${n(p?.displayWidth)}x${n(p?.displayHeight)} body ${p?.body ? `${n(p.body.x)},${n(p.body.y)} ${n(p.body.width)}x${n(p.body.height)}` : "none"}`,
      ((ps) => (ps ? `PS Maker data: scene.story (${ps.characters.length} characters, ${ps.spritesheetAnimations.length} sheets)` : "PS Maker data: none on the map scene (Character / PS Maker sheet fields unavailable)"))(this.psMakerStory()),
      `depth mode ${this.cfg.world.depthMode}${this.cfg.world.depthMode === "auto" ? (this.ySorted ? " (y-sorted)" : " (player layer)") : ""}; map colliders: ${this.staticPool.length} static bodies, ${this.npcCount} NPC bodies`,
    ];
    return lines;
  }

  beginTick(tick: number): void {
    const p = this.player;
    if (p && typeof p.depth === "number" && typeof p.y === "number") {
      this.playerDepth = p.depth;
      this.playerY = p.y;
      this.ySorted = Math.abs(p.depth - p.y) < 2 || Math.abs(p.depth - (p.body ? p.body.y + p.body.height : p.y)) < 2;
    }
    this.refreshNpcBodies();
    const world = this.scene?.physics?.world;
    const statics = world?.staticBodies;
    const size = statics ? (statics.size ?? statics.entries?.length ?? 0) : 0;
    if (tick % Math.max(1, this.cfg.world.collisionRefreshTicks) === 1 || size !== this.staticCount) this.refreshCollisionCache();
  }

  /**
   * Dynamic Arcade bodies other than the player (PS Maker NPCs). Adopted NPCs
   * have their body disabled and are skipped automatically.
   */
  private refreshNpcBodies(): void {
    this.npcCount = 0;
    if (!this.cfg.world.npcsBlock) return;
    const bodies = this.scene?.physics?.world?.bodies;
    if (!bodies) return;
    const list: any[] = bodies.entries ?? Array.from(bodies as Iterable<any>);
    for (const body of list) {
      if (!body || body.enable === false || body.gameObject === this.player || !(body.width > 0)) continue;
      let b = this.npcBoxes[this.npcCount];
      if (!b) {
        b = makeBox();
        this.npcBoxes.push(b);
      }
      b.x = body.x + body.width / 2;
      b.y = body.y + body.height / 2;
      b.hw = body.width / 2;
      b.hh = body.height / 2;
      this.npcCount++;
    }
  }

  private refreshCollisionCache(): void {
    this.staticIndex.clear();
    this.staticPool.length = 0;
    const world = this.scene?.physics?.world;
    const statics = world?.staticBodies;
    let count = 0;
    if (this.cfg.world.useArcadeStaticBodies && statics) {
      const list: any[] = statics.entries ?? Array.from(statics as Iterable<any>);
      for (const body of list) {
        if (!body || body.enable === false || body.gameObject === this.player || body.gameObject?.zmtSolid) continue;
        const sb: StaticBox = { x: body.x + body.width / 2, y: body.y + body.height / 2, hw: body.width / 2, hh: body.height / 2, body };
        this.staticPool.push(sb);
        this.staticIndex.insert(sb);
        count++;
      }
    }
    this.staticCount = statics ? (statics.size ?? statics.entries?.length ?? 0) : 0;
    // PS Maker's map collisions are static Arcade bodies (GameMapCollision); its tiles never collide.
    if (count === 0) {
      this.logger.warnOnce("no-map-collision", "No Arcade static bodies found: enemies and projectiles only collide with toolkit objects on this map.");
    }
  }

  mapWalls(): readonly AABB[] {
    return this.staticPool;
  }

  isMapBlocked(box: AABB): boolean {
    const c = this.candidates;
    c.length = 0;
    this.staticIndex.query(box, c);
    for (let i = 0; i < c.length; i++) {
      const sb = c[i];
      if (sb.body.enable === false || sb.body.gameObject?.zmtSolid) continue;
      if (overlaps(sb, box)) {
        c.length = 0;
        return true;
      }
    }
    c.length = 0;
    for (let i = 0; i < this.npcCount; i++) if (overlaps(this.npcBoxes[i], box)) return true;
    return false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const events = this.scene?.events;
    if (events && this.frameListener) events.off("postupdate", this.frameListener);
    if (events && this.preUpdateListener) events.off("preupdate", this.preUpdateListener);
    this.restoreHop();
    this.hop = 0;
    this.applyHop();
    this.hopShadow?.destroy?.();
    this.hopShadow = null;
    this.setPlayerSpeedFactor(1);
    if (events && this.shutdownListener) {
      events.off("shutdown", this.shutdownListener);
      events.off("destroy", this.shutdownListener);
    }
    this.frameListener = null;
    this.shutdownListener = null;
    this.pads.releaseAll();
    const win = globalThis as unknown as { removeEventListener?: (t: string, f: (e: KeyboardEvent) => void, c: boolean) => void };
    if (this.gameKeysListening) {
      win.removeEventListener?.("keydown", this.onGameKey, true);
      win.removeEventListener?.("keyup", this.onGameKey, true);
      this.gameKeysListening = false;
    }
    this.input.dispose();
    this.setPlayerOverlay(null);
    for (const img of this.overlayImgs) img.destroy();
    this.overlayImgs = [];
    this.locked = false;
    this.setPlayerBlink(true);
    this.setPlayerTint(null);
    this.debug?.dispose();
    this.hud?.setVisible(false);
    this.staticIndex.clear();
    this.staticPool.length = 0;
    this.solidCollider?.destroy?.();
    for (const z of this.solidZones) z.destroy?.();
    this.solidZones.length = 0;
    this.solidGroup?.destroy?.();
    this.solidGroup = null;
    this.solidCollider = null;
    this.solidColliderPlayer = null;
  }
}

/** The `key` value a real key event carries for a code (letters, digits, the named keys). */
function keyOfCode(code: string): string {
  const m = /^(?:Key|Digit)(.)$/.exec(code);
  if (m) return m[1].toLowerCase();
  const named: Record<string, string> = { Space: " ", Escape: "Escape", Enter: "Enter", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Tab: "Tab", Backspace: "Backspace" };
  return named[code] ?? code;
}

