import type { Toolkit } from "../core/toolkit.ts";
import { createDefaultState, createDungeonProgress, type DungeonProgress, type GameState } from "../core/state.ts";
import type { FlagValue } from "../core/events.ts";

/** Storage backend (localStorage in the browser, a Map in tests). */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SAVE_FORMAT = "zelda-maker-toolkit-save";
export const SAVE_VERSION = 1;

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
  toolkitVersion: string;
  state: GameState;
}

/**
 * Migrations from version N to N+1. Version 1 is the first public format; the
 * pipeline exists so future changes never break old saves. Each step receives
 * the raw (untrusted) state object of version N.
 */
const MIGRATIONS: Record<number, (state: Record<string, unknown>) => Record<string, unknown>> = {};

export function createBrowserStorage(): SaveStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = "__zmt_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    // Private mode / disabled storage: saving is reported as unavailable.
    return null;
  }
}

export function createMemoryStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

/**
 * Serializes toolkit progress into its own versioned key. It never touches
 * PS Maker's data, so projects without the plugin are unaffected and old
 * toolkit saves load with safe defaults for missing fields.
 */
export class SaveManager {
  private readonly tk: Toolkit;
  private readonly storage: SaveStorage | null;

  constructor(tk: Toolkit, storage: SaveStorage | null) {
    this.tk = tk;
    this.storage = storage;
  }

  get available(): boolean {
    return this.storage !== null;
  }

  key(slot = this.tk.config.save.slot): string {
    return `${this.tk.config.save.storageKey}:${slot}`;
  }

  exists(slot?: string): boolean {
    return !!this.storage?.getItem(this.key(slot));
  }

  serialize(): string {
    const env: SaveEnvelope = {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      toolkitVersion: "0.1.0",
      state: this.tk.state,
    };
    return JSON.stringify(env);
  }

  save(slot?: string, options: { silent?: boolean } = {}): boolean {
    const tk = this.tk;
    if (!tk.config.features.save || !tk.config.save.enabled) return false;
    if (!this.storage) {
      tk.logger.warnOnce("save-unavailable", "Saving unavailable: no localStorage in this environment.");
      if (!options.silent) tk.bus.emit("zelda:message", { text: tk.i18n.t("msg.save_unavailable"), durationMs: 1500 });
      return false;
    }
    const name = slot ?? tk.config.save.slot;
    try {
      this.storage.setItem(this.key(name), this.serialize());
    } catch (err) {
      tk.logger.error("Saving failed (storage full or blocked):", err);
      return false;
    }
    tk.bus.emit("zelda:save:written", { slot: name });
    if (!options.silent) tk.bus.emit("zelda:message", { text: tk.i18n.t("msg.saved"), durationMs: 1200 });
    return true;
  }

  /** Called by gameplay milestones (chest, door, dungeon) when auto-save is on. */
  autoSave(reason: string): void {
    if (!this.tk.config.save.autoSave) return;
    if (this.save(undefined, { silent: true })) this.tk.logger.debug(`Auto-saved (${reason}).`);
  }

  load(options: { slot?: string; silent?: boolean } = {}): boolean {
    const tk = this.tk;
    if (!this.storage || !tk.config.features.save) return false;
    const name = options.slot ?? tk.config.save.slot;
    const raw = this.storage.getItem(this.key(name));
    if (!raw) return false;
    const state = this.parse(raw);
    if (!state) return false;
    tk.state = state;
    tk.markGameInitialized();
    tk.session?.onStateReplaced();
    tk.bus.emit("zelda:save:loaded", { slot: name });
    tk.bus.emit("zelda:player:healthChanged", { hp: state.player.hp, maxHp: state.player.maxHp, delta: 0 });
    if (!options.silent) tk.bus.emit("zelda:message", { text: tk.i18n.t("msg.loaded"), durationMs: 1200 });
    return true;
  }

  delete(slot?: string): void {
    const name = slot ?? this.tk.config.save.slot;
    this.storage?.removeItem(this.key(name));
    this.tk.bus.emit("zelda:save:reset", { slot: name });
  }

