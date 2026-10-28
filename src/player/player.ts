import type { Session, SessionSystem } from "../core/session.ts";
import type { Entity } from "../core/entity.ts";
import { type AABB, copyBox, type Facing, FACING_VECTORS, facingFromVector, isInFront, makeBox, normalize, penetration, type Vec2 } from "../core/math.ts";
import type { Damageable, DamageInfo, HitResult } from "../core/types.ts";
import { changeHealth, changeMagic } from "./health.ts";
import { buildOverlay, OVERLAY_PRIORITY } from "./overlay.ts";
import type { OverlayLayer } from "../host/types.ts";

export type PlayerState = "normal" | "dead";

const BLINK_PERIOD_MS = 66;
const HURT_TINT = 0xff4444;
const DEAD_TINT = 0x555577;
/** Shortest time a one-shot body animation (item, lift, throw) is shown. */
const POSE_MIN_MS = 250;
const ITEM_GET_MS = 1000;
const DEATH_ANIM_MS = 1000;
/**
 * Still counts as walking this long after the last step: PS Maker moves the player once per
 * rendered frame, so at a low frame rate some 60 Hz ticks see no movement.
 */
const WALK_GRACE_MS = 120;
/** Item ids with their own animation slot (others use `item`). */
const ITEM_SLOTS: Record<string, "bow" | "boomerang" | "bomb" | "hookshot"> = { bow: "bow", boomerang: "boomerang", bomb: "bomb", hookshot: "hookshot" };

/**
 * Wraps the PS Maker player Actor. Movement stays under PS Maker's control;
 * this system derives facing, applies knockback/locks, owns invulnerability,
 * shield blocking, death and respawn, and keeps the player out of toolkit solids.
 */
export class PlayerSystem implements SessionSystem, Damageable {
  readonly name = "player";
  readonly id = "player";
  readonly team = "player" as const;
  /** Full body box (movement, solids, interactions). */
  readonly box: AABB = makeBox(0, 0, 6, 6);
  /** Body box shrunk by `player.hurtboxInset`: what enemies and projectiles must touch. */
  readonly hurtbox: AABB = makeBox(0, 0, 4, 4);
  /** Displayed sprite bounds (falls back to the body when the host cannot tell). */
  readonly visual: AABB = makeBox(0, 0, 6, 6);
  /** Point weapons swing around: the sprite center plus `sword.pivotOffset`. */
  pivotX = 0;
  pivotY = 0;
  facing: Facing = "down";
  state: PlayerState = "normal";
  /** Set when a box was read this tick; false when the scene has no player. */
  present = false;
  facingLocked = false;
  /** The solid entity the player is walking into this tick (block pushing). */
  pushTarget: Entity | null = null;
  /** Set by interactions while standing on a hazard (prevents safe-point updates). */
  onHazard = false;
  lastSafeX = 0;
  lastSafeY = 0;

  private readonly s: Session;
  private prevX = 0;
  private prevY = 0;
  private hasPrev = false;
  private invulnMs = 0;
  private flashMs = 0;
  private knockMs = 0;
  private knockVX = 0;
  private knockVY = 0;
  private deadMs = 0;
  private magicAcc = 0;
  private startX = 0;
  private startY = 0;
  private readonly locks = new Set<string>();
  private readonly scratch: Entity[] = [];
  private readonly probe = makeBox();
  private readonly pen: Vec2 = { x: 0, y: 0 };
  private readonly tmp: Vec2 = { x: 0, y: 0 };
  private blinkHidden = false;
  private tinted = false;
  private overlayReq: { prio: number; layers: OverlayLayer[] } | null = null;
  private overlayShown = false;
  private hurtMs = -1;
  /** One-shot body animation (item use, lift, throw, item get) and its clock. */
  private pose: { anim: string; ms: number; durationMs: number; lock: boolean } | null = null;
  private deadAnimMs = 0;
  private clockMs = 0;
  private stillMs = WALK_GRACE_MS;
  /** Time spent walking (drives walk-like animations: carrying, charging). */
  walkMs = 0;
  private readonly offs: (() => void)[] = [];

  constructor(session: Session) {
    this.s = session;
    const sp = () => session.config.player.sprites;
    this.offs.push(
      session.bus.on("zelda:item:used", ({ itemId }) => {
        const slot = ITEM_SLOTS[itemId];
        const useMs = session.toolkit.items.get(itemId)?.useMs ?? 0;
        this.playPose((slot && sp()[slot]) || sp().item, Math.max(POSE_MIN_MS, useMs));
      }),
      session.bus.on("zelda:object:lifted", () => this.playPose(sp().lift, POSE_MIN_MS)),
      session.bus.on("zelda:object:thrown", () => this.playPose(sp().throw, POSE_MIN_MS)),
      session.bus.on("zelda:chest:opened", ({ itemId }) => {
        if (itemId) this.playPose(sp().itemGet, ITEM_GET_MS, true);
      }),
    );
  }

