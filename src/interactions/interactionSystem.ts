import type { Session, SessionSystem } from "../core/session.ts";
import type { Entity } from "../core/entity.ts";
import { type AABB, type Facing, FACING_VECTORS, makeBox, overlaps } from "../core/math.ts";
import type { HitResult } from "../core/types.ts";
import { Projectile } from "../items/projectile.ts";
import { Interactable } from "./interactable.ts";

const CARRY_OFFSET_Y = 14;

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
  private pushTarget: Interactable | null = null;
  private pushMs = 0;
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
    return this.carried !== null;
  }

  tick(dtMs: number): void {
    const p = this.s.player;
    if (!p.present) return;
    if (p.isDead) {
      this.dropCarried();
      return;
    }
    if (this.carried) this.updateCarried();
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
    if (this.s.sword?.isBusy() || this.s.items?.isBusy()) return;
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

  private tryLift(obj: Interactable): void {
    const s = this.s;
    const need = obj.cfg.liftRequires;
    if (need && !s.toolkit.inventory.owns(need)) {
      s.bus.emit("zelda:message", { text: s.i18n.t("msg.too_heavy"), durationMs: 1200 });
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
    obj.x = p.x;
    obj.y = p.y - CARRY_OFFSET_Y;
    obj.view?.setPosition(obj.x, obj.y);
  }

  private throwCarried(): void {
    const obj = this.carried;
    if (!obj) return;
    this.carried = null;
    const p = this.s.player;
    obj.view?.setVisible(false);
    const v = FACING_VECTORS[p.facing];
    this.s.world.add(new ThrownObject(this.s, obj, p.box.x + v.x * (p.box.hw + 6), p.box.y + v.y * (p.box.hh + 6) - 4, p.facing));
    this.s.bus.emit("zelda:object:thrown", { objectId: obj.id });
  }

  /** Drops the carried object where the player stands; it shatters. */
  dropCarried(): void {
    const obj = this.carried;
    if (!obj) return;
    this.carried = null;
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
    if (!target || target.cfg.type !== "block" || !target.canPush(p.facing) || this.carried) {
      this.pushTarget = null;
      this.pushMs = 0;
      return;
    }
    if (this.pushTarget !== target) {
      this.pushTarget = target;
      this.pushMs = 0;
    }
    this.pushMs += dtMs;
    if (this.pushMs >= this.s.config.interactions.pushMs) {
      this.pushMs = 0;
      target.tryPush(p.facing);
    }
  }

  /** Pressure plates and hazards. */
  private updateFloor(): void {
    const s = this.s;
    const p = s.player;
    p.onHazard = false;
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
