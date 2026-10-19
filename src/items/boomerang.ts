import type { Entity } from "../core/entity.ts";
import { normalize, overlaps, type Vec2 } from "../core/math.ts";
import type { Session } from "../core/session.ts";
import type { HitResult } from "../core/types.ts";
import { Pickup } from "./pickup.ts";
import { Projectile } from "./projectile.ts";

/**
 * Boomerang: flies out, returns on hit/wall/range, homes back to the player
 * (passing over obstacles), stuns enemies, triggers switches that accept the
 * "boomerang" tool and carries pickups back.
 */
export class Boomerang extends Projectile {
  returning = false;
  private spin = 0;
  private readonly carried: Pickup[] = [];
  private readonly dirTmp: Vec2 = { x: 0, y: 0 };

  constructor(session: Session, x: number, y: number, dirX: number, dirY: number) {
    const c = session.config.items.boomerang;
    super(
      session,
      {
        team: "player",
        ownerId: "player",
        x,
        y,
        dirX,
        dirY,
        speed: c.speed,
        range: c.range,
        sprite: "boomerang",
        size: 8,
        damage: c.damage,
        damageType: "boomerang",
        stunMs: c.stunMs,
        knockback: 0,
        pierce: true,
        rotate: false,
      },
      "boomerang",
    );
  }

  override tick(dtMs: number, session: Session): void {
    this.spin += dtMs * 0.03;
    this.view?.setRotation(this.spin);
    this.grabPickups(session);
    if (!this.returning) {
      super.tick(dtMs, session);
      return;
    }
    const player = session.player;
    if (!player.present) {
      session.world.remove(this);
      return;
    }
    normalize(this.dirTmp, player.box.x - this.x, player.box.y - this.y);
    const step = (this.speed * dtMs) / 1000;
    this.x += this.dirTmp.x * step;
    this.y += this.dirTmp.y * step;
    session.world.touch(this);
    this.checkTargets(session);
    if (overlaps(this, player.box)) this.catchBoomerang(session);
  }

  private grabPickups(session: Session): void {
    const found = this.found;
    found.length = 0;
    session.world.query(this, found, (e) => e instanceof Pickup && e.carrier === null);
    for (const e of found) {
      const p = e as Pickup;
      p.carrier = this;
      this.carried.push(p);
    }
    found.length = 0;
  }

  private catchBoomerang(session: Session): void {
    for (const p of this.carried) p.collect(session);
    this.carried.length = 0;
    session.world.remove(this);
  }

  private startReturn(): void {
    this.returning = true;
  }

  protected override onTargetHit(_session: Session, _target: Entity | { id: string }, result: HitResult): void {
    if (result !== "ignored") this.startReturn();
  }

  protected override onWall(): void {
    this.startReturn();
  }

  protected override onRangeEnd(): void {
    this.startReturn();
  }

  override dispose(): void {
    // Map closed mid-flight: drop carried items where they are.
    for (const p of this.carried) p.carrier = null;
    this.carried.length = 0;
    super.dispose();
  }
}
