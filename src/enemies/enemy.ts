import { Entity } from "../core/entity.ts";
import { type Facing, FACING_VECTORS, facingFromVector, isInFront, makeBox, normalize, overlaps, type Vec2 } from "../core/math.ts";
import type { Session } from "../core/session.ts";
import type { Damageable, DamageInfo, HitResult } from "../core/types.ts";
import { objectKey } from "../core/state.ts";
import { makeDamage, resolveHit, scaleDamage } from "../combat/combat.ts";
import { spawnDrop } from "../items/pickup.ts";
import { spawnEffect } from "../items/effect.ts";
import { Projectile } from "../items/projectile.ts";
import type { EnemyConfig } from "./templates.ts";
import { BEHAVIORS } from "./behaviors.ts";
import { animFrame } from "../core/animation.ts";

export type EnemyState = "idle" | "patrol" | "alert" | "chase" | "windup" | "attack" | "recover" | "hurt" | "stunned" | "dead";

const FLASH_TINT = 0xffffff;
const WINDUP_TINT = 0xffee55;
const STUN_TINT = 0x66aaff;
const GUARD_TINT = 0x9999ff;
const LOS_STEP = 8;

/**
 * Generic enemy. Shared state handling (damage, knockback, stun, death,
 * contact damage) lives here; templates plug in a behavior that decides
 * transitions (`think`, staggered every N ticks) and moves (`act`, every tick).
 */
export class Enemy extends Entity implements Damageable {
  readonly cfg: EnemyConfig;
  readonly maxHp: number;
  hp: number;
  state: EnemyState = "idle";
  stateMs = 0;
  facing: Facing = "down";
  /** Velocity for knockback and lunges (px/s). */
  vx = 0;
  vy = 0;
  attackCooldownMs = 0;
  guardUp = false;
  guardMs = 0;
  phase = -1;
  readonly homeX: number;
  readonly homeY: number;
  patrolIndex = 0;
  readonly wanderTarget: Vec2 = { x: 0, y: 0 };
  hasWanderTarget = false;
  /** Alternates attack styles for the miniboss. */
  attackCounter = 0;
  readonly summoned = new Set<string>();
  /** Stagger slot so AI decisions spread across ticks. */
  readonly slot: number;

  private readonly session: Session;
  private hitCooldownMs = 0;
  private flashMs = 0;
  private stunMs = 0;
  private fadeMs = 0;
  readonly persistentKey: string | null;
  private readonly adopted: boolean;
  private readonly tmp: Vec2 = { x: 0, y: 0 };
  private readonly probe = makeBox();
  private tintState: number | null = null;

  constructor(session: Session, id: string, cfg: EnemyConfig, x: number, y: number, opts: { group?: string; adopt?: unknown; persistent?: boolean } = {}) {
    super(id, "enemy", x, y, cfg.width, cfg.height);
    this.session = session;
    this.cfg = cfg;
    this.team = "enemy";
    this.group = opts.group ?? "";
    this.maxHp = Math.max(1, cfg.hp);
    this.hp = this.maxHp;
    this.homeX = x;
    this.homeY = y;
    this.slot = session.world.count("enemy");
    this.persistentKey = opts.persistent ? objectKey(session.mapId, id) : null;
    this.adopted = opts.adopt !== undefined && opts.adopt !== null;
    this.view = session.host.renderer.createView({
      sprite: cfg.sprite,
      adopt: opts.adopt,
      width: cfg.width,
      height: cfg.height,
      tint: cfg.tint ?? undefined,
      scale: cfg.spriteScale !== 1 ? cfg.spriteScale : undefined,
      offsetX: cfg.spriteOffsetX,
      offsetY: cfg.spriteOffsetY,
    });
    this.state = cfg.behavior === "patroller" ? "patrol" : "idle";
  }

  get isDead(): boolean {
    return this.state === "dead";
  }

  isHittable(): boolean {
    return this.alive && this.hitCooldownMs <= 0;
  }

  setState(state: EnemyState): void {
    if (this.state === "dead") return;
    this.state = state;
    this.stateMs = 0;
  }