  /** The player moved this tick (PS Maker moved it). */
  get isMoving(): boolean {
    return this.stillMs < WALK_GRACE_MS;
  }

  /**
   * Shows a one-shot body animation for `durationMs` (frames spread over that time; the last one
   * is held). Empty or unknown animation ids do nothing. `lock` keeps the player still meanwhile.
   */
  playPose(anim: string, durationMs: number, lock = false): void {
    if (!anim || !this.s.config.sprites.animations[anim] || this.state === "dead") return;
    if (this.pose?.lock) this.unlock("pose");
    this.pose = { anim, ms: 0, durationMs, lock };
    if (lock) this.lock("pose");
  }

  private tickPose(dtMs: number): void {
    this.clockMs += dtMs;
    const pose = this.pose;
    if (!pose) return;
    pose.ms += dtMs;
    if (pose.ms < pose.durationMs) return;
    if (pose.lock) this.unlock("pose");
    this.pose = null;
  }

  get x(): number {
    return this.box.x;
  }
  get y(): number {
    return this.box.y;
  }
  get hw(): number {
    return this.hurtbox.hw;
  }
  get hh(): number {
    return this.hurtbox.hh;
  }

  get isDead(): boolean {
    return this.state === "dead";
  }

  get isInvulnerable(): boolean {
    return this.invulnMs > 0;
  }

  get isKnockedBack(): boolean {
    return this.knockMs > 0;
  }

  isHittable(): boolean {
    return this.present && this.state !== "dead" && this.invulnMs <= 0;
  }

  /** Records where the player stood when the toolkit started on this map. */
  captureStartPosition(): void {
    if (this.readBox()) {
      this.startX = this.box.x;
      this.startY = this.box.y;
      this.lastSafeX = this.box.x;
      this.lastSafeY = this.box.y;
    }
  }

  setRespawnPoint(x: number, y: number): void {
    this.s.state.player.respawn = { mapId: this.s.mapId, x, y };
  }

  lock(reason: string): void {
    this.locks.add(reason);
    this.s.host.setPlayerLocked(true);
  }

  unlock(reason: string): void {
    if (!this.locks.delete(reason)) return;
    if (this.locks.size === 0) this.s.host.setPlayerLocked(false);
  }

  isLocked(reason?: string): boolean {
    return reason ? this.locks.has(reason) : this.locks.size > 0;
  }

  private readBox(): boolean {
    this.present = this.s.host.readPlayerBox(this.box);
    if (this.present) this.syncHurtbox();
    return this.present;
  }

  /**
   * Systems ask for a sprite overlay each tick (attack 2 > hurt 1); the
   * highest priority wins and is sent to the host once per tick by
   * `flushOverlay`. No request = the PS Maker sprite is shown again.
   */
  requestOverlay(prio: number, layers: OverlayLayer[] | null): void {
    if (!layers) return;
    if (!this.overlayReq || prio >= this.overlayReq.prio) this.overlayReq = { prio, layers };
  }

  flushOverlay(): void {
    const cfg = this.s.config;
    const sp = cfg.player.sprites;
    if (this.state === "dead") {
      this.requestOverlay(OVERLAY_PRIORITY.death, buildOverlay(cfg, sp.death, "", this.facing, this.deadAnimMs, Math.min(DEATH_ANIM_MS, cfg.player.respawnDelayMs)));
    } else {
      if (this.pose) this.requestOverlay(this.pose.lock ? OVERLAY_PRIORITY.itemGet : OVERLAY_PRIORITY.action, buildOverlay(cfg, this.pose.anim, "", this.facing, this.pose.ms, this.pose.durationMs));
      if (this.hurtMs >= 0 && this.knockMs > 0) this.requestOverlay(OVERLAY_PRIORITY.hurt, buildOverlay(cfg, sp.hurt, "", this.facing, this.hurtMs));
      // Ongoing states: carrying (walks), pushing a block, holding the shield up.
      const pose = this.s.interactions?.isCarrying() ? sp.carry : this.s.interactions?.isPushing() ? sp.push : this.shieldRaised() ? sp.shield : "";
      if (pose) this.requestOverlay(OVERLAY_PRIORITY.pose, buildOverlay(cfg, pose, "", this.facing, pose === sp.push ? this.clockMs : this.isMoving ? this.walkMs : 0));
    }
    const req = this.overlayReq;
    this.overlayReq = null;
    if (req) {
      this.s.host.setPlayerOverlay(req.layers);
      this.overlayShown = true;
    } else if (this.overlayShown) {
      this.s.host.setPlayerOverlay(null);
      this.overlayShown = false;
    }
  }

