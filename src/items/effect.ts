import { Entity } from "../core/entity.ts";
import type { Session } from "../core/session.ts";

/** Short-lived purely visual entity (explosion, spark, poof). No collision. */
export class Effect extends Entity {
  private readonly lifeMs: number;
  private ageMs = 0;
  private readonly growTo: number;

  constructor(session: Session, sprite: string, x: number, y: number, lifeMs: number, growTo = 1, tint?: number) {
    super(session.world.nextId("fx"), "effect", x, y, 1, 1);
    this.lifeMs = lifeMs;
    this.growTo = growTo;
    this.view = session.host.renderer.createView({ sprite, overlay: true, tint });
    this.view.setPosition(x, y);
  }

  tick(dtMs: number, session: Session): void {
    this.ageMs += dtMs;
    const t = Math.min(1, this.ageMs / this.lifeMs);
    this.view?.setScale(1 + (this.growTo - 1) * t);
    this.view?.setAlpha(1 - t * t);
    if (this.ageMs >= this.lifeMs) session.world.remove(this);
  }
}

export function spawnEffect(session: Session, sprite: string, x: number, y: number, lifeMs = 250, growTo = 1, tint?: number): void {
  session.world.add(new Effect(session, sprite, x, y, lifeMs, growTo, tint));
}