  tick(dtMs: number, s: Session): void {
    this.stateMs += dtMs;
    if (this.state === "dead") {
      this.fadeMs -= dtMs;
      this.view?.setAlpha(Math.max(0, this.fadeMs / s.config.enemies.deathFadeMs));
      if (!this.adopted) this.updateAnimation();
      if (this.fadeMs <= 0) s.world.remove(this);
      return;
    }
    if (this.hitCooldownMs > 0) this.hitCooldownMs -= dtMs;
    if (this.attackCooldownMs > 0) this.attackCooldownMs -= dtMs;
    if (this.flashMs > 0) this.flashMs -= dtMs;

    const behavior = BEHAVIORS[this.cfg.behavior];
    if (this.state === "hurt") {
      this.integrateVelocity(dtMs, 0.85);
      if (this.stateMs >= this.cfg.hurtMs) this.setState("chase");
    } else if (this.state === "stunned") {
      this.stunMs -= dtMs;
      this.integrateVelocity(dtMs, 0.8);
      if (this.stunMs <= 0) this.setState("chase");
    } else {
      const every = Math.max(1, s.config.enemies.thinkEveryTicks);
      if ((s.tick + this.slot) % every === 0) behavior.think(this, s);
      behavior.act(this, s, dtMs);
    }
    this.contactDamage(s);
    this.updateVisual();
  }

  private contactDamage(s: Session): void {
    if (!this.cfg.contactDamage || this.state === "stunned" || this.state === "hurt") return;
    const player = s.player;
    if (!player.present || !overlaps(this, player.hurtbox)) return;
    const result = resolveHit(
      player,
      makeDamage({ amount: this.cfg.damage, type: "contact", team: "enemy", sourceId: this.id, originX: this.x, originY: this.y, blockable: true }),
      null,
    );
    // Touching the player is a bump, as in ALttP: the enemy breaks off its lunge and
    // recoils; while the player blinks it is pushed out. It never walks through.
    if (result === "damaged" || result === "blocked" || result === "killed") this.recoilFrom(s, player.box.x, player.box.y);
    else this.separateFrom(s, player.hurtbox);
  }

  /** Bounces away from a point (contact with the player) and pauses before attacking again. */
  recoilFrom(s: Session, x: number, y: number): void {
    normalize(this.tmp, this.x - x, this.y - y);
    if (this.tmp.x === 0 && this.tmp.y === 0) {
      const fv = FACING_VECTORS[this.facing];
      this.tmp.x = -fv.x;
      this.tmp.y = -fv.y;
    }
    const speed = s.config.enemies.contactRecoil * (1 - this.cfg.knockbackResist);
    this.vx = this.tmp.x * speed;
    this.vy = this.tmp.y * speed;
    this.attackCooldownMs = Math.max(this.attackCooldownMs, this.cfg.attackCooldownMs);
    this.setState("recover");
  }

  /** Pushes the enemy out of a box along the shallower axis (walls still block it). */
  private separateFrom(s: Session, box: { x: number; y: number; hw: number; hh: number }): void {
    const ox = this.hw + box.hw - Math.abs(this.x - box.x);
    const oy = this.hh + box.hh - Math.abs(this.y - box.y);
    if (ox <= 0 || oy <= 0) return;
    if (ox < oy) s.world.move(this, this.x < box.x ? -ox : ox, 0);
    else s.world.move(this, 0, this.y < box.y ? -oy : oy);
  }

