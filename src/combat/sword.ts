import type { Session, SessionSystem } from "../core/session.ts";
import type { Entity } from "../core/entity.ts";
import { type AABB, boxCircleOverlap, type Facing, makeBox } from "../core/math.ts";
import type { EntityView } from "../host/types.ts";
import type { DamageType, HitResult } from "../core/types.ts";
import { AttackInstance, isDamageable, makeDamage, resolveHit } from "./combat.ts";

export type SwordPhase = "idle" | "windup" | "active" | "recovery" | "charging" | "spin";

const FACING_ANGLE: Record<Facing, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
const SPIN_TURNS = 1;

/**
 * ALttP-style sword: windup -> active (hitbox live) -> recovery, then an
 * optional charge while the button is held, released into a spin attack.
 * Each swing is one `AttackInstance`, so a target is hit at most
 * `maxHitsPerTarget` times per swing no matter how many frames overlap.
 */
export class SwordSystem implements SessionSystem {
  readonly name = "sword";
  phase: SwordPhase = "idle";
  phaseMs = 0;
  charged = false;
  /** Current hitbox (valid when `hitboxActive`). */
  readonly hitbox: AABB = makeBox();
  hitboxActive = false;
  spinRadius = 0;
  readonly attack = new AttackInstance();
  private readonly pokeAttack = new AttackInstance();
  private readonly s: Session;
  private view: EntityView | null = null;
  private angle = 0;
  private readonly targets: Entity[] = [];

  constructor(session: Session) {
    this.s = session;
  }

  private get cfg() {
    return this.s.config.sword;
  }

  isAttacking(): boolean {
    return this.phase !== "idle";
  }

  /** True while the swing animation blocks other actions (items, lifting). */
  isBusy(): boolean {
    return this.phase === "windup" || this.phase === "active" || this.phase === "recovery" || this.phase === "spin";
  }

  private canUse(): boolean {
    const p = this.s.player;
    if (!p.present || p.isDead) return false;
    const inv = this.s.toolkit.inventory;
    if (!inv.owns("sword") || !inv.isAbilityEnabled("sword")) return false;
    if (this.s.interactions?.isCarrying()) return false;
    if (this.s.items?.isBusy()) return false;
    return true;
  }

  tick(dtMs: number): void {
    this.hitboxActive = false;
    if (!this.canUse()) {
      if (this.phase !== "idle") this.cancel();
      return;
    }
    const input = this.s.host.input;
    this.phaseMs += dtMs;

    switch (this.phase) {
      case "idle":
        if (input.pressed("sword")) this.startSwing();
        break;
      case "windup":
        if (this.phaseMs >= this.cfg.windupMs) this.enter("active");
        break;
      case "active":
        this.updateSwingHitbox();
        this.hitTargets(this.attack, this.cfg.damage, "sword", false);
        if (this.phaseMs >= this.cfg.activeMs) this.enter("recovery");
        break;
      case "recovery":
        if (!this.cfg.lockUntilRecovered && input.pressed("sword")) {
          this.startSwing();
        } else if (this.phaseMs >= this.cfg.recoveryMs) {
          if (this.cfg.charge.enabled && input.isDown("sword")) this.enter("charging");
          else this.finish();
        }
        break;
      case "charging":
        this.tickCharging(input.isDown("sword"));
        break;
      case "spin":
        this.updateSpin();
        this.hitTargets(this.attack, this.cfg.damage * this.cfg.charge.spinDamageMultiplier, "spin", true);
        if (this.phaseMs >= this.cfg.charge.spinMs) this.finish();
        break;
    }
    this.updateView();
  }

  private enter(phase: SwordPhase): void {
    this.phase = phase;
    this.phaseMs = 0;
    if (phase === "charging") {
      this.charged = false;
      this.pokeAttack.begin(1);
      // ALttP lets Link walk while charging.
      this.s.player.unlock("sword");
    }
  }

  startSwing(): void {
    const p = this.s.player;
    p.facingLocked = true;
    if (this.s.config.player.lockMovementWhileAttacking) p.lock("sword");
    this.attack.begin(this.cfg.maxHitsPerTarget);
    this.enter(this.cfg.windupMs > 0 ? "windup" : "active");
    this.s.bus.emit("zelda:player:attack", { kind: "sword", facing: p.facing });
  }

  private tickCharging(held: boolean): void {
    const c = this.cfg.charge;
    if (!held) {
      if (this.charged) this.startSpin();
      else this.finish();
      return;
    }
    if (!this.charged && this.phaseMs >= c.chargeMs) {
      this.charged = true;
      this.s.bus.emit("zelda:player:charged", { facing: this.s.player.facing });
    }
    if (c.pokeWhileCharging) {
      this.setFrontHitbox(this.cfg.range * 0.6, this.cfg.width);
      const landed = this.hitTargets(this.pokeAttack, c.pokeDamage, "poke", false);
      // Poking something cancels the charge, as in ALttP.
      if (landed) {
        this.s.bus.emit("zelda:player:attack", { kind: "poke", facing: this.s.player.facing });
        this.finish();
      }
    }
  }

