import type { ToolkitConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { createDefaultState, createDungeonProgress, type DungeonProgress, type GameState } from "../core/state.ts";
import type { FlagValue } from "../core/events.ts";
import { TOOLKIT_VERSION } from "../core/version.ts";

/**
 * Toolkit progress as text: what Start Toolkit → Progress variable keeps in a PS Maker text
 * variable, so PS Maker's own save and load menus carry it. Versioned so a save made by an older
 * toolkit still loads with safe defaults for missing fields.
 */

export const SAVE_FORMAT = "zelda-maker-toolkit-save";
export const SAVE_VERSION = 1;

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  version: number;
  toolkitVersion: string;
  state: GameState;
}

/**
 * Migrations from version N to N+1. Version 1 is the first public format; each step receives the
 * raw (untrusted) state object of version N.
 */
const MIGRATIONS: Record<number, (state: Record<string, unknown>) => Record<string, unknown>> = {};

/** The progress as text; unchanged progress gives the same text. */
export function serializeProgress(state: GameState): string {
  const env: SaveEnvelope = { format: SAVE_FORMAT, version: SAVE_VERSION, toolkitVersion: TOOLKIT_VERSION, state };
  return JSON.stringify(env);
}

/** Parses, migrates and sanitizes saved progress; null (logged) for unusable text. */
export function parseProgress(raw: string, config: ToolkitConfig, logger: Logger): GameState | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    logger.error("Saved progress is not valid JSON; ignoring it.", err);
    return null;
  }
  const env = data as Partial<SaveEnvelope>;
  if (!env || env.format !== SAVE_FORMAT || typeof env.version !== "number") {
    logger.error("Saved progress has an unknown format; ignoring it.");
    return null;
  }
  if (env.version > SAVE_VERSION) {
    logger.error(`Saved progress version ${env.version} is newer than this toolkit supports (${SAVE_VERSION}); ignoring it.`);
    return null;
  }
  let state = (env.state ?? {}) as Record<string, unknown>;
  for (let v = env.version; v < SAVE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (step) state = step(state);
  }
  return sanitizeState(state, createDefaultState(config));
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
