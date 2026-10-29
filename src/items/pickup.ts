import { Entity } from "../core/entity.ts";
import { overlaps } from "../core/math.ts";
import type { Session } from "../core/session.ts";
import type { DropTable } from "../core/types.ts";
import type { Rng } from "../core/rng.ts";

const PICKUP_SPRITES: Record<string, string> = {
  heart: "pickup_heart",
  rupees: "pickup_rupee",
  magic: "pickup_magic",
  bombs: "pickup_bomb",
  arrows: "pickup_arrow",
  key: "pickup_key",
  big_key: "pickup_bigkey",
  heart_container: "pickup_container",
};

export interface PickupOptions {
  item: string;
  count?: number;
  /** 0 = never expires (placed items). */
  lifetimeMs?: number;
  /** Persistent pickups (placed keys) stay collected across map reloads. */
  persistentId?: string;
  silent?: boolean;
  sprite?: string;
}

/** Item lying on the ground; collected on contact with the player (or a boomerang). */
export class Pickup extends Entity {
  readonly item: string;
  readonly count: number;
  private readonly lifetimeMs: number;
  private ageMs = 0;
  private readonly persistentId: string | null;
  private readonly silent: boolean;
  /** Entity currently carrying this pickup (boomerang). */
  carrier: Entity | null = null;

  constructor(session: Session, x: number, y: number, opts: PickupOptions) {
    super(session.world.nextId("pickup"), "pickup", x, y, 10, 10);
    this.item = opts.item;
    this.count = Math.max(1, Math.round(opts.count ?? 1));
    this.lifetimeMs = opts.lifetimeMs ?? 0;
    this.persistentId = opts.persistentId ?? null;
    // Hearts, rupees etc. picked up from the ground do not pop a message.
    this.silent = opts.silent ?? ["heart", "rupees", "magic", "bombs", "arrows"].includes(opts.item);
    this.view = session.host.renderer.createView({ sprite: opts.sprite ?? PICKUP_SPRITES[opts.item] ?? `icon_${opts.item}` });
  }

  tick(dtMs: number, session: Session): void {
    if (this.carrier) {
      if (this.carrier.removed) {
        this.carrier = null;
      } else {
        this.x = this.carrier.x;
        this.y = this.carrier.y;
      }
    }
    if (this.lifetimeMs > 0 && !this.carrier) {
      this.ageMs += dtMs;
      const remaining = this.lifetimeMs - this.ageMs;
      // Blink during the last two seconds, like classic drops.
      this.view?.setVisible(remaining > 2000 || Math.floor(remaining / 100) % 2 === 0);
      if (remaining <= 0) {
        session.world.remove(this);
        return;
      }
    }
    const player = session.player;
    if (player.present && !player.isDead && overlaps(this, player.box)) this.collect(session);
  }

  collect(session: Session): void {
    if (this.removed) return;
    session.toolkit.inventory.give(this.item, this.count, { silent: this.silent });
    if (this.persistentId) session.state.objects[this.persistentId] = "collected";
    session.world.remove(this);
  }
}

export function rollDrop(rng: Rng, table: DropTable | null | undefined): { item: string; count: number } | null {
  if (!table || table.entries.length === 0 || !rng.chance(table.chance)) return null;
  let total = 0;
  for (const e of table.entries) total += Math.max(0, e.weight);
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (const e of table.entries) {
    roll -= Math.max(0, e.weight);
    if (roll < 0) return { item: e.item, count: e.count ?? 1 };
  }
  const last = table.entries[table.entries.length - 1];
  return { item: last.item, count: last.count ?? 1 };
}

export function spawnDrop(session: Session, x: number, y: number, table: DropTable | null | undefined): Pickup | null {
  const drop = rollDrop(session.rng, table);
  if (!drop) return null;
  return session.world.add(new Pickup(session, x, y, { item: drop.item, count: drop.count, lifetimeMs: session.config.enemies.dropLifetimeMs }));
}
