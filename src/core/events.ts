import type { Logger } from "./logger.ts";
import type { DamageType } from "./types.ts";
import type { Facing } from "./math.ts";

/**
 * Every event the toolkit emits. Names follow `zelda:<subsystem>:<verb>`.
 * Authors can also emit their own `zelda:custom:<name>` events from rules.
 */
/**
 * What a toolkit message is about (Zelda: Message Style picks which kinds go into the dialogue
 * box): a sign or an object's text, an item received, a hint (locked, need an item), a short note
 * (saved, rupees), or "box" (Show Message with "In a dialogue box").
 */
export type MessageKind = "sign" | "item" | "hint" | "info" | "box";

export interface ZeldaEventMap {
  "zelda:toolkit:started": { mapId: string };
  "zelda:toolkit:stopped": { mapId: string; reason: string };
  "zelda:player:attack": { kind: "sword" | "spin" | "poke"; facing: Facing };
  "zelda:player:charged": { facing: Facing };
  "zelda:player:takeDamage": { amount: number; type: DamageType; sourceId: string };
  "zelda:player:blocked": { type: DamageType; sourceId: string };
  "zelda:player:healthChanged": { hp: number; maxHp: number; delta: number };
  "zelda:player:magicChanged": { magic: number; maxMagic: number; delta: number };
  "zelda:player:died": { mapId: string };
  "zelda:player:respawned": { x: number; y: number };
  "zelda:item:used": { itemId: string };
  "zelda:item:failed": { itemId: string; reason: "noResource" | "cooldown" | "disabled" | "busy" | "maxActive" | "notOwned" };
  "zelda:item:collected": { itemId: string; count: number; total: number };
  "zelda:item:equipped": { itemId: string | null };
  "zelda:resource:changed": { resource: string; value: number; max: number };
  "zelda:ability:changed": { ability: string; enabled: boolean };
  "zelda:enemy:spawned": { enemyId: string; template: string; group: string };
  "zelda:enemy:damaged": { enemyId: string; amount: number; type: DamageType; hp: number };
  "zelda:enemy:blocked": { enemyId: string; type: DamageType };
  "zelda:enemy:stunned": { enemyId: string; ms: number };
  "zelda:enemy:defeated": { enemyId: string; template: string; group: string };
  "zelda:enemy:phaseChanged": { enemyId: string; phase: number };
  "zelda:boss:defeated": { enemyId: string; dungeonId: string | null };
  "zelda:object:damaged": { objectId: string; objectType: string; tool: DamageType };
  "zelda:object:destroyed": { objectId: string; objectType: string };
  "zelda:object:stateChanged": { objectId: string; objectType: string; state: string };
  "zelda:object:lifted": { objectId: string };
  "zelda:object:thrown": { objectId: string };
  "zelda:block:moved": { objectId: string; x: number; y: number };
  "zelda:bomb:exploded": { x: number; y: number };
  "zelda:switch:activated": { switchId: string; on: boolean };
  "zelda:chest:opened": { chestId: string; itemId: string | null; count: number };
  "zelda:door:unlocked": { doorId: string; lock: string };
  "zelda:door:opened": { doorId: string };
  "zelda:door:closed": { doorId: string };
  "zelda:flag:changed": { flag: string; value: FlagValue };
  "zelda:puzzle:progress": { puzzleId: string; step: number; total: number };
  "zelda:puzzle:failed": { puzzleId: string };
  "zelda:puzzle:solved": { puzzleId: string };
  "zelda:rule:fired": { ruleId: string; branch: "then" | "else" };
  "zelda:wave:started": { roomId: string; wave: number; total: number };
  "zelda:wave:cleared": { roomId: string };
  "zelda:dungeon:entered": { dungeonId: string };
  "zelda:dungeon:completed": { dungeonId: string };
  "zelda:message": { text: string; durationMs: number; kind?: MessageKind };
  "zelda:inventory:toggled": { open: boolean };
  [custom: `zelda:custom:${string}`]: Record<string, unknown>;
}

export type FlagValue = boolean | number | string;
export type ZeldaEventName = keyof ZeldaEventMap & string;
export type Handler<K extends ZeldaEventName> = (payload: ZeldaEventMap[K]) => void;
export type AnyHandler = (name: ZeldaEventName, payload: unknown) => void;
export type Unsubscribe = () => void;

/** Re-entrancy guard: rules may emit events that trigger rules again. */
const MAX_EMIT_DEPTH = 32;

/**
 * Synchronous typed event bus. Handlers are called in subscription order;
 * a throwing handler is logged and does not prevent the others from running.
 * Every `on` returns an unsubscribe function so owners can release listeners
 * deterministically on map shutdown.
 */
export class EventBus {
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  private readonly anyHandlers = new Set<AnyHandler>();
  private depth = 0;
  private readonly logger: Logger | null;

  constructor(logger: Logger | null = null) {
    this.logger = logger;
  }

  on<K extends ZeldaEventName>(name: K, handler: Handler<K>): Unsubscribe {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    const fn = handler as (payload: unknown) => void;
    set.add(fn);
    return () => this.offRaw(name, fn);
  }

  once<K extends ZeldaEventName>(name: K, handler: Handler<K>): Unsubscribe {
    const off = this.on(name, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends ZeldaEventName>(name: K, handler: Handler<K>): void {
    this.offRaw(name, handler as (payload: unknown) => void);
  }

  /** Observes every event (used by the rules engine and DOM bridge). */
  onAny(handler: AnyHandler): Unsubscribe {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  emit<K extends ZeldaEventName>(name: K, payload: ZeldaEventMap[K]): void {
    if (this.depth >= MAX_EMIT_DEPTH) {
      this.logger?.error(`Event "${name}" dropped: emit recursion deeper than ${MAX_EMIT_DEPTH}. Check rules that trigger each other.`);
      return;
    }
    this.depth++;
    try {
      const set = this.handlers.get(name);
      if (set) {
        for (const fn of set) {
          try {
            fn(payload);
          } catch (err) {
            this.logger?.error(`Handler for "${name}" threw:`, err);
          }
        }
      }
      for (const fn of this.anyHandlers) {
        try {
          fn(name, payload);
        } catch (err) {
          this.logger?.error(`Wildcard handler for "${name}" threw:`, err);
        }
      }
    } finally {
      this.depth--;
    }
  }

  listenerCount(name?: ZeldaEventName): number {
    if (name) return this.handlers.get(name)?.size ?? 0;
    let total = this.anyHandlers.size;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }

  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
  }

  private offRaw(name: string, fn: (payload: unknown) => void): void {
    const set = this.handlers.get(name);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) this.handlers.delete(name);
  }
}

/** Collects unsubscribe functions so a subsystem can release all of them at once. */
export class Subscriptions {
  private readonly list: Unsubscribe[] = [];

  add(off: Unsubscribe): void {
    this.list.push(off);
  }

  releaseAll(): void {
    while (this.list.length > 0) {
      const off = this.list.pop()!;
      off();
    }
  }

  get size(): number {
    return this.list.length;
  }
}
