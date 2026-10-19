import type { EntityView } from "../host/types.ts";
import type { AABB } from "./math.ts";
import type { EntityKind, Team } from "./types.ts";
import type { Session } from "./session.ts";

/**
 * Base class for every map-local object the toolkit simulates. Entities are
 * owned by the `World`; their `tick` is called from the single fixed-step loop
 * (no per-entity timers or loops).
 */
export abstract class Entity implements AABB {
  readonly id: string;
  readonly kind: EntityKind;
  x: number;
  y: number;
  hw: number;
  hh: number;
  team: Team = "neutral";
  /** Blocks movement of the player, enemies, blocks and projectiles. */
  solid = false;
  /** False once dead/destroyed; the entity may still be fading out. */
  alive = true;
  /** Set by World.remove; the entity is dropped at the end of the tick. */
  removed = false;
  view: EntityView | null = null;
  /** Free-form group used by rules (`enemiesDefeated`) and waves. */
  group = "";

  constructor(id: string, kind: EntityKind, x: number, y: number, w: number, h: number) {
    this.id = id;
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.hw = w / 2;
    this.hh = h / 2;
  }

  abstract tick(dtMs: number, session: Session): void;

  /** Pushes position to the view. Called after every tick. */
  syncView(): void {
    this.view?.setPosition(this.x, this.y);
  }

  /** Releases the view; override to release other resources. */
  dispose(): void {
    this.view?.destroy();
    this.view = null;
  }
}
