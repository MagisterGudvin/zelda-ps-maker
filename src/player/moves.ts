import type { Session, SessionSystem } from "../core/session.ts";
import type { Entity } from "../core/entity.ts";
import { FACING_VECTORS, makeBox } from "../core/math.ts";
import type { EntityView } from "../host/types.ts";
import { AttackInstance, isDamageable, makeDamage, resolveHit } from "../combat/combat.ts";
import { spawnEffect } from "../items/effect.ts";

/**
 * Moves that items give the player:
 * - the Pegasus Boots dash: while the item button is held the player runs up in place, then dashes
 *   straight ahead until the button is let go or a wall stops them (a bump that throws them back);
 *   with the sword the dash cuts through enemies, bushes and grass in front;
 * - the Roc's Feather jump: a short hop in which pits, spikes and enemies on the ground do nothing;
 *   jumping during a dash keeps the dash speed (a long jump over gaps).
 * The toolkit moves the player itself during a dash (PS Maker's movement is held), as for knockback.
 */
export class MoveAbilities implements SessionSystem {
  readonly name = "moves";
  private readonly s: Session;
  private dash: { button: "useItem" | "useItem2"; ms: number; running: boolean; attack: AttackInstance; dustMs: number } | null = null;
  private airMs = 0;
  /** How high the player is drawn now (pixels; 0 on the ground). */
  hopHeight = 0;
  private readonly front = makeBox();
  private readonly found: Entity[] = [];
  /** The sword held out in front during the dash (the built-in blade). */
  private blade: EntityView | null = null;

  constructor(session: Session) {
    this.s = session;
  }

  /** In the air (Roc's Feather): pits, spikes and enemies on the ground do not reach the player. */
  get isAirborne(): boolean {
    return this.airMs > 0 || this.pulled;
  }

  /** Pulled by the hookshot: off the ground too (over pits), without the jump's hop. */
  private pulled = false;

  setPulled(on: boolean): void {
    this.pulled = on;
  }

  /** Running up or dashing with the Pegasus Boots. */
  get isDashing(): boolean {
    return this.dash !== null;
  }

  /** Starts the Pegasus Boots run-up; the dash lasts while `button` is held. */
  startDash(button: "useItem" | "useItem2"): boolean {
    const p = this.s.player;
    if (this.dash || !p.present || p.isDead || p.isKnockedBack || this.s.interactions?.isCarrying()) return false;
    this.dash = { button, ms: 0, running: false, attack: new AttackInstance(1), dustMs: 0 };
    p.lock("dash");
    p.facingLocked = true;
    return true;
  }

  /** Roc's Feather: jumps (also in the middle of a dash). */
  jump(): boolean {
    const p = this.s.player;
    if (this.airMs > 0 || !p.present || p.isDead || this.s.interactions?.isCarrying()) return false;
    this.airMs = this.s.config.items.feather.jumpMs;
    this.s.bus.emit("zelda:player:jumped", {});
    return true;
  }

  tick(dtMs: number): void {
    this.tickJump(dtMs);
    this.tickDash(dtMs);
  }

  private tickJump(dtMs: number): void {
    if (this.airMs <= 0) return;
    const total = this.s.config.items.feather.jumpMs;
    this.airMs = Math.max(0, this.airMs - dtMs);
    const t = 1 - this.airMs / total;
    this.hopHeight = this.airMs > 0 ? Math.sin(Math.PI * t) * this.s.config.items.feather.height : 0;
    this.s.host.setPlayerHop?.(this.hopHeight);
    if (this.airMs === 0) spawnEffect(this.s, "poof", this.s.player.box.x, this.s.player.box.y + this.s.player.box.hh, 180, 0.6);
  }

  private tickDash(dtMs: number): void {
    const d = this.dash;
    if (!d) return;
    const p = this.s.player;
    const cfg = this.s.config.items.boots;
    if (!this.s.host.input.isDown(d.button) || p.isDead || p.isKnockedBack) return this.stopDash();
    d.ms += dtMs;
    d.dustMs -= dtMs;
    const v = FACING_VECTORS[p.facing];
    if (d.dustMs <= 0) {
      spawnEffect(this.s, "poof", p.box.x - v.x * p.box.hw, p.box.y + p.box.hh, 200, 0.5);
      d.dustMs = d.running ? 90 : 140;
    }
    if (!d.running) {
      if (d.ms < cfg.chargeMs) return;
      d.running = true;
      this.s.bus.emit("zelda:player:dashed", {});
    }
    const step = (cfg.speed * dtMs) / 1000;
    const x0 = p.box.x;
    const y0 = p.box.y;
    p.moveWithCollision(v.x * step, v.y * step);
    this.dashAttack();
    // A wall (map collision or a solid object): a bump that throws the player back, as in the air too.
    const moved = Math.abs(p.box.x - x0) + Math.abs(p.box.y - y0);
    if (moved < step * 0.25 && !this.isAirborne) {
      spawnEffect(this.s, "spark", p.box.x + v.x * (p.box.hw + 2), p.box.y + v.y * (p.box.hh + 2), 150);
      this.s.bus.emit("zelda:player:bumped", {});
      this.stopDash();
      p.bump(cfg.bounce);
    }
  }

  /** With the sword the dash hits what is in front of the player (enemies, bushes, grass), the blade held out. */
  private dashAttack(): void {
    const s = this.s;
    if (!s.toolkit.inventory.owns("sword") || !s.toolkit.inventory.isAbilityEnabled("sword")) return;
    const p = s.player;
    const v = FACING_VECTORS[p.facing];
    this.blade ??= s.host.renderer.createView({ sprite: "sword", layer: 1, originX: 0, originY: 0.5 });
    this.blade.setVisible(true);
    this.blade.setRotation(Math.atan2(v.y, v.x));
    this.blade.setScale(0.75);
    this.blade.setPosition(p.pivotX + v.x * p.box.hw, p.pivotY + v.y * p.box.hh);
    // Facing up the blade is behind the player, as the sword is.
    this.blade.setDepthY?.(v.y < 0 ? p.box.y - p.box.hh - 1 : p.box.y + p.box.hh + 1);
    const f = this.front;
    f.hw = v.x !== 0 ? 6 : p.box.hw;
    f.hh = v.y !== 0 ? 6 : p.box.hh;
    f.x = p.box.x + v.x * (p.box.hw + f.hw);
    f.y = p.box.y + v.y * (p.box.hh + f.hh);
    this.found.length = 0;
    s.world.query(f, this.found, (e) => isDamageable(e) && (e.kind === "enemy" || e.kind === "object"));
    const info = makeDamage({ amount: s.config.sword.damage, type: "sword", team: "player", sourceId: "player", originX: p.box.x, originY: p.box.y, knockback: s.config.sword.knockback });
    for (const e of this.found) if (isDamageable(e)) resolveHit(e, info, this.dash!.attack);
    this.found.length = 0;
  }

  private stopDash(): void {
    if (!this.dash) return;
    this.dash = null;
    this.blade?.setVisible(false);
    this.s.player.facingLocked = false;
    this.s.player.unlock("dash");
  }

  dispose(): void {
    this.stopDash();
    this.blade?.destroy();
    this.blade = null;
    if (this.airMs > 0) this.s.host.setPlayerHop?.(0);
    this.airMs = 0;
    this.hopHeight = 0;
  }
}