  /** Parses, migrates and sanitizes; returns null (logged) for unusable data. */
  parse(raw: string): GameState | null {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      this.tk.logger.error("Save data is not valid JSON; ignoring it.", err);
      return null;
    }
    const env = data as Partial<SaveEnvelope>;
    if (!env || env.format !== SAVE_FORMAT || typeof env.version !== "number") {
      this.tk.logger.error("Save data has an unknown format; ignoring it.");
      return null;
    }
    if (env.version > SAVE_VERSION) {
      this.tk.logger.error(`Save version ${env.version} is newer than this toolkit supports (${SAVE_VERSION}); ignoring it.`);
      return null;
    }
    let state = (env.state ?? {}) as Record<string, unknown>;
    for (let v = env.version; v < SAVE_VERSION; v++) {
      const step = MIGRATIONS[v];
      if (step) state = step(state);
    }
    return sanitizeState(state, createDefaultState(this.tk.config));
  }
}

// ---- sanitizing: every field is validated and falls back to the default ---------------

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function numOr(v: unknown, d: number, min = -Infinity, max = Infinity): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (typeof x === "number" && Number.isFinite(x)) out[k] = Math.max(0, Math.round(x));
  return out;
}

export function sanitizeState(raw: Record<string, unknown>, defaults: GameState): GameState {
  const s = defaults;
  const p = isObj(raw.player) ? raw.player : {};
  s.player.maxHp = Math.round(numOr(p.maxHp, s.player.maxHp, 1, 999));
  s.player.hp = Math.round(numOr(p.hp, s.player.hp, 0, s.player.maxHp));
  // A save made at 0 HP must not load into an instant death loop.
  if (s.player.hp <= 0) s.player.hp = Math.min(s.player.maxHp, defaults.player.hp || 1);
  s.player.maxMagic = numOr(p.maxMagic, s.player.maxMagic, 0, 999);
  s.player.magic = numOr(p.magic, s.player.magic, 0, s.player.maxMagic);
  if (isObj(p.respawn) && typeof p.respawn.mapId === "string") {
    s.player.respawn = { mapId: p.respawn.mapId, x: numOr(p.respawn.x, 0), y: numOr(p.respawn.y, 0) };
  }

  const inv = isObj(raw.inventory) ? raw.inventory : {};
  s.inventory.owned = [...new Set(strArray(inv.owned))];
  s.inventory.counts = numRecord(inv.counts);
  s.inventory.capacities = numRecord(inv.capacities);
  s.inventory.activeItem = typeof inv.activeItem === "string" && s.inventory.owned.includes(inv.activeItem) ? inv.activeItem : null;

  if (isObj(raw.abilities)) for (const [k, v] of Object.entries(raw.abilities)) if (v === false) s.abilities[k] = false;
  if (isObj(raw.flags)) {
    for (const [k, v] of Object.entries(raw.flags)) {
      if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") s.flags[k] = v as FlagValue;
    }
  }
  if (isObj(raw.objects)) for (const [k, v] of Object.entries(raw.objects)) if (typeof v === "string") s.objects[k] = v;
  if (isObj(raw.dungeons)) {
    for (const [id, d] of Object.entries(raw.dungeons)) {
      if (!isObj(d)) continue;
      const base: DungeonProgress = createDungeonProgress();
      base.keys = Math.round(numOr(d.keys, 0, 0, 99));
      base.bigKey = d.bigKey === true;
      base.map = d.map === true;
      base.compass = d.compass === true;
      base.bossDefeated = d.bossDefeated === true;
      base.completed = d.completed === true;
      s.dungeons[id] = base;
    }
  }
  s.currentDungeon = typeof raw.currentDungeon === "string" ? raw.currentDungeon : null;
  const stats = isObj(raw.stats) ? raw.stats : {};
  s.stats.enemiesDefeated = Math.round(numOr(stats.enemiesDefeated, 0, 0));
  s.stats.deaths = Math.round(numOr(stats.deaths, 0, 0));
  return s;
}
