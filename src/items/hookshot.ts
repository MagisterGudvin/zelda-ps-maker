import { Entity } from "../core/entity.ts";
import { makeBox, normalize, overlaps, type Vec2 } from "../core/math.ts";
import type { Session } from "../core/session.ts";
import type { EntityView } from "../host/types.ts";
import { AttackInstance, isDamageable, makeDamage, resolveHit } from "../combat/combat.ts";
import { Interactable } from "../interactions/interactable.ts";
import { spawnEffect } from "./effect.ts";
import { Pickup } from "./pickup.ts";
import type { ItemUseContext } from "./registry.ts";

const CHAIN_LINKS = 8;

/**
 * The hookshot: the hook flies straight ahead on its chain up to `items.hookshot.range`.
 * - An enemy: hurt and stunned, the hook comes back.
 * - A dropped item: it rides the hook back to the player.
 * - A solid object whose type is in `items.hookshot.grabs` (a hook post, a chest, a block...): the
 *   hook holds and pulls the player to it, over pits (the player is off the ground meanwhile).
 * - A wall or anything else: a spark, the hook comes back.
 * The player stands still (or is pulled) until the hook is back.
 */
export class Hookshot extends Entity {
  private readonly s: Session;
  private state: "out" | "back" | "pull" = "out";
  private traveled = 0;
  private readonly dir: Vec2 = { x: 0, y: 0 };
  private readonly chain: EntityView[] = [];
  private target: Entity | null = null;
  private readonly attack = new AttackInstance(1);
  private readonly probe = makeBox();
  private readonly found: Entity[] = [];
  private stuckMs = 0;

  constructor(session: Session, ctx: ItemUseContext) {
    super(session.world.nextId("hookshot"), "projectile", ctx.frontX, ctx.frontY, 6, 6);
    this.s = session;
    this.team = "player";
    normalize(this.dir, ctx.dirX, ctx.dirY);
    this.view = session.host.renderer.createView({ sprite: "hookshot_head", layer: 2 });
    this.view.setRotation(Math.atan2(this.dir.y, this.dir.x));
    for (let i = 0; i < CHAIN_LINKS; i++) this.chain.push(session.host.renderer.createView({ sprite: "hookshot_chain", layer: 1 }));
    session.player.lock("hookshot");
    session.player.facingLocked = true;
  }

  /** Where the chain starts: just in front of the player. */
  private hand(): { x: number; y: number } {
    const p = this.s.player.box;
    return { x: p.x + this.dir.x * (p.hw + 2), y: p.y + this.dir.y * (p.hh + 2) };
  }

  tick(dtMs: number, s: Session): void {
    const p = s.player;
    if (!p.present || p.isDead || p.isKnockedBack) return this.finish();
    const c = s.config.items.hookshot;
    const dt = dtMs / 1000;
    if (this.state === "out") this.flyOut(c.speed * dt, c);
    else if (this.state === "back") this.reelIn(c.speed * 1.4 * dt);
    else this.pull(c.pullSpeed * dt, dtMs);
    this.updateChain();
  }

  private flyOut(step: number, c: Session["config"]["items"]["hookshot"]): void {
    const s = this.s;
    const pr = this.probe;
    pr.x = this.x + this.dir.x * step;
    pr.y = this.y + this.dir.y * step;
    pr.hw = this.hw;
    pr.hh = this.hh;
    // An enemy: hurt and stunned.
    this.found.length = 0;
    s.world.query(pr, this.found, (e) => e.kind === "enemy" && isDamageable(e));
    const enemy = this.found[0];
    this.found.length = 0;
    if (enemy && isDamageable(enemy)) {
      resolveHit(enemy, makeDamage({ amount: c.damage, type: "hookshot", team: "player", sourceId: this.id, originX: this.x, originY: this.y, knockback: 0, stunMs: c.stunMs }), this.attack);
      this.state = "back";
      return;
    }
    // A dropped item: it rides back on the hook.
    s.world.query(pr, this.found, (e) => e instanceof Pickup && !e.removed && !e.carrier);
    const item = this.found[0];
    this.found.length = 0;
    if (item instanceof Pickup) {
      item.carrier = this;
      this.state = "back";
      return;
    }
    if (s.world.isBlocked(pr, null, true)) {
      // A solid object it can hold: pull the player there.
      s.world.query(pr, this.found, (e) => e instanceof Interactable && e.solid && !e.removed && overlaps(e, pr));
      const grab = this.found.find((e) => e instanceof Interactable && c.grabs.includes(e.cfg.type));
      this.found.length = 0;
      if (grab) {
        this.target = grab;
        this.state = "pull";
        s.moves?.setPulled(true);
        s.bus.emit("zelda:hookshot:grabbed", { objectId: grab.id });
      } else {
        spawnEffect(s, "spark", pr.x, pr.y, 120);
        this.state = "back";
      }
      return;
    }
    this.x = pr.x;
    this.y = pr.y;
    this.traveled += step;
    if (this.traveled >= c.range) this.state = "back";
  }

  private reelIn(step: number): void {
    const h = this.hand();
    const dx = h.x - this.x;
    const dy = h.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= step) {
      // What rode back on the hook is the player's.
      for (const e of this.s.world.list("pickup")) if (e instanceof Pickup && e.carrier === this) e.collect(this.s);
      return this.finish();
    }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
  }

  /** Pulls the player toward the hook until they reach the object (or something stops them). */
  private pull(step: number, dtMs: number): void {
    const p = this.s.player;
    const t = this.target!;
    const gapX = Math.abs(t.x - p.box.x) - (t.hw + p.box.hw);
    const gapY = Math.abs(t.y - p.box.y) - (t.hh + p.box.hh);
    if (Math.max(gapX, gapY) <= 1.5) return this.finish();
    const x0 = p.box.x;
    const y0 = p.box.y;
    p.moveWithCollision(this.dir.x * step, this.dir.y * step);
    // Stopped by a wall on the way: let go after a moment.
    this.stuckMs = Math.abs(p.box.x - x0) + Math.abs(p.box.y - y0) < step * 0.2 ? this.stuckMs + dtMs : 0;
    if (this.stuckMs > 120) this.finish();
  }

  private updateChain(): void {
    const h = this.hand();
    const show = !this.removed;
    this.chain.forEach((link, i) => {
      const t = (i + 1) / (CHAIN_LINKS + 1);
      link.setVisible(show);
      link.setPosition(h.x + (this.x - h.x) * t, h.y + (this.y - h.y) * t);
    });
  }

  private finish(): void {
    if (this.removed) return;
    this.s.world.remove(this);
    this.release();
  }

  private released = false;

  private release(): void {
    if (this.released) return;
    this.released = true;
    this.s.moves?.setPulled(false);
    this.s.player.facingLocked = false;
    this.s.player.unlock("hookshot");
  }

  override dispose(): void {
    this.release();
    for (const link of this.chain) link.destroy();
    this.chain.length = 0;
    super.dispose();
  }
}
