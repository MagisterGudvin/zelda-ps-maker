import type { AABB } from "./math.ts";

/**
 * Uniform-grid broad phase. Buckets are reused between rebuilds so a full
 * `clear()` + re-insert every tick allocates nothing once warmed up.
 * Queries de-duplicate items that span several cells with a query stamp.
 */
export class SpatialHash<T extends AABB> {
  private readonly cellSize: number;
  private readonly cells = new Map<number, T[]>();
  private readonly used: T[][] = [];
  private readonly stamps = new Map<T, number>();
  private stamp = 0;

  constructor(cellSize = 64) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): number {
    // Cantor-free packing: supports coordinates within +/- 32k cells.
    return ((cx + 32768) << 16) | ((cy + 32768) & 0xffff);
  }

  clear(): void {
    for (let i = 0; i < this.used.length; i++) this.used[i].length = 0;
    this.used.length = 0;
  }

  insert(item: T): void {
    const cs = this.cellSize;
    const x0 = Math.floor((item.x - item.hw) / cs);
    const x1 = Math.floor((item.x + item.hw) / cs);
    const y0 = Math.floor((item.y - item.hh) / cs);
    const y1 = Math.floor((item.y + item.hh) / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        if (bucket.length === 0) this.used.push(bucket);
        bucket.push(item);
      }
    }
  }

  /** Appends candidates overlapping the box's cells to `out` (no exact test). */
  query(box: AABB, out: T[]): T[] {
    const cs = this.cellSize;
    const x0 = Math.floor((box.x - box.hw) / cs);
    const x1 = Math.floor((box.x + box.hw) / cs);
    const y0 = Math.floor((box.y - box.hh) / cs);
    const y1 = Math.floor((box.y + box.hh) / cs);
    const stamp = ++this.stamp;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const item = bucket[i];
          if (this.stamps.get(item) === stamp) continue;
          this.stamps.set(item, stamp);
          out.push(item);
        }
      }
    }
    return out;
  }

  /** Drops stamp bookkeeping for removed items (call after clear on long sessions). */
  forget(item: T): void {
    this.stamps.delete(item);
  }
}
