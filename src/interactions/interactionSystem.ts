import type { Session, SessionSystem } from "../core/session.ts";
import type { Entity } from "../core/entity.ts";
import { type AABB, type Facing, FACING_VECTORS, makeBox, overlaps } from "../core/math.ts";
import type { HitResult } from "../core/types.ts";
import { Projectile } from "../items/projectile.ts";
import { Bomb } from "../items/bomb.ts";
import { Interactable } from "./interactable.ts";

/** Carried object above the body centre when the host cannot tell where the head is. */
const CARRY_OFFSET_Y = 14;
/** How far a carried object sinks into the top of the head (pixels). */
const CARRY_OVERLAP = 3;
/**
 * How long a push survives losing contact. In PS Maker the engine moves the player into the block
 * and the toolkit pushes it back out, so contact shows up only every second or third frame.
 */
const PUSH_GRACE_MS = 150;

/** Thrown pot/bush/rock: flies like a projectile and shatters where it lands. */
class ThrownObject extends Projectile {
  private readonly obj: Interactable;

  constructor(session: Session, obj: Interactable, x: number, y: number, facing: Facing) {
    const c = session.config.items.thrown;
    const v = FACING_VECTORS[facing];
    super(
      session,
      { team: "player", ownerId: "player", x, y, dirX: v.x, dirY: v.y, speed: c.speed, range: c.range, sprite: obj.cfg.sprite, size: 10, damage: c.damage, damageType: "thrown", knockback: 160, rotate: false },
      "thrown",
    );
    this.obj = obj;
  }

  private land(session: Session): void {
    this.obj.x = this.x;
    this.obj.y = this.y;
    session.world.touch(this.obj);
    this.obj.destroy();
    session.world.remove(this);
  }

  protected override onTargetHit(session: Session, _t: Entity | { id: string }, _r: HitResult): void {
    this.land(session);
  }

  protected override onWall(session: Session): void {
    this.land(session);
  }

  protected override onRangeEnd(session: Session): void {
    this.land(session);
  }
}

/**
 * Player <-> world interactions that are not hits: action key (chests, levers,
 * doors, signs, lifting/throwing), pushing blocks, pressure plates, hazards.
 */
export class InteractionSystem implements SessionSystem {
  readonly name = "interactions";
  private readonly s: Session;
  private carried: Interactable | null = null;
  /** A placed bomb picked up (its fuse burns on; it goes off in the hands if not thrown in time). */
  private carriedBomb: Bomb | null = null;
  private pushTarget: Interactable | null = null;
  private pushMs = 0;
  private pushLostMs = 0;
  private pushDir: Facing = "down";
  private touchedDoor: Interactable | null = null;
  private readonly reach: AABB = makeBox();
  private readonly found: Entity[] = [];
  private readonly found2: Entity[] = [];
  private readonly offDamage: () => void;

  constructor(session: Session) {
    this.s = session;
    // Taking damage drops whatever is being carried (it shatters in place).
    this.offDamage = session.bus.on("zelda:player:takeDamage", () => this.dropCarried());
  }

  isCarrying(): boolean {
    return this.carried !== null || this.carriedBomb !== null;
  }

  /** The player is leaning on a block it can push (push animation). */
  isPushing(): boolean {
    return this.pushTarget !== null;
  }

  tick(dtMs: number): void {
    const p = this.s.player;
    if (!p.present) return;
    if (p.isDead) {
      this.dropCarried();
      return;
    }
    if (this.carried) this.updateCarried();
    if (this.carriedBomb) this.updateCarriedBomb();
    if (this.s.host.input.pressed("action")) this.onAction();
    this.updatePushing(dtMs);
    this.updateFloor();
  }

  private onAction(): void {
    const p = this.s.player;
    if (this.carried) {
      this.throwCarried();
      return;
    }
    if (this.carriedBomb) {
      this.throwBomb();
      return;
    }
    if (this.s.sword?.isBusy() || this.s.items?.isBusy()) return;
    // A placed bomb in front: pick it up.
    const bomb = this.findBombInFront();
    if (bomb) {
      this.liftBomb(bomb);
      return;
    }
    const target = this.findInFront();
    if (!target) return;
    if (target.interact(p.facing, p.box.y)) return;
    if (target.cfg.liftable && target.isHittable()) this.tryLift(target);
  }