  /** Refreshes the sprite bounds and the weapon pivot (call after the player moved). */
  syncVisual(): void {
    if (!this.s.host.readPlayerVisual(this.visual)) copyBox(this.visual, this.box);
    // Keep the pivot inside the body column horizontally: wide frames (64x64 sheets) are centered on the body anyway.
    this.pivotX = this.visual.x + this.s.config.sword.pivotOffsetX;
    this.pivotY = this.visual.y + this.s.config.sword.pivotOffsetY;
  }

  private syncHurtbox(): void {
    const inset = this.s.config.player.hurtboxInset;
    this.hurtbox.x = this.box.x;
    this.hurtbox.y = this.box.y;
    this.hurtbox.hw = Math.max(2, this.box.hw - inset);
    this.hurtbox.hh = Math.max(2, this.box.hh - inset);
  }

  tick(dtMs: number): void {
    this.pushTarget = null;
    if (!this.readBox()) return;

    // Health can reach zero from scripts (Change Player Health) as well as hits.
    if (this.state === "normal" && this.s.state.player.hp <= 0) this.die();
    if (this.state === "dead") {
      this.deadAnimMs += dtMs;
      this.tickDead(dtMs);
      return;
    }

    const stepped = this.hasPrev && Math.abs(this.box.x - this.prevX) + Math.abs(this.box.y - this.prevY) > 0.05;
    this.stillMs = stepped ? 0 : this.stillMs + dtMs;
    if (this.isMoving) this.walkMs += dtMs;
    this.tickPose(dtMs);
    this.updateFacing();
    this.applyKnockback(dtMs);
    this.syncSolidBodies();
    this.resolveSolids();
    this.detectLeaning();
    this.updateTimers(dtMs);
    this.regenMagic(dtMs);
    this.syncHurtbox();
    this.syncVisual();
    this.prevX = this.box.x;
    this.prevY = this.box.y;
    this.hasPrev = true;
  }

  private updateFacing(): void {
    if (this.facingLocked) return;
    const hint = this.s.host.readPlayerFacingHint(this.facing);
    if (hint) {
      this.facing = hint;
      return;
    }
    if (!this.hasPrev || this.knockMs > 0) return;
    this.facing = facingFromVector(this.box.x - this.prevX, this.box.y - this.prevY, this.facing);
  }

  private applyKnockback(dtMs: number): void {
    if (this.hurtMs >= 0) this.hurtMs += dtMs;
    if (this.knockMs <= 0) {
      this.hurtMs = -1;
      return;
    }
    const step = Math.min(dtMs, this.knockMs) / 1000;
    this.knockMs -= dtMs;
    this.moveWithCollision(this.knockVX * step, this.knockVY * step);
    if (this.knockMs <= 0) this.unlock("knockback");
  }

  /** Moves the player sprite, sliding along toolkit solids and map collision. */
  moveWithCollision(dx: number, dy: number): void {
    const p = this.probe;
    p.hw = this.box.hw;
    p.hh = this.box.hh;
    let mx = 0;
    let my = 0;
    if (dx !== 0) {
      p.x = this.box.x + dx;
      p.y = this.box.y;
      if (!this.s.world.isBlocked(p, null)) mx = dx;
    }
    if (dy !== 0) {
      p.x = this.box.x + mx;
      p.y = this.box.y + dy;
      if (!this.s.world.isBlocked(p, null)) my = dy;
    }
    if (mx !== 0 || my !== 0) {
      this.box.x += mx;
      this.box.y += my;
      this.s.host.movePlayerBy(mx, my);
    }
  }

  private readonly solidBoxes: AABB[] = [];

  /** Hands the toolkit's solid objects to the host physics (they then stop the player there). */
  private syncSolidBodies(): void {
    if (!this.s.host.syncSolids) return;
    const list = this.solidBoxes;
    list.length = 0;
    for (const e of this.s.world.list("object")) if (e.solid && !e.removed) list.push(e);
    this.s.host.syncSolids(list);
  }

