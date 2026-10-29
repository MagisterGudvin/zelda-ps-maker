import type { Facing } from "../core/math.ts";
import type { DamageType, DropTable, LocalizedText } from "../core/types.ts";
import type { RuleAction } from "../puzzles/ruleTypes.ts";

export type ObjectType =
  | "bush"
  | "grass"
  | "pot"
  | "rock"
  | "heavy_rock"
  | "breakable"
  | "bombable_wall"
  | "lever"
  | "button"
  | "pressure_plate"
  | "block"
  | "chest"
  | "door"
  | "hidden_passage"
  | "torch"
  | "reactive"
  | "spikes"
  | "pit"
  | "sign";

export const OBJECT_TYPES: readonly ObjectType[] = [
  "bush",
  "grass",
  "pot",
  "rock",
  "heavy_rock",
  "breakable",
  "bombable_wall",
  "lever",
  "button",
  "pressure_plate",
  "block",
  "chest",
  "door",
  "hidden_passage",
  "torch",
  "reactive",
  "spikes",
  "pit",
  "sign",
];

export type DoorLock = "none" | "small_key" | "big_key" | "switch";
export type Activator = "player" | "block" | "enemy";

/** Requirements checked before an action-key interaction succeeds. */
export interface ObjectRequirements {
  item?: string;
  flag?: string;
  bigKey?: boolean;
}

/**
 * Complete, data-only description of an interactive object. Every field has
 * a per-type default (see PRESETS); authors override fields with JSON.
 */
export interface ObjectConfig {
  type: ObjectType;
  sprite: string;
  /** Sprite used in the "active" state (open, on, lit, pressed, destroyed). */
  activeSprite: string;
  width: number;
  height: number;
  solid: boolean;
  /** Starts hidden (revealed later by a rule or action). */
  hidden: boolean;
  /** Tools (damage types) that affect the object. */
  tools: DamageType[];
  /** Hits needed to destroy/activate with a tool. */
  durability: number;
  liftable: boolean;
  /** Item required to lift (e.g. "glove" for rocks). */
  liftRequires: string;
  /** Interaction with the action key. */
  actionable: boolean;
  requires: ObjectRequirements;
  persistent: boolean;
  /** Drop table when destroyed; null = none, undefined = the global default. */
  drops: DropTable | null | "default";
  /** Chest contents. */
  contents: { item: string; count: number } | null;
  lock: DoorLock;
  /** Door starts open (shutter doors that close when a fight starts). */
  startOpen: boolean;
  /** Doors with a small-key lock open when walked into (ALttP) instead of by action. */
  unlockOnTouch: boolean;
  /** Lever/button toggles on/off; otherwise it only turns on once. */
  toggle: boolean;
  plateMode: "hold" | "latch";
  activators: Activator[];
  pushDirections: Facing[];
  /** Max number of pushes (0 = unlimited). */
  pushLimit: number;
  /** Distance per push; 0 = world.tileSize. */
  pushDistance: number;
  hazardDamage: number;
  message: LocalizedText | null;
  /** Flag set when the object reaches its active state (opened, on, destroyed...). */
  setFlag: string;
  /** Custom event emitted as `zelda:custom:<emit>` on activation. */
  emit: string;
  onActivate: RuleAction[];
  onDeactivate: RuleAction[];
  tint: number | null;
  /** Picture drawn offset from the object's body (a map object look whose collision box is not centred). */
  spriteOffsetX: number;
  spriteOffsetY: number;
  /** Picture scale; 0 = fit an author image to the object size (map object looks use 1: natural size). */
  spriteScale: number;
  /** A destroyed object stays visible with its active sprite (a stump, shards) instead of vanishing. */
  keepWhenDestroyed: boolean;
}