  receiveHit(info: DamageInfo): HitResult {
    if (!this.isHittable()) return "ignored";
    const s = this.session;
    if (this.guardUp && !this.cfg.guard.breakers.includes(info.type) && isInFront(this.facing, this.x, this.y, info.originX, info.originY, this.cfg.guard.frontalDot)) {
      this.hitCooldownMs = s.config.combat.enemyHitCooldownMs;
      spawnEffect(s, "spark", (this.x + info.originX) / 2, (this.y + info.originY) / 2, 150);
      s.bus.emit("zelda:enemy:blocked", { enemyId: this.id, type: info.type });
      return "blocked";
    }
    const amount = scaleDamage(s.config, info.amount, info.type, this.cfg.resistances);
    const immune = this.cfg.resistances[info.type] === 0;
    if (immune) return "immune";
    if (info.stunMs > 0 && !this.cfg.stunImmune) this.stun(info.stunMs);
    if (amount <= 0) {
      this.hitCooldownMs = s.config.combat.enemyHitCooldownMs;
      return info.stunMs > 0 ? "damaged" : "immune";
    }
    this.hp = Math.max(0, this.hp - amount);
    this.hitCooldownMs = s.config.combat.enemyHitCooldownMs;
    this.flashMs = s.config.combat.flashMs;
    s.bus.emit("zelda:enemy:damaged", { enemyId: this.id, amount, type: info.type, hp: this.hp });
    if (this.hp <= 0) {
      this.die();
      return "killed";
    }
    if (info.knockback > 0 && this.state !== "stunned") {
      normalize(this.tmp, this.x - info.originX, this.y - info.originY);
      const k = info.knockback * (1 - Math.min(1, Math.max(0, this.cfg.knockbackResist)));
      this.vx = this.tmp.x * k;
      this.vy = this.tmp.y * k;
      this.setState("hurt");
    }
    return "damaged";
  }

  stun(ms: number): void {
    this.stunMs = Math.max(this.stunMs, ms);
    this.vx = 0;
    this.vy = 0;
    this.setState("stunned");
    this.session.bus.emit("zelda:enemy:stunned", { enemyId: this.id, ms });
  }

  /** Kills immediately (also used by scripts). Stops every behavior at once. */
  die(): void {
    if (this.state === "dead") return;
    const s = this.session;
    this.hp = 0;
    this.state = "dead";
    this.stateMs = 0;
    this.alive = false;
    this.solid = false;
    this.vx = 0;
    this.vy = 0;
    this.guardUp = false;
    this.fadeMs = s.config.enemies.deathFadeMs;
    s.state.stats.enemiesDefeated++;
    if (this.persistentKey) s.state.objects[this.persistentKey] = "defeated";
    spawnEffect(s, "poof", this.x, this.y, 300, 1.5);
    spawnDrop(s, this.x, this.y, this.cfg.drops ?? s.config.enemies.defaultDrops);
    s.bus.emit("zelda:enemy:defeated", { enemyId: this.id, template: this.cfg.template, group: this.group });
    if (this.cfg.boss) s.bus.emit("zelda:boss:defeated", { enemyId: this.id, dungeonId: s.state.currentDungeon });
  }

  // ---- helpers used by behaviors -------------------------------------------------

  distanceToPlayer(s: Session): number {
    const p = s.player.box;
    return Math.sqrt((p.x - this.x) ** 2 + (p.y - this.y) ** 2);
  }