  /**
   * With solids in the engine's physics the player stops at a block instead of entering it, so
   * "walking into it" (pushing, unlocking a door) is the physics touching flag on the facing side.
   */
  private detectLeaning(): void {
    if (this.pushTarget) return;
    const touching = this.s.host.readPlayerTouching?.();
    if (!touching?.[this.facing]) return;
    const v = FACING_VECTORS[this.facing];
    const probe = this.probe;
    probe.x = this.box.x + v.x * 2;
    probe.y = this.box.y + v.y * 2;
    probe.hw = this.box.hw;
    probe.hh = this.box.hh;
    const found = this.scratch;
    found.length = 0;
    this.s.world.query(probe, found, (e) => e.solid && e.kind === "object");
    this.pushTarget = found[0] ?? null;
    found.length = 0;
  }

  /** Pushes the player out of toolkit solids (doors, blocks, rocks, chests). */
  private resolveSolids(): void {
    const found = this.scratch;
    found.length = 0;
    this.s.world.query(this.box, found, (e) => e.solid);
    if (found.length === 0) return;
    const fv = FACING_VECTORS[this.facing];
    let tx = 0;
    let ty = 0;
    for (let i = 0; i < found.length; i++) {
      const e = found[i];
      if (!penetration(this.box, e, this.pen)) continue;
      this.box.x += this.pen.x;
      this.box.y += this.pen.y;
      tx += this.pen.x;
      ty += this.pen.y;
      // Being pushed back against the facing direction means "walking into it".
      if (fv.x * this.pen.x + fv.y * this.pen.y < 0) this.pushTarget = e;
    }
    found.length = 0;
    if (tx !== 0 || ty !== 0) this.s.host.movePlayerBy(tx, ty);
  }

  private updateTimers(dtMs: number): void {
    if (this.invulnMs > 0) {
      this.invulnMs -= dtMs;
      const hidden = this.invulnMs > 0 && Math.floor(this.invulnMs / BLINK_PERIOD_MS) % 2 === 0;
      if (hidden !== this.blinkHidden) {
        this.blinkHidden = hidden;
        this.s.host.setPlayerBlink(!hidden);
      }
    }
    if (this.flashMs > 0) {
      this.flashMs -= dtMs;
      if (this.flashMs <= 0 && this.tinted) {
        this.tinted = false;
        this.s.host.setPlayerTint(null);
      }
    }
  }

  private regenMagic(dtMs: number): void {
    const rate = this.s.config.player.magicRegenPerSecond;
    if (rate <= 0) return;
    const p = this.s.state.player;
    if (p.magic >= p.maxMagic) {
      this.magicAcc = 0;
      return;
    }
    this.magicAcc += (rate * dtMs) / 1000;
    if (this.magicAcc >= 1) {
      const whole = Math.floor(this.magicAcc);
      this.magicAcc -= whole;
      changeMagic(this.s.toolkit, whole);
    }
  }

  /** The shield is held up with its button (shield on a button). */
  private shieldRaised(): boolean {
    const cfg = this.s.config.shield;
    const inv = this.s.toolkit.inventory;
    return cfg.enabled && cfg.mode === "hold" && this.s.host.input.isDown("shield") && inv.owns("shield") && inv.isAbilityEnabled("shield") && !this.s.sword?.isAttacking();
  }

  /** True when the shield would block a hit coming from (srcX, srcY). */
  canBlock(info: DamageInfo): boolean {
    const cfg = this.s.config.shield;
    if (!cfg.enabled || !info.blockable || !cfg.blocks.includes(info.type)) return false;
    const inv = this.s.toolkit.inventory;
    if (!inv.owns("shield") || !inv.isAbilityEnabled("shield")) return false;
    if (cfg.mode === "hold" && !this.s.host.input.isDown("shield")) return false;
    if (cfg.mode === "passive" && this.s.sword?.isAttacking()) return false;
    return isInFront(this.facing, this.box.x, this.box.y, info.originX, info.originY, cfg.frontalDot);
  }

  receiveHit(info: DamageInfo): HitResult {
    if (!this.isHittable()) return "ignored";
    if (this.canBlock(info)) {
      this.s.bus.emit("zelda:player:blocked", { type: info.type, sourceId: info.sourceId });
      this.startKnockback(info.originX, info.originY, this.s.config.shield.blockPushback, this.s.config.player.knockbackMs * 0.5);
      return "blocked";
    }
    return this.applyDamage(info.amount, info);
  }