const BASE: ObjectConfig = {
  type: "reactive",
  sprite: "obj_reactive",
  activeSprite: "obj_reactive_on",
  width: 16,
  height: 16,
  solid: true,
  hidden: false,
  tools: [],
  durability: 1,
  liftable: false,
  liftRequires: "",
  actionable: false,
  requires: {},
  persistent: false,
  drops: null,
  contents: null,
  lock: "none",
  startOpen: false,
  unlockOnTouch: true,
  toggle: false,
  plateMode: "hold",
  activators: ["player", "block"],
  pushDirections: ["up", "down", "left", "right"],
  pushLimit: 0,
  pushDistance: 0,
  hazardDamage: 1,
  message: null,
  setFlag: "",
  emit: "",
  onActivate: [],
  onDeactivate: [],
  tint: null,
  spriteOffsetX: 0,
  spriteOffsetY: 0,
  spriteScale: 0,
  keepWhenDestroyed: false,
};

const PRESETS: Record<ObjectType, Partial<ObjectConfig>> = {
  bush: { sprite: "obj_bush", activeSprite: "obj_stump", tools: ["sword", "spin", "bomb", "fire", "magic"], liftable: true, drops: "default" },
  grass: { sprite: "obj_grass", activeSprite: "obj_grass_cut", solid: false, tools: ["sword", "spin", "bomb", "fire"], drops: "default" },
  pot: { sprite: "obj_pot", activeSprite: "obj_shards", tools: ["bomb", "thrown"], liftable: true, drops: "default" },
  rock: { sprite: "obj_rock", activeSprite: "obj_shards", tools: ["bomb"], liftable: true, liftRequires: "glove" },
  heavy_rock: { sprite: "obj_heavy_rock", activeSprite: "obj_shards", width: 16, height: 16, tools: ["bomb"], durability: 2, liftable: false },
  breakable: { sprite: "obj_cracked", activeSprite: "obj_rubble", tools: ["bomb"], persistent: true },
  bombable_wall: { sprite: "obj_wall_cracked", activeSprite: "obj_wall_hole", tools: ["bomb"], persistent: true },
  lever: { sprite: "obj_lever_off", activeSprite: "obj_lever_on", actionable: true, toggle: true, persistent: true },
  button: { sprite: "obj_switch_off", activeSprite: "obj_switch_on", tools: ["sword", "spin", "arrow", "boomerang", "bomb", "fire", "magic"], toggle: true, persistent: true },
  pressure_plate: { sprite: "obj_plate_up", activeSprite: "obj_plate_down", solid: false, plateMode: "hold" },
  block: { sprite: "obj_block", activeSprite: "obj_block", persistent: true },
  chest: { sprite: "obj_chest", activeSprite: "obj_chest_open", actionable: true, persistent: true },
  door: { sprite: "obj_door", activeSprite: "obj_door_open", lock: "small_key", actionable: true, persistent: true },
  hidden_passage: { sprite: "obj_stairs", activeSprite: "obj_stairs", solid: false, hidden: true, persistent: true },
  torch: { sprite: "obj_torch", activeSprite: "obj_torch_lit", tools: ["fire"], persistent: false },
  reactive: {},
  spikes: { sprite: "obj_spikes", activeSprite: "obj_spikes", solid: false, hazardDamage: 1 },
  pit: { sprite: "obj_pit", activeSprite: "obj_pit", solid: false, hazardDamage: 1 },
  sign: { sprite: "obj_sign", activeSprite: "obj_sign", actionable: true },
};

export function isObjectType(v: unknown): v is ObjectType {
  return typeof v === "string" && (OBJECT_TYPES as readonly string[]).includes(v);
}

/** base <- preset(type) <- overrides; arrays/objects are deep-copied. */
export function resolveObjectConfig(type: ObjectType, overrides: Partial<ObjectConfig> = {}): ObjectConfig {
  const cfg = JSON.parse(JSON.stringify({ ...BASE, ...PRESETS[type] })) as ObjectConfig;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || k === "type") continue;
    (cfg as unknown as Record<string, unknown>)[k] = typeof v === "object" && v !== null ? JSON.parse(JSON.stringify(v)) : v;
  }
  cfg.type = type;
  return cfg;
}