  /** Nearest visible object within reach in front of the player. */
  private findInFront(): Interactable | null {
    const p = this.s.player;
    const v = FACING_VECTORS[p.facing];
    const reach = this.s.config.interactions.reachDistance;
    const r = this.reach;
    r.x = p.box.x + v.x * (p.box.hw + reach / 2);
    r.y = p.box.y + v.y * (p.box.hh + reach / 2);
    r.hw = v.x !== 0 ? reach / 2 + 1 : p.box.hw;
    r.hh = v.y !== 0 ? reach / 2 + 1 : p.box.hh;
    const found = this.found;
    found.length = 0;
    this.s.world.query(r, found, (e) => e instanceof Interactable && e.visible && e.objState !== "carried");
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const e of found) {
      const d = Math.abs(e.x - p.box.x) + Math.abs(e.y - p.box.y);
      if (d < bestD) {
        bestD = d;
        best = e as Interactable;
      }
    }
    found.length = 0;
    return best;
  }

  /** A placed bomb on the ground in front (not one in flight). */
  private findBombInFront(): Bomb | null {
    const p = this.s.player;
    const v = FACING_VECTORS[p.facing];
    const reach = this.s.config.interactions.reachDistance;
    const r = this.reach;
    r.x = p.box.x + v.x * (p.box.hw + reach / 2);
    r.y = p.box.y + v.y * (p.box.hh + reach / 2);
    r.hw = v.x !== 0 ? reach / 2 + 1 : p.box.hw;
    r.hh = v.y !== 0 ? reach / 2 + 1 : p.box.hh;
    this.found2.length = 0;
    this.s.world.query(r, this.found2, (e) => e instanceof Bomb && !e.removed && !e.carried && !e.isFlying);
    const bomb = (this.found2[0] as Bomb | undefined) ?? null;
    this.found2.length = 0;
    return bomb;
  }

  private liftBomb(bomb: Bomb): void {
    this.carriedBomb = bomb;
    bomb.carried = true;
    this.s.bus.emit("zelda:object:lifted", { objectId: bomb.id });
    this.updateCarriedBomb();
  }

  /** Over the head; a bomb that went off in the hands is gone (its blast hurt the player, bombsHurtPlayer). */
  private updateCarriedBomb(): void {
    const bomb = this.carriedBomb!;
    if (bomb.removed) {
      this.carriedBomb = null;
      return;
    }
    const p = this.s.player.box;
    const head = this.s.host.readPlayerTop?.();
    bomb.x = p.x;
    bomb.y = typeof head === "number" ? Math.min(head + CARRY_OVERLAP - bomb.hh, p.y - p.hh - bomb.hh) : p.y - CARRY_OFFSET_Y;
    bomb.view?.setDepthY?.(p.y + p.hh + 1);
    bomb.view?.setPosition(bomb.x, bomb.y);
  }

  private throwBomb(): void {
    const bomb = this.carriedBomb;
    if (!bomb) return;
    this.carriedBomb = null;
    bomb.view?.setDepthY?.(null);
    const p = this.s.player;
    const v = FACING_VECTORS[p.facing];
    const c = this.s.config.items.thrown;
    bomb.x = p.box.x + v.x * (p.box.hw + 6);
    bomb.y = p.box.y + v.y * (p.box.hh + 6) - 4;
    bomb.throwAlong(v.x, v.y, c.speed, c.range);
    this.s.bus.emit("zelda:object:thrown", { objectId: bomb.id });
  }

  private tryLift(obj: Interactable): void {
    const s = this.s;
    const need = obj.cfg.liftRequires;
    if (need && !s.toolkit.inventory.owns(need)) {
      s.bus.emit("zelda:message", { text: s.i18n.t("msg.too_heavy"), durationMs: 1200, kind: "hint" });
      return;
    }
    this.carried = obj;
    obj.setState("carried", { silent: true, persist: false });
    obj.solid = false;
    s.bus.emit("zelda:object:lifted", { objectId: obj.id });
    this.updateCarried();
  }

  private updateCarried(): void {
    const obj = this.carried!;
    const p = this.s.player.box;
    // Rest on the head (PS Maker frames are taller than the body), drawn in front of the player.
    const head = this.s.host.readPlayerTop?.();
    obj.x = p.x;
    obj.y = typeof head === "number" ? Math.min(head + CARRY_OVERLAP - obj.hh, p.y - p.hh - obj.hh) : p.y - CARRY_OFFSET_Y;
    obj.view?.setDepthY?.(p.y + p.hh + 1);
    obj.view?.setPosition(obj.x, obj.y);
  }

  private throwCarried(): void {
    const obj = this.carried;
    if (!obj) return;
    this.carried = null;
    obj.view?.setDepthY?.(null);
    const p = this.s.player;
    obj.view?.setVisible(false);
    const v = FACING_VECTORS[p.facing];
    this.s.world.add(new ThrownObject(this.s, obj, p.box.x + v.x * (p.box.hw + 6), p.box.y + v.y * (p.box.hh + 6) - 4, p.facing));
    this.s.bus.emit("zelda:object:thrown", { objectId: obj.id });
  }

  /** Drops the carried object where the player stands; it shatters. */
  dropCarried(): void {
    const bomb = this.carriedBomb;
    if (bomb) {
      // A bomb is put down at the feet, still burning.
      this.carriedBomb = null;
      bomb.carried = false;
      bomb.view?.setDepthY?.(null);
      if (!bomb.removed) {
        bomb.x = this.s.player.box.x;
        bomb.y = this.s.player.box.y + 2;
      }
    }
    const obj = this.carried;
    if (!obj) return;
    this.carried = null;
    obj.view?.setDepthY?.(null);
    obj.x = this.s.player.box.x;
    obj.y = this.s.player.box.y;
    obj.destroy();
  }

  private updatePushing(dtMs: number): void {
    const p = this.s.player;
    const target = p.pushTarget instanceof Interactable ? p.pushTarget : null;
    // Doors that unlock on touch (small key) open when walked into.
    if (target && target.cfg.type === "door" && target.cfg.unlockOnTouch && target.cfg.lock !== "switch") {
      if (this.touchedDoor !== target) {
        this.touchedDoor = target;
        target.tryUnlock(true);
      }
    } else {
      this.touchedDoor = null;
    }
    const pushing = !!target && target.cfg.type === "block" && target.canPush(p.facing) && !this.carried;
    if (pushing && target) {
      if (this.pushTarget !== target || this.pushDir !== p.facing) this.pushMs = 0;
      this.pushTarget = target;
      this.pushDir = p.facing;
      this.pushLostMs = 0;
    } else if (this.pushTarget && !this.carried && p.facing === this.pushDir && this.pushTarget.canPush(p.facing) && this.leaning(this.pushTarget) && this.pushLostMs + dtMs <= PUSH_GRACE_MS) {
      this.pushLostMs += dtMs;
    } else {
      this.pushTarget = null;
      this.pushMs = 0;
      return;
    }
    const block = this.pushTarget;
    this.pushMs += dtMs;
    if (this.pushMs >= this.s.config.interactions.pushMs) {
      this.pushMs = 0;
      block.tryPush(p.facing);
    }
  }

  /** The player stands right against the block on the side it faces (within 2 px). */
  private leaning(block: Interactable): boolean {
    const b = this.s.player.box;
    const v = FACING_VECTORS[this.pushDir];
    const r = this.reach;
    r.x = b.x + v.x * 2;
    r.y = b.y + v.y * 2;
    r.hw = b.hw;
    r.hh = b.hh;
    return overlaps(r, block);
  }

  /** Pressure plates and hazards. */
  private updateFloor(): void {
    const s = this.s;
    const p = s.player;
    p.onHazard = false;
    // In the air (Roc's Feather) spikes and pits do nothing; where the player lands counts.
    if (s.moves?.isAirborne) {
      p.onHazard = true;
      return;
    }
    for (const e of s.world.list("object")) {
      if (e.removed || !(e instanceof Interactable) || !e.visible) continue;
      const type = e.cfg.type;
      if (type === "pressure_plate") {
        e.setPressed(this.isPlatePressed(e));
      } else if (type === "spikes") {
        if (overlaps(e, p.hurtbox)) {
          p.onHazard = true;
          p.applyDamage(e.cfg.hazardDamage, { type: "hazard", sourceId: e.id, originX: e.x, originY: e.y, knockback: 0 });
        }
      } else if (type === "pit") {
        // Fall only when the player's center is over the pit (lets them skirt the edge).
        if (Math.abs(p.box.x - e.x) < e.hw && Math.abs(p.box.y - e.y) < e.hh) {
          p.onHazard = true;
          p.applyDamage(e.cfg.hazardDamage, { type: "fall", sourceId: e.id, originX: p.box.x, originY: p.box.y, knockback: 0 });
          p.returnToSafePoint();
        }
      }
    }
    p.markSafe();
  }

  private isPlatePressed(plate: Interactable): boolean {
    const act = plate.cfg.activators;
    const p = this.s.player;
    if (act.includes("player") && p.present && !p.isDead && Math.abs(p.box.x - plate.x) < plate.hw && Math.abs(p.box.y - plate.y) < plate.hh) return true;
    const found = this.found2;
    found.length = 0;
    this.s.world.query(plate, found);
    let pressed = false;
    for (const e of found) {
      if (e === plate) continue;
      const centered = Math.abs(e.x - plate.x) < plate.hw && Math.abs(e.y - plate.y) < plate.hh;
      if (!centered) continue;
      if (act.includes("block") && e instanceof Interactable && e.cfg.type === "block" && !e.moving) pressed = true;
      if (act.includes("enemy") && e.kind === "enemy" && e.alive) pressed = true;
      if (pressed) break;
    }
    found.length = 0;
    return pressed;
  }

  dispose(): void {
    this.offDamage();
    this.carried = null;
    this.pushTarget = null;
  }
}