  /** Direct damage from scripts/hazards (bypasses the shield, honors invulnerability). */
  applyDamage(amount: number, info: Pick<DamageInfo, "type" | "sourceId" | "originX" | "originY" | "knockback">): HitResult {
    if (!this.present || this.state === "dead") return "ignored";
    if (this.invulnMs > 0) return "ignored";
    const dmg = Math.max(0, Math.round(amount));
    if (dmg === 0) return "immune";
    this.s.bus.emit("zelda:player:takeDamage", { amount: dmg, type: info.type, sourceId: info.sourceId });
    changeHealth(this.s.toolkit, -dmg);
    const cfg = this.s.config.player;
    this.invulnMs = cfg.invulnerableMs;
    this.flashMs = this.s.config.combat.flashMs;
    this.tinted = true;
    this.s.host.setPlayerTint(HURT_TINT);
    const speed = info.knockback > 0 ? info.knockback : cfg.knockbackSpeed;
    this.startKnockback(info.originX, info.originY, speed, cfg.knockbackMs);
    this.hurtMs = 0;
    if (this.s.state.player.hp <= 0) {
      this.die();
      return "killed";
    }
    return "damaged";
  }

  private startKnockback(originX: number, originY: number, speed: number, ms: number): void {
    if (speed <= 0 || ms <= 0) return;
    normalize(this.tmp, this.box.x - originX, this.box.y - originY);
    if (this.tmp.x === 0 && this.tmp.y === 0) {
      const fv = FACING_VECTORS[this.facing];
      this.tmp.x = -fv.x;
      this.tmp.y = -fv.y;
    }
    this.knockVX = this.tmp.x * speed;
    this.knockVY = this.tmp.y * speed;
    this.knockMs = ms;
    this.lock("knockback");
  }

  die(): void {
    if (this.state === "dead") return;
    this.state = "dead";
    this.deadAnimMs = 0;
    if (this.pose?.lock) this.unlock("pose");
    this.pose = null;
    this.s.state.stats.deaths++;
    this.knockMs = 0;
    this.invulnMs = 0;
    this.deadMs = this.s.config.player.respawnDelayMs;
    this.lock("dead");
    this.setBlinkVisible(true);
    this.tinted = true;
    this.s.host.setPlayerTint(DEAD_TINT);
    this.s.bus.emit("zelda:player:died", { mapId: this.s.mapId });
  }

  private tickDead(dtMs: number): void {
    if (this.s.config.player.deathBehavior !== "respawn") return;
    this.deadMs -= dtMs;
    if (this.deadMs <= 0) this.respawn();
  }

  /** Restores health and moves the player to the respawn point. */
  respawn(): void {
    const p = this.s.state.player;
    const point = p.respawn && p.respawn.mapId === this.s.mapId ? p.respawn : null;
    const x = point ? point.x : this.startX;
    const y = point ? point.y : this.startY;
    this.state = "normal";
    this.s.host.setPlayerPosition(x, y);
    this.box.x = x;
    this.box.y = y;
    this.syncHurtbox();
    this.hasPrev = false;
    const target = Math.max(1, Math.min(p.maxHp, this.s.config.player.respawnHealth));
    changeHealth(this.s.toolkit, target - p.hp);
    this.unlock("dead");
    this.unlock("knockback");
    this.tinted = false;
    this.s.host.setPlayerTint(null);
    this.invulnMs = this.s.config.player.invulnerableMs;
    this.s.bus.emit("zelda:player:respawned", { x, y });
  }

  /** Called by interactions after floor checks: the current spot is safe ground. */
  markSafe(): void {
    if (this.onHazard || this.knockMs > 0 || this.state !== "normal") return;
    this.lastSafeX = this.box.x;
    this.lastSafeY = this.box.y;
  }

  /** Teleports to the last safe tile (pits, deep water). */
  returnToSafePoint(): void {
    this.s.host.setPlayerPosition(this.lastSafeX, this.lastSafeY);
    this.box.x = this.lastSafeX;
    this.box.y = this.lastSafeY;
    this.syncHurtbox();
    this.hasPrev = false;
    this.knockMs = 0;
    this.unlock("knockback");
  }

  /** A pause (message box, inventory) caught mid-blink must not leave the player invisible. */
  showForPause(): void {
    if (this.blinkHidden) this.setBlinkVisible(true);
    if (this.tinted) {
      this.tinted = false;
      this.flashMs = 0;
      this.s.host.setPlayerTint(null);
    }
  }

  private setBlinkVisible(visible: boolean): void {
    this.blinkHidden = !visible;
    this.s.host.setPlayerBlink(visible);
  }

  dispose(): void {
    // Leave the PS Maker player exactly as we found it.
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.locks.clear();
    if (this.overlayShown) this.s.host.setPlayerOverlay(null);
    this.s.host.setPlayerLocked(false);
    this.s.host.setPlayerBlink(true);
    this.s.host.setPlayerTint(null);
  }
}
