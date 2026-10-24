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
  private fuseMs: number;
  private readonly fuseTotal: number;
  private readonly attack = new AttackInstance(1);
  private readonly found: Entity[] = [];
  private readonly area = makeBox();

  constructor(session: Session, x: number, y: number) {
    super(session.world.nextId("bomb"), "projectile", x, y, 10, 10);
    this.fuseTotal = session.config.items.bomb.fuseMs;
    this.fuseMs = this.fuseTotal;
    this.view = session.host.renderer.createView({ sprite: "bomb" });
  }

  tick(dtMs: number, session: Session): void {
    this.fuseMs -= dtMs;
    // Blink faster as the fuse runs out.
    const t = 1 - this.fuseMs / this.fuseTotal;
    const period = t > 0.75 ? 60 : t > 0.5 ? 120 : 240;
    this.view?.setTint(Math.floor(this.fuseMs / period) % 2 === 0 ? 0xff6666 : null);
    if (this.fuseMs <= 0) this.explode(session);
  }

  explode(session: Session): void {
    if (this.removed) return;
    const cfg = session.config.items.bomb;
    const r = cfg.radius;
    spawnEffect(session, "explosion", this.x, this.y, 350, (r * 2) / 16);
    session.bus.emit("zelda:bomb:exploded", { x: this.x, y: this.y });
    this.area.x = this.x;
    this.area.y = this.y;
    this.area.hw = r;
    this.area.hh = r;
    const found = this.found;
    found.length = 0;
    session.world.query(this.area, found, (e) => e !== this && isDamageable(e));
    const info = makeDamage({ amount: cfg.damage, type: "bomb", team: "neutral", sourceId: this.id, originX: this.x, originY: this.y, knockback: cfg.knockback });
    for (const target of found) {
      if (!isDamageable(target) || !boxCircleOverlap(target, this.x, this.y, r)) continue;
      resolveHit(target, info, this.attack);
    }
    found.length = 0;
    // Chain reaction: other bombs in range go off immediately.
    for (const other of session.world.list("projectile")) {
      if (other instanceof Bomb && other !== this && !other.removed && boxCircleOverlap(other, this.x, this.y, r)) other.fuseMs = Math.min(other.fuseMs, 1);
    }
    const player = session.player;
    if (session.config.combat.bombsHurtPlayer && player.present && boxCircleOverlap(player.hurtbox, this.x, this.y, r)) {
      player.applyDamage(cfg.playerDamage, { type: "bomb", sourceId: this.id, originX: this.x, originY: this.y, knockback: cfg.knockback });
    }
    session.world.remove(this);
  }
}
