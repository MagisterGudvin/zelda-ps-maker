import type { ToolkitConfig } from "./config.ts";
import type { FlagValue } from "./events.ts";

export interface DungeonProgress {
  keys: number;
  bigKey: boolean;
  map: boolean;
  compass: boolean;
  bossDefeated: boolean;
  completed: boolean;
}

export interface RespawnPoint {
  mapId: string;
  x: number;
  y: number;
}

/**
 * Persistent game progress. Survives map changes and is what the save system
 * serializes. Map-local runtime objects (enemies, projectiles) are not here.
 */
export interface GameState {
  player: {
    hp: number;
    maxHp: number;
    magic: number;
    maxMagic: number;
    respawn: RespawnPoint | null;
  };
  inventory: {
    /** Owned non-stackable items in acquisition order (sword, bow, ...). */
    owned: string[];
    /** Stackable resources (bombs, arrows, rupees, custom). */
    counts: Record<string, number>;
    /** Capacity overrides gained in game (bigger quiver...). */
    capacities: Record<string, number>;
    /** The item on the first item button (useItem, C). */
    activeItem: string | null;
    /** The item on the second item button (useItem2, B). */
    secondItem: string | null;
  };
  /** Abilities explicitly switched off by events (`false`). Missing = enabled. */
  abilities: Record<string, boolean>;
  flags: Record<string, FlagValue>;
  /** Persistent object states keyed by `<mapId>/<objectId>`. */
  objects: Record<string, string>;
  dungeons: Record<string, DungeonProgress>;
  currentDungeon: string | null;
  stats: { enemiesDefeated: number; deaths: number };
}

/** Bucket used for keys found outside any dungeon. */
export const OVERWORLD_DUNGEON = "overworld";

export function createDungeonProgress(): DungeonProgress {
  return { keys: 0, bigKey: false, map: false, compass: false, bossDefeated: false, completed: false };
}

export function createDefaultState(config: ToolkitConfig): GameState {
  const p = config.player;
  const maxHp = Math.max(1, Math.round(p.maxHealth));
  return {
    player: {
      hp: Math.max(1, Math.min(maxHp, Math.round(p.startHealth))),
      maxHp,
      magic: Math.max(0, Math.min(p.maxMagic, p.startMagic)),
      maxMagic: Math.max(0, p.maxMagic),
      respawn: null,
    },
    inventory: {
      owned: [],
      counts: {},
      capacities: {},
      activeItem: null,
      secondItem: null,
    },
    abilities: {},
    flags: {},
    objects: {},
    dungeons: {},
    currentDungeon: null,
    stats: { enemiesDefeated: 0, deaths: 0 },
  };
}

export function getDungeon(state: GameState, id: string | null): DungeonProgress {
  const key = id ?? OVERWORLD_DUNGEON;
  let d = state.dungeons[key];
  if (!d) {
    d = createDungeonProgress();
    state.dungeons[key] = d;
  }
  return d;
}

export function objectKey(mapId: string, objectId: string): string {
  return `${mapId}/${objectId}`;
}