  /** Range + optional line of sight against map collision and solid objects. */
  canSeePlayer(s: Session, range: number): boolean {
    const player = s.player;
    if (!player.present || player.isDead) return false;
    const d = this.distanceToPlayer(s);
    if (d > range) return false;
    if (!this.cfg.lineOfSight) return true;
    const steps = Math.floor(d / LOS_STEP);
    const p = this.probe;
    p.hw = 1;
    p.hh = 1;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      p.x = this.x + (player.box.x - this.x) * t;
      p.y = this.y + (player.box.y - this.y) * t;
      if (s.world.isBlocked(p, this, true)) return false;
    }
    return true;
  }

  faceToward(x: number, y: number): void {
    this.facing = facingFromVector(x - this.x, y - this.y, this.facing);
  }

  /** Moves toward a point; returns true if blocked on both axes. */
  moveToward(s: Session, tx: number, ty: number, speed: number, dtMs: number): boolean {
    normalize(this.tmp, tx - this.x, ty - this.y);
    if (this.tmp.x === 0 && this.tmp.y === 0) return false;
    this.facing = facingFromVector(this.tmp.x, this.tmp.y, this.facing);
    const step = (speed * dtMs) / 1000;
    const r = s.world.move(this, this.tmp.x * step, this.tmp.y * step);
    return r.blockedX && r.blockedY;
  }

  /** Integrates (vx, vy) with collision and damping; returns true when blocked. */
  integrateVelocity(dtMs: number, damping: number): boolean {
    const dt = dtMs / 1000;
    const r = this.session.world.move(this, this.vx * dt, this.vy * dt);
    if (r.blockedX) this.vx = 0;
    if (r.blockedY) this.vy = 0;
    const d = Math.pow(damping, dtMs / 16.6667);
    this.vx *= d;
    this.vy *= d;
    return r.blockedX || r.blockedY;
  }

  fireAt(s: Session, tx: number, ty: number): void {
    normalize(this.tmp, tx - this.x, ty - this.y);
    this.spawnShot(s, this.tmp.x, this.tmp.y);
  }

  fireBurst(s: Session, count: number): void {
    const n = Math.max(1, count);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawnShot(s, Math.cos(a), Math.sin(a));
    }
  }

  private spawnShot(s: Session, dx: number, dy: number): void {
    const pc = this.cfg.projectile;
    s.world.add(
      new Projectile(s, {
        team: "enemy",
        ownerId: this.id,
        x: this.x + dx * (this.hw + 4),
        y: this.y + dy * (this.hh + 4),
        dirX: dx,
        dirY: dy,
        speed: pc.speed,
        range: pc.range,
        sprite: pc.sprite,
        damage: pc.damage,
        damageType: pc.type,
        blockable: pc.blockable,
        knockback: 140,
      }),
    );
  }

  private updateVisual(): void {
    let tint: number | null = this.cfg.tint;
    if (this.flashMs > 0 && Math.floor(this.flashMs / 50) % 2 === 0) tint = FLASH_TINT;
    else if (this.state === "stunned") tint = Math.floor(this.stateMs / 120) % 2 === 0 ? STUN_TINT : this.cfg.tint;
    else if (this.state === "windup") tint = Math.floor(this.stateMs / 70) % 2 === 0 ? WINDUP_TINT : this.cfg.tint;
    else if (this.guardUp) tint = GUARD_TINT;
    if (tint !== this.tintState) {
      this.tintState = tint;
      this.view?.setTint(tint);
    }
    if (!this.adopted && !this.updateAnimation()) this.view?.setFlipX(this.facing === "left");
  }

  private animMs = 0;
  private animName = "";
  private lastX = 0;
  private lastY = 0;

  /** Picks the sprite-sheet animation for the current state; false when none is configured. */
  private updateAnimation(): boolean {
    const a = this.cfg.animations;
    const moved = Math.abs(this.x - this.lastX) + Math.abs(this.y - this.lastY) > 0.01;
    this.lastX = this.x;
    this.lastY = this.y;
    let name = "";
    switch (this.state) {
      case "dead":
        name = a.death || a.hurt;
        break;
      case "hurt":
      case "stunned":
        name = a.hurt || a.idle;
        break;
      case "windup":
        name = a.windup || a.attack;
        break;
      case "attack":
        name = a.attack || a.walk;
        break;
      default:
        name = moved ? a.walk || a.idle : a.idle || a.walk;
    }
    const def = name ? this.session.config.sprites.animations[name] : undefined;
    if (!def) return false;
    if (name !== this.animName) {
      this.animName = name;
      this.animMs = 0;
    }
    this.animMs += 1000 / this.session.config.world.fixedStepHz;
    const f = animFrame({ ...def, loop: def.loop ?? (this.state !== "dead" && this.state !== "windup") }, this.facing, this.animMs);
    if (f) this.view?.setAnimFrame(f.sheet, f.frame, f.flipX);
    return !!f;
  }

  override dispose(): void {
    if (this.adopted) {
      // We do not own adopted NPC objects: hide instead of destroying.
      this.view?.setVisible(false);
      this.view = null;
      return;
    }
    super.dispose();
  }
}
