import type { Session, SessionSystem } from "../core/session.ts";
import type { Entity } from "../core/entity.ts";
import { type AABB, type Facing, FACING_VECTORS, facingFromVector, isInFront, makeBox, normalize, penetration, type Vec2 } from "../core/math.ts";
import type { Damageable, DamageInfo, HitResult } from "../core/types.ts";
import { changeHealth, changeMagic } from "./health.ts";

export type PlayerState = "normal" | "dead";

const BLINK_PERIOD_MS = 66;
const HURT_TINT = 0xff4444;
const DEAD_TINT = 0x555577;

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

  constructor(session: Session) {
    this.s = session;
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
      this.tickDead(dtMs);
      return;
    }

    this.updateFacing();
    this.applyKnockback(dtMs);
    this.resolveSolids();
    this.updateTimers(dtMs);
    this.regenMagic(dtMs);
    this.syncHurtbox();
    this.prevX = this.box.x;
    this.prevY = this.box.y;
    this.hasPrev = true;
  }

  private updateFacing(): void {
    if (this.facingLocked) return;
    if (this.s.config.player.facingFromAnimation) {
      const hint = this.s.host.readPlayerFacingHint();
      if (hint) {
        this.facing = hint;
        return;
      }
    }
    if (!this.hasPrev || this.knockMs > 0) return;
    this.facing = facingFromVector(this.box.x - this.prevX, this.box.y - this.prevY, this.facing);
  }

  private applyKnockback(dtMs: number): void {
    if (this.knockMs <= 0) return;
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

  private setBlinkVisible(visible: boolean): void {
    this.blinkHidden = !visible;
    this.s.host.setPlayerBlink(visible);
  }

  dispose(): void {
    // Leave the PS Maker player exactly as we found it.
    this.locks.clear();
    this.s.host.setPlayerLocked(false);
    this.s.host.setPlayerBlink(true);
    this.s.host.setPlayerTint(null);
  }
}
