import type { HostAdapter } from "../host/types.ts";
import type { Entity } from "./entity.ts";
import { type AABB, makeBox, overlaps } from "./math.ts";
import { SpatialHash } from "./spatialHash.ts";
import type { EntityKind } from "./types.ts";

export interface MoveResult {
  blockedX: boolean;
  blockedY: boolean;
}

/**
 * Map-local entity registry with a broad-phase index. Removal is deferred to
 * `flush()` so systems can iterate safely while entities die mid-tick.
 */
export class World {
  private readonly byId = new Map<string, Entity>();
  private readonly lists: Record<EntityKind, Entity[]> = {
    enemy: [],
    object: [],
    projectile: [],
    pickup: [],
    effect: [],
  };
  private readonly index = new SpatialHash<Entity>(64);
  private readonly scratch: Entity[] = [];
  private readonly probe = makeBox();
  private readonly moveResult: MoveResult = { blockedX: false, blockedY: false };
  private counter = 0;
  private readonly host: HostAdapter;

  constructor(host: HostAdapter) {
    this.host = host;
  }

  nextId(prefix: string): string {
    this.counter++;
    return `${prefix}#${this.counter}`;
  }

  add<T extends Entity>(entity: T): T {
    if (this.byId.has(entity.id)) {
      throw new Error(`Entity id "${entity.id}" already exists on this map`);
    }
    this.byId.set(entity.id, entity);
    this.lists[entity.kind].push(entity);
    this.index.insert(entity);
    return entity;
  }

  has(id: string): boolean {
    const e = this.byId.get(id);
    return !!e && !e.removed;
  }

  get(id: string): Entity | undefined {
    const e = this.byId.get(id);
    return e && !e.removed ? e : undefined;
  }

  /**
   * The entity of a kind at a point picked on the map: one whose box contains the
   * point, else the nearest centre within `radius` pixels.
   */
  at(kind: EntityKind, x: number, y: number, radius = 12, accept?: (e: Entity) => boolean): Entity | null {
    let best: Entity | null = null;
    let bestD = radius * radius;
    for (const e of this.list(kind)) {
      if (e.removed || (accept && !accept(e))) continue;
      if (Math.abs(e.x - x) <= e.hw && Math.abs(e.y - y) <= e.hh) return e;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  list(kind: EntityKind): readonly Entity[] {
    return this.lists[kind];
  }

  count(kind?: EntityKind): number {
    if (kind) return this.lists[kind].length;
    return this.byId.size;
  }

  remove(entity: Entity): void {
    entity.removed = true;
    entity.alive = false;
  }

  /** Physically drops removed entities and disposes their views. */
  flush(): void {
    for (const kind of Object.keys(this.lists) as EntityKind[]) {
      const list = this.lists[kind];
      let w = 0;
      for (let r = 0; r < list.length; r++) {
        const e = list[r];
        if (e.removed) {
          this.byId.delete(e.id);
          this.index.forget(e);
          e.dispose();
        } else {
          list[w++] = e;
        }
      }
      list.length = w;
    }
  }

  /** Rebuilds the broad phase from current positions. Once per tick. */
  reindex(): void {
    this.index.clear();
    for (const e of this.byId.values()) {
      if (!e.removed) this.index.insert(e);
    }
  }

  /**
   * Exact overlap query. Results are appended to `out`; the caller owns the
   * array so hot paths can reuse it.
   */
  query(box: AABB, out: Entity[], filter?: (e: Entity) => boolean): Entity[] {
    const candidates = this.scratch;
    candidates.length = 0;
    this.index.query(box, candidates);
    for (let i = 0; i < candidates.length; i++) {
      const e = candidates[i];
      if (e.removed) continue;
      if (!overlaps(e, box)) continue;
      if (filter && !filter(e)) continue;
      out.push(e);
    }
    candidates.length = 0;
    return out;
  }

  /** True if the box hits a solid toolkit entity (except `ignore`) or map collision. */
  isBlocked(box: AABB, ignore: Entity | null, includeMap = true): boolean {
    const candidates = this.scratch;
    candidates.length = 0;
    this.index.query(box, candidates);
    let hit = false;
    for (let i = 0; i < candidates.length; i++) {
      const e = candidates[i];
      if (e === ignore || e.removed || !e.solid) continue;
      if (overlaps(e, box)) {
        hit = true;
        break;
      }
    }
    candidates.length = 0;
    if (hit) return true;
    return includeMap && this.host.isMapBlocked(box);
  }

  /**
   * Moves an entity with axis-separated collision (slides along walls).
   * The returned object is reused; copy it if you need to keep it.
   */
  move(entity: Entity, dx: number, dy: number, includeMap = true): MoveResult {
    const res = this.moveResult;
    res.blockedX = false;
    res.blockedY = false;
    const p = this.probe;
    p.hw = entity.hw;
    p.hh = entity.hh;
    if (dx !== 0) {
      p.x = entity.x + dx;
      p.y = entity.y;
      if (this.isBlocked(p, entity, includeMap)) res.blockedX = true;
      else entity.x = p.x;
    }
    if (dy !== 0) {
      p.x = entity.x;
      p.y = entity.y + dy;
      if (this.isBlocked(p, entity, includeMap)) res.blockedY = true;
      else entity.y = p.y;
    }
    // Keep the broad phase valid for the rest of this tick (duplicates are de-duplicated on query).
    if (!res.blockedX || !res.blockedY) this.index.insert(entity);
    return res;
  }

  /** Re-inserts an entity that was teleported/moved without `move()`. */
  touch(entity: Entity): void {
    this.index.insert(entity);
  }

  /** Disposes everything (map shutdown). */
  clear(): void {
    for (const e of this.byId.values()) e.dispose();
    this.byId.clear();
    for (const kind of Object.keys(this.lists) as EntityKind[]) this.lists[kind].length = 0;
    this.index.clear();
  }

  all(): IterableIterator<Entity> {
    return this.byId.values();
  }
}
