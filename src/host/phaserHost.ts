import type { ToolkitConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { type AABB, type Facing, makeBox, overlaps } from "../core/math.ts";
import { SpatialHash } from "../core/spatialHash.ts";
import type { DebugDraw, EntityView, HostAdapter, HudSink, Renderer, ViewSpec } from "./types.ts";
import { KeyboardInput, type GamepadLike } from "./keyboardInput.ts";
import { resolveTexture } from "./textures.ts";
import { getHud } from "./phaserHud.ts";

/**
 * The PS Maker plugin context, typed only as far as the toolkit uses it.
 * (`@ps-maker/plugin-api` declares scene/player as `any`.)
 */
export interface PluginContextLike {
  game: any;
  scene: any;
  player: any;
}

const OVERLAY_DEPTH = 100000;
const DEBUG_DEPTH = 200000;

interface StaticBox extends AABB {
  body: any;
}

/** A Phaser Image owned by the toolkit. */
class ImageView implements EntityView {
  private readonly scene: any;
  private readonly img: any;
  private readonly spec: ViewSpec;
  private readonly cfg: ToolkitConfig;
  private sprite: string;

  constructor(scene: any, cfg: ToolkitConfig, spec: ViewSpec, textureKey: string) {
    this.scene = scene;
    this.cfg = cfg;
    this.spec = spec;
    this.sprite = spec.sprite;
    this.img = scene.add.image(0, 0, textureKey);
    this.fitSize();
    if (spec.tint !== undefined) this.img.setTint(spec.tint);
    if (spec.overlay) this.img.setDepth(OVERLAY_DEPTH);
  }

  private fitSize(): void {
    // Author textures (from PS Maker image params) are scaled to the entity size.
    const key: string = this.img.texture?.key ?? "";
    if (!key.startsWith("zmt_") && this.spec.width && this.spec.height) this.img.setDisplaySize(this.spec.width, this.spec.height);
  }

  setPosition(x: number, y: number): void {
    this.img.setPosition(x, y);
    if (this.spec.overlay) return;
    const w = this.cfg.world;
    this.img.setDepth(w.depthMode === "y" ? w.depthBase + y + (this.spec.layer ?? 0) : w.depthBase + (this.spec.layer ?? 0));
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
    if (sprite === this.sprite) return;
    const key = resolveTexture(this.scene.textures, sprite);
    if (!key) return;
    this.sprite = sprite;
    this.img.setTexture(key);
    this.fitSize();
  }
  setRotation(r: number): void {
    this.img.setRotation(r);
  }
  setScale(s: number): void {
    this.img.setScale(s);
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
export class PhaserHost implements HostAdapter {
  readonly input: KeyboardInput;
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
  private tilemapLayers: any[] = [];
  private readonly candidates: StaticBox[] = [];
  private frameListener: ((time: number, delta: number) => void) | null = null;
  private shutdownListener: (() => void) | null = null;
  private disposed = false;
  private readonly probe = makeBox();

  constructor(ctx: PluginContextLike, cfg: ToolkitConfig, logger: Logger) {
    this.scene = ctx.scene;
    this.game = ctx.game ?? ctx.scene?.game;
    this.player = ctx.player;
    this.cfg = cfg;
    this.logger = logger;
    const keyboard = this.scene?.input?.keyboard ?? null;
    if (!keyboard) logger.warn("Phaser keyboard plugin not available on the map scene: toolkit controls are disabled.");
    this.input = new KeyboardInput(cfg, keyboard, this.game?.events ?? null, () => this.readPad());
    const scene = this.scene;
    this.renderer = {
      createView: (spec: ViewSpec): EntityView => {
        if (spec.adopt && typeof spec.adopt === "object") return new AdoptedView(spec.adopt);
        let key = resolveTexture(scene.textures, spec.sprite);
        if (!key) {
          logger.warnOnce(`tex-${spec.sprite}`, `Sprite "${spec.sprite}" is neither a loaded texture nor a built-in sprite; using a placeholder.`);
          key = resolveTexture(scene.textures, "icon_generic")!;
        }
        return new ImageView(scene, cfg, spec, key);
      },
    };
    this.hud = this.game?.scene ? getHud(this.game, cfg, logger) : null;
    this.debug = scene?.add ? new PhaserDebug(scene, cfg, logger) : null;
  }

  /** Hooks the per-frame callback and scene shutdown. */
  attach(onFrame: (deltaMs: number) => void, onShutdown: () => void): void {
    const events = this.scene?.events;
    if (!events) throw new Error("Map scene has no event emitter; cannot attach the toolkit.");
    this.frameListener = (_time: number, delta: number) => {
      this.enforceLock();
      onFrame(delta);
    };
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

  private readPad(): GamepadLike | null {
    const gp = this.scene?.input?.gamepad;
    if (!gp || !gp.total) return null;
    return gp.pad1 ?? gp.getPad?.(0) ?? null;
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

  beginTick(tick: number): void {
    const world = this.scene?.physics?.world;
    const statics = world?.staticBodies;
    const size = statics ? (statics.size ?? statics.entries?.length ?? 0) : 0;
    if (tick % Math.max(1, this.cfg.world.collisionRefreshTicks) === 1 || size !== this.staticCount) this.refreshCollisionCache();
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
        if (!body || body.enable === false || body.gameObject === this.player) continue;
        const sb: StaticBox = { x: body.x + body.width / 2, y: body.y + body.height / 2, hw: body.width / 2, hh: body.height / 2, body };
        this.staticPool.push(sb);
        this.staticIndex.insert(sb);
        count++;
      }
    }
    this.staticCount = statics ? (statics.size ?? statics.entries?.length ?? 0) : 0;
    this.tilemapLayers = [];
    if (this.cfg.world.useTilemapLayers) {
      const children: any[] = this.scene?.children?.list ?? [];
      for (const c of children) if (c && typeof c.getTilesWithinWorldXY === "function") this.tilemapLayers.push(c);
    }
    if (count === 0 && this.tilemapLayers.length === 0) {
      this.logger.warnOnce("no-map-collision", "No Arcade static bodies or tilemap layers found: enemies and projectiles only collide with toolkit objects on this map.");
    }
  }

  isMapBlocked(box: AABB): boolean {
    const c = this.candidates;
    c.length = 0;
    this.staticIndex.query(box, c);
    for (let i = 0; i < c.length; i++) {
      const sb = c[i];
      if (sb.body.enable === false) continue;
      if (overlaps(sb, box)) {
        c.length = 0;
        return true;
      }
    }
    c.length = 0;
    for (const layer of this.tilemapLayers) {
      if (!layer.active) continue;
      const tiles = layer.getTilesWithinWorldXY(box.x - box.hw, box.y - box.hh, box.hw * 2, box.hh * 2, { isColliding: true });
      if (tiles && tiles.length > 0) return true;
    }
    return false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const events = this.scene?.events;
    if (events && this.frameListener) events.off("postupdate", this.frameListener);
    if (events && this.shutdownListener) {
      events.off("shutdown", this.shutdownListener);
      events.off("destroy", this.shutdownListener);
    }
    this.frameListener = null;
    this.shutdownListener = null;
    this.input.dispose();
    this.locked = false;
    this.setPlayerBlink(true);
    this.setPlayerTint(null);
    this.debug?.dispose();
    this.hud?.setVisible(false);
    this.staticIndex.clear();
    this.staticPool.length = 0;
    this.tilemapLayers = [];
  }
}
