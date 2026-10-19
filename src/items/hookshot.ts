import type { Entity } from "../core/entity.ts";
import { normalize, overlaps, type Vec2 } from "../core/math.ts";
import type { Session } from "../core/session.ts";
import type { HitResult } from "../core/types.ts";
import { Projectile } from "./projectile.ts";

/** Objects the hookshot can latch onto expose `hookable = true`. */
export interface Hookable {
  hookable: boolean;
}

function isHookable(e: unknown): e is Hookable & Entity {
  return typeof e === "object" && e !== null && (e as Hookable).hookable === true;
}

const PULL_TIMEOUT_MS = 2000;

/**
 * EXPERIMENTAL hookshot (disabled by default, see docs/ENGINE_AUDIT.md):
 * latches onto `hookable` objects and drags the player there by moving the
 * PS Maker player sprite; stuns enemies; retracts otherwise.
 */
export class Hookshot extends Projectile {
  phase: "out" | "back" | "pull" = "out";
  private pullMs = 0;
  private readonly tmp: Vec2 = { x: 0, y: 0 };

  constructor(session: Session, x: number, y: number, dirX: number, dirY: number) {
    const c = session.config.items.hookshot;
    super(
      session,
      { team: "player", ownerId: "player", x, y, dirX, dirY, speed: c.speed, range: c.range, sprite: "hookshot", size: 6, damage: c.damage, damageType: "hookshot", stunMs: c.stunMs, knockback: 0 },
      "hookshot",
    );
    session.player.lock("hookshot");
  }

  override tick(dtMs: number, session: Session): void {
    const player = session.player;
    if (!player.present || player.isDead) {
      this.finish(session);
      return;
    }
    if (this.phase === "out") {
      super.tick(dtMs, session);
      return;
    }
    if (this.phase === "back") {
      normalize(this.tmp, player.box.x - this.x, player.box.y - this.y);
      const step = (this.speed * 1.5 * dtMs) / 1000;
      this.x += this.tmp.x * step;
      this.y += this.tmp.y * step;
      if (overlaps(this, player.box)) this.finish(session);
      return;
    }
    // Pull: drag the player toward the hook point.
    this.pullMs += dtMs;
    const c = session.config.items.hookshot;
    normalize(this.tmp, this.x - player.box.x, this.y - player.box.y);
    const step = (c.pullSpeed * dtMs) / 1000;
    const beforeX = player.box.x;
    const beforeY = player.box.y;
    player.moveWithCollision(this.tmp.x * step, this.tmp.y * step);
    const moved = Math.abs(player.box.x - beforeX) + Math.abs(player.box.y - beforeY);
    const near = Math.abs(player.box.x - this.x) <= player.box.hw + this.hw + 2 && Math.abs(player.box.y - this.y) <= player.box.hh + this.hh + 2;
    if (near || moved < 0.01 || this.pullMs > PULL_TIMEOUT_MS) this.finish(session);
  }

  protected override onTargetHit(_s: Session, _target: Entity | { id: string }, result: HitResult): void {
    if (result !== "ignored") this.phase = "back";
  }

  protected override onWall(session: Session): void {
    const found = this.found;
    found.length = 0;
    session.world.query(this.probe, found, isHookable);
    const target = found[0];
    found.length = 0;
    this.phase = target ? "pull" : "back";
  }

  protected override onRangeEnd(): void {
    this.phase = "back";
  }

  private finish(session: Session): void {
    session.player.unlock("hookshot");
    session.world.remove(this);
  }
}
