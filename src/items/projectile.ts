import { Entity } from "../core/entity.ts";
import { makeBox, normalize, overlaps, type Vec2 } from "../core/math.ts";
import type { Session } from "../core/session.ts";
import type { DamageType, HitResult, Team } from "../core/types.ts";
import { AttackInstance, isDamageable, makeDamage, resolveHit } from "../combat/combat.ts";
import { spawnEffect } from "./effect.ts";

export interface ProjectileOptions {
  team: Team;
  ownerId: string;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  range: number;
  sprite: string;
  size?: number;
  damage: number;
  damageType: DamageType;
  knockback?: number;
  stunMs?: number;
  blockable?: boolean;
  pierce?: boolean;
  /** Projectiles of the player team may hit interactive objects (switches, torches). */
  hitsObjects?: boolean;
  rotate?: boolean;
  tint?: number;
}

/**
 * Straight-flying projectile shared by arrows, fireballs, enemy shots and
 * thrown objects. Subclasses (boomerang) override `onRangeEnd`,
 * `onWall` and `onTargetHit`.
 */
export class Projectile extends Entity {
  ownerId: string;
  readonly damageType: DamageType;
  vx: number;
  vy: number;
  speed: number;
  readonly range: number;
  traveled = 0;
  protected readonly opts: ProjectileOptions;
  protected attack = new AttackInstance(1);
  protected readonly found: Entity[] = [];
  protected readonly probe = makeBox();
  private readonly dir: Vec2 = { x: 0, y: 0 };

  constructor(session: Session, opts: ProjectileOptions, idPrefix = "proj") {
    const size = opts.size ?? 6;
    super(session.world.nextId(idPrefix), "projectile", opts.x, opts.y, size, size);
    this.opts = opts;
    this.team = opts.team;
    this.ownerId = opts.ownerId;
    this.damageType = opts.damageType;
    normalize(this.dir, opts.dirX, opts.dirY);
    this.speed = opts.speed;
    this.vx = this.dir.x * opts.speed;
    this.vy = this.dir.y * opts.speed;
    this.range = opts.range;
    this.view = session.host.renderer.createView({ sprite: opts.sprite, tint: opts.tint, layer: 2 });
    if (opts.rotate !== false) this.view.setRotation(Math.atan2(this.vy, this.vx));
  }

  tick(dtMs: number, session: Session): void {
    const dt = dtMs / 1000;
    const dx = this.vx * dt;
    const dy = this.vy * dt;
    const p = this.probe;
    p.x = this.x + dx;
    p.y = this.y + dy;
    p.hw = this.hw;
    p.hh = this.hh;
    if (session.world.isBlocked(p, null, true)) {
      // Give solid objects (switches, bombable walls, torches) a chance to react.
      this.hitSolidsAt(session);
      if (!this.removed) this.onWall(session);
      return;
    }
    this.x = p.x;
    this.y = p.y;
    session.world.touch(this);
    this.traveled += Math.sqrt(dx * dx + dy * dy);
    this.checkTargets(session);
    if (!this.removed && this.traveled >= this.range) this.onRangeEnd(session);
  }

  protected damageInfo() {
    return makeDamage({
      amount: this.opts.damage,
      type: this.damageType,
      team: this.team,
      sourceId: this.id,
      originX: this.x - this.vx * 0.05,
      originY: this.y - this.vy * 0.05,
      knockback: this.opts.knockback ?? 120,
      stunMs: this.opts.stunMs ?? 0,
      blockable: this.opts.blockable ?? false,
    });
  }

  protected checkTargets(session: Session): void {
    if (this.team === "enemy") {
      const player = session.player;
      if (player.present && overlaps(this, player.hurtbox)) {
        const result = resolveHit(player, this.damageInfo(), this.attack);
        if (result !== "ignored") this.onTargetHit(session, player, result);
      }
      return;
    }
    const found = this.found;
    found.length = 0;
    session.world.query(this, found, (e) => e !== this && isDamageable(e) && (e.kind === "enemy" || (this.opts.hitsObjects !== false && e.kind === "object")));
    for (let i = 0; i < found.length && !this.removed; i++) {
      const target = found[i];
      if (!isDamageable(target)) continue;
      const result = resolveHit(target, this.damageInfo(), this.attack);
      if (result !== "ignored") this.onTargetHit(session, target, result);
    }
    found.length = 0;
  }

  private hitSolidsAt(session: Session): void {
    if (this.team === "enemy" || this.opts.hitsObjects === false) return;
    const found = this.found;
    found.length = 0;
    session.world.query(this.probe, found, (e) => e.solid && isDamageable(e));
    for (let i = 0; i < found.length; i++) {
      const target = found[i];
      if (isDamageable(target)) resolveHit(target, this.damageInfo(), this.attack);
    }
    found.length = 0;
  }

  protected onTargetHit(session: Session, _target: Entity | { id: string }, result: HitResult): void {
    // The Mirror Shield sends the shot back: it now flies for the player, at whoever is in its way.
    if (result === "blocked" && this.team === "enemy" && _target === session.player && session.player.reflects(this.damageType)) {
      spawnEffect(session, "sparkle", this.x, this.y, 200);
      session.bus.emit("zelda:player:reflected", { type: this.damageType, sourceId: this.id });
      this.team = "player";
      this.ownerId = "player";
      this.vx = -this.vx;
      this.vy = -this.vy;
      this.traveled = 0;
      // Its hits start over: the shooter can be hit by its own shot.
      this.attack = new AttackInstance(1);
      if (this.opts.rotate !== false) this.view?.setRotation(Math.atan2(this.vy, this.vx));
      return;
    }
    if (result === "blocked") {
      spawnEffect(session, "spark", this.x, this.y, 150);
      session.world.remove(this);
      return;
    }
    if (!this.opts.pierce) session.world.remove(this);
  }

  protected onWall(session: Session): void {
    spawnEffect(session, "spark", this.x, this.y, 120);
    session.world.remove(this);
  }

  protected onRangeEnd(session: Session): void {
    session.world.remove(this);
  }
}
