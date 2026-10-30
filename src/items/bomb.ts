import { Entity } from "../core/entity.ts";
import { boxCircleOverlap, makeBox } from "../core/math.ts";
import type { Session } from "../core/session.ts";
import { AttackInstance, isDamageable, makeDamage, resolveHit } from "../combat/combat.ts";
import { spawnEffect } from "./effect.ts";

/**
 * Placed bomb: fuse, blinking, then a radial explosion that damages enemies,
 * breaks objects that accept the "bomb" tool and (optionally) hurts the player.
 * Bombs are team "neutral" so they hit everyone in range exactly once.
 */
export class Bomb extends Entity {
  fuseMs: number;
  private readonly fuseTotal: number;
  private readonly attack = new AttackInstance(1);

  constructor(session: Session, x: number, y: number) {
    super(session.world.nextId("bomb"), "projectile", x, y, 10, 10);
    this.fuseTotal = session.config.items.bomb.fuseMs;
    this.fuseMs = this.fuseTotal;
    this.view = session.host.renderer.createView({ sprite: "bomb" });
  }

  /** Held over the player's head (picked up with the action key); the fuse keeps burning. */
  carried = false;
  /** Thrown: flies until `left` pixels are covered or something solid is in the way, then lies there. */
  private flight: { vx: number; vy: number; left: number } | null = null;
  private readonly probe = makeBox();

  get isFlying(): boolean {
    return this.flight !== null;
  }

  /** Throws the bomb from where it is (the player's head) along a direction. */
  throwAlong(dirX: number, dirY: number, speed: number, distance: number): void {
    this.carried = false;
    this.flight = { vx: dirX * speed, vy: dirY * speed, left: distance };
  }

  tick(dtMs: number, session: Session): void {
    if (this.flight) {
      const f = this.flight;
      const dt = dtMs / 1000;
      const pr = this.probe;
      pr.x = this.x + f.vx * dt;
      pr.y = this.y + f.vy * dt;
      pr.hw = this.hw;
      pr.hh = this.hh;
      if (session.world.isBlocked(pr, this, true)) this.flight = null;
      else {
        this.x = pr.x;
        this.y = pr.y;
        session.world.touch(this);
        f.left -= Math.hypot(f.vx, f.vy) * dt;
        if (f.left <= 0) this.flight = null;
      }
    }
    this.fuseMs -= dtMs;
    // Blink faster as the fuse runs out.
    const t = 1 - this.fuseMs / this.fuseTotal;
    const period = t > 0.75 ? 60 : t > 0.5 ? 120 : 240;
    this.view?.setTint(Math.floor(this.fuseMs / period) % 2 === 0 ? 0xff6666 : null);
    if (this.fuseMs <= 0) this.explode(session);
  }

  explode(session: Session): void {
    if (this.removed) return;
    explodeAt(session, this.x, this.y, this.id, this.attack);
    session.world.remove(this);
  }

  /** Lights the fuse to go off now (another explosion in range). */
  goOff(): void {
    this.fuseMs = Math.min(this.fuseMs, 1);
  }
}

const area = makeBox();
const found: Entity[] = [];

/**
 * A bomb's explosion at a point (a placed bomb, a bomb arrow): damages enemies, breaks objects
 * that accept the "bomb" tool, sets off other bombs in range and (optionally) hurts the player.
 */
export function explodeAt(session: Session, x: number, y: number, sourceId: string, attack = new AttackInstance(1)): void {
  const cfg = session.config.items.bomb;
  const r = cfg.radius;
  spawnEffect(session, "explosion", x, y, 350, (r * 2) / 16);
  session.bus.emit("zelda:bomb:exploded", { x, y });
  area.x = x;
  area.y = y;
  area.hw = r;
  area.hh = r;
  found.length = 0;
  session.world.query(area, found, (e) => e.id !== sourceId && isDamageable(e));
  const info = makeDamage({ amount: cfg.damage, type: "bomb", team: "neutral", sourceId, originX: x, originY: y, knockback: cfg.knockback });
  const targets = found.slice();
  found.length = 0;
  for (const target of targets) {
    if (!isDamageable(target) || !boxCircleOverlap(target, x, y, r)) continue;
    resolveHit(target, info, attack);
  }
  // Chain reaction: other bombs in range go off immediately.
  for (const other of session.world.list("projectile")) {
    if (other instanceof Bomb && other.id !== sourceId && !other.removed && boxCircleOverlap(other, x, y, r)) other.goOff();
  }
  const player = session.player;
  if (session.config.combat.bombsHurtPlayer && player.present && boxCircleOverlap(player.hurtbox, x, y, r)) {
    player.applyDamage(cfg.playerDamage, { type: "bomb", sourceId, originX: x, originY: y, knockback: cfg.knockback });
  }
}