  private startSpin(): void {
    const p = this.s.player;
    this.attack.begin(this.cfg.maxHitsPerTarget);
    if (this.s.config.player.lockMovementWhileAttacking) p.lock("sword");
    this.enter("spin");
    this.charged = false;
    this.s.bus.emit("zelda:player:attack", { kind: "spin", facing: p.facing });
  }

  /** Front-facing rectangle of the given length/width next to the player. */
  private setFrontHitbox(length: number, width: number): void {
    this.angle = FACING_ANGLE[this.s.player.facing];
    this.placeHitbox(this.angle, length, width);
  }

  private placeHitbox(angle: number, length: number, width: number): void {
    const p = this.s.player.box;
    const c = Math.abs(Math.cos(angle));
    const sn = Math.abs(Math.sin(angle));
    const reach = c * p.hw + sn * p.hh + length / 2;
    this.hitbox.x = p.x + Math.cos(angle) * reach;
    this.hitbox.y = p.y + Math.sin(angle) * reach;
    this.hitbox.hw = (c * length + sn * width) / 2;
    this.hitbox.hh = (sn * length + c * width) / 2;
    this.hitboxActive = true;
  }

  private updateSwingHitbox(): void {
    const base = FACING_ANGLE[this.s.player.facing];
    const t = this.cfg.activeMs > 0 ? Math.min(1, this.phaseMs / this.cfg.activeMs) : 1;
    this.angle = this.cfg.sweep ? base - (Math.PI / 2) * (1 - t) : base;
    this.placeHitbox(this.angle, this.cfg.range, this.cfg.width);
  }

  private updateSpin(): void {
    const p = this.s.player.box;
    const r = this.cfg.charge.spinRadius;
    this.spinRadius = r;
    this.hitbox.x = p.x;
    this.hitbox.y = p.y;
    this.hitbox.hw = r;
    this.hitbox.hh = r;
    this.hitboxActive = true;
    const t = this.phaseMs / Math.max(1, this.cfg.charge.spinMs);
    this.angle = FACING_ANGLE[this.s.player.facing] + t * Math.PI * 2 * SPIN_TURNS;
  }

  /** Returns true when at least one target took the hit or blocked it. */
  private hitTargets(attack: AttackInstance, amount: number, type: DamageType, circle: boolean): boolean {
    const p = this.s.player.box;
    const found = this.targets;
    found.length = 0;
    this.s.world.query(this.hitbox, found, isDamageable);
    let landed = false;
    for (let i = 0; i < found.length; i++) {
      const target = found[i];
      if (!isDamageable(target)) continue;
      if (circle && !boxCircleOverlap(target, p.x, p.y, this.spinRadius)) continue;
      const info = makeDamage({
        amount,
        type,
        team: "player",
        sourceId: "player",
        originX: p.x,
        originY: p.y,
        knockback: this.cfg.knockback,
      });
      const result: HitResult = resolveHit(target, info, attack);
      if (result === "blocked") {
        // Recoil off shields/armored enemies.
        this.s.player.moveWithCollision(Math.sign(p.x - target.x) * 4, Math.sign(p.y - target.y) * 4);
      }
      if (result !== "ignored" && result !== "immune") landed = true;
    }
    found.length = 0;
    return landed;
  }

  private finish(): void {
    this.phase = "idle";
    this.phaseMs = 0;
    this.charged = false;
    this.hitboxActive = false;
    this.s.player.facingLocked = false;
    this.s.player.unlock("sword");
  }

  cancel(): void {
    this.finish();
    this.view?.setVisible(false);
  }

  private updateView(): void {
    if (this.phase === "idle" || this.phase === "windup") {
      this.view?.setVisible(false);
      return;
    }
    if (!this.view) this.view = this.s.host.renderer.createView({ sprite: "sword", layer: 1 });
    const p = this.s.player.box;
    let angle = this.angle;
    let dist = this.cfg.range * 0.5 + Math.max(p.hw, p.hh);
    if (this.phase === "charging") {
      angle = FACING_ANGLE[this.s.player.facing];
      dist = Math.max(p.hw, p.hh) + this.cfg.range * 0.3;
      this.view.setTint(this.charged && Math.floor(this.phaseMs / 80) % 2 === 0 ? 0x88ccff : null);
    } else {
      this.view.setTint(null);
    }
    if (this.phase === "spin") dist = this.cfg.charge.spinRadius * 0.6;
    this.view.setVisible(true);
    this.view.setRotation(angle);
    this.view.setPosition(p.x + Math.cos(angle) * dist, p.y + Math.sin(angle) * dist);
  }

  dispose(): void {
    this.finish();
    this.view?.destroy();
    this.view = null;
  }
}
