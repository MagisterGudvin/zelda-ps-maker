import type { Session, SessionSystem } from "../core/session.ts";
import { FACING_VECTORS } from "../core/math.ts";
import type { ZeldaEventMap } from "../core/events.ts";
import { type ItemUseContext, resolveNumber } from "./registry.ts";

type FailReason = ZeldaEventMap["zelda:item:failed"]["reason"];

export interface UseItemResult {
  ok: boolean;
  reason?: FailReason;
}

/**
 * Uses the active quick item on input. Owns cooldowns, `maxActive` limits and
 * resource spending, so individual items only describe their effect.
 */
export class ItemSystem implements SessionSystem {
  readonly name = "items";
  private readonly s: Session;
  private readonly cooldowns = new Map<string, number>();
  private readonly active = new Map<string, Set<string>>();
  private busyMs = 0;
  private readonly ctx: ItemUseContext;

  constructor(session: Session) {
    this.s = session;
    this.ctx = { session, facing: "down", x: 0, y: 0, frontX: 0, frontY: 0, dirX: 0, dirY: 1 };
  }

  isBusy(): boolean {
    return this.busyMs > 0;
  }

  tick(dtMs: number): void {
    for (const [id, ms] of this.cooldowns) {
      const left = ms - dtMs;
      if (left <= 0) this.cooldowns.delete(id);
      else this.cooldowns.set(id, left);
    }
    if (this.busyMs > 0) {
      this.busyMs -= dtMs;
      if (this.busyMs <= 0) this.s.player.unlock("item");
    }
    if (this.s.host.input.pressed("useItem")) {
      const id = this.s.state.inventory.activeItem;
      if (id) this.use(id);
    }
  }

  /** Number of live entities created by this item (bombs on screen, boomerangs in flight). */
  activeCount(itemId: string): number {
    const set = this.active.get(itemId);
    if (!set) return 0;
    for (const id of set) if (!this.s.world.has(id)) set.delete(id);
    return set.size;
  }

  /**
   * Uses an item. `free` skips ownership/resource checks (scripts).
   * Resources are spent only after the item reports a successful use.
   */
  use(itemId: string, options: { free?: boolean } = {}): UseItemResult {
    const s = this.s;
    const def = s.toolkit.items.get(itemId);
    const inv = s.toolkit.inventory;
    if (!def || !def.use) return this.fail(itemId, "notOwned");
    if (!options.free && !inv.owns(itemId)) return this.fail(itemId, "notOwned");
    if (!inv.isAbilityEnabled(itemId)) return this.fail(itemId, "disabled");
    const p = s.player;
    if (!p.present || p.isDead || p.isKnockedBack || this.busyMs > 0 || s.sword?.isBusy() || s.interactions?.isCarrying()) return this.fail(itemId, "busy");
    if (this.cooldowns.has(itemId)) return this.fail(itemId, "cooldown");
    const cost = resolveNumber(def.cost, s, 0);
    if (!options.free && def.resource && cost > 0 && !inv.has(def.resource, cost)) {
      s.bus.emit("zelda:message", { text: s.i18n.t("msg.no_resource", { resource: inv.displayName(def.resource) }), durationMs: 1200 });
      return this.fail(itemId, "noResource");
    }
    const max = resolveNumber(def.maxActive, s, 0);
    if (max > 0 && this.activeCount(itemId) >= max) return this.fail(itemId, "maxActive");

    const v = FACING_VECTORS[p.facing];
    const c = this.ctx;
    c.facing = p.facing;
    c.x = p.box.x;
    c.y = p.box.y;
    c.dirX = v.x;
    c.dirY = v.y;
    c.frontX = p.box.x + v.x * (p.box.hw + 6);
    c.frontY = p.box.y + v.y * (p.box.hh + 6);

    const result = def.use(c);
    if (result === false) return { ok: false };
    if (!options.free && def.resource && cost > 0) inv.spend(def.resource, cost);
    if (typeof result === "object") {
      let set = this.active.get(itemId);
      if (!set) {
        set = new Set();
        this.active.set(itemId, set);
      }
      set.add(result.id);
    }
    const cd = resolveNumber(def.cooldownMs, s, 0);
    if (cd > 0) this.cooldowns.set(itemId, cd);
    if (def.useMs && def.useMs > 0) {
      this.busyMs = def.useMs;
      if (s.config.player.lockMovementWhileUsingItem) p.lock("item");
    }
    s.bus.emit("zelda:item:used", { itemId });
    return { ok: true };
  }

  private fail(itemId: string, reason: FailReason): UseItemResult {
    this.s.bus.emit("zelda:item:failed", { itemId, reason });
    return { ok: false, reason };
  }

  dispose(): void {
    this.cooldowns.clear();
    this.active.clear();
    this.s.player.unlock("item");
  }
}
