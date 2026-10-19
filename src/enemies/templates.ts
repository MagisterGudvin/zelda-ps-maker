import type { DamageType, DropTable } from "../core/types.ts";
import type { Vec2 } from "../core/math.ts";

export type BehaviorId = "melee" | "shooter" | "guardian" | "patroller" | "miniboss";

export interface EnemyProjectileConfig {
  speed: number;
  damage: number;
  range: number;
  type: DamageType;
  blockable: boolean;
  sprite: string;
  /** Number of projectiles per volley (bursts fan out evenly). */
  count: number;
}

export interface EnemyPhase {
  /** Phase starts when hp / maxHp drops below this fraction. */
  hpBelow: number;
  speedMultiplier: number;
  cooldownMultiplier: number;
  pattern: "chase" | "burst" | "summon";
  burstCount: number;
  summonTemplate: string;
  summonMax: number;
}

/** Full enemy definition. Templates provide defaults, spawns override any field. */
export interface EnemyConfig {
  template: string;
  behavior: BehaviorId;
  sprite: string;
  tint: number | null;
  width: number;
  height: number;
  hp: number;
  /** Contact damage dealt to the player. */
  damage: number;
  contactDamage: boolean;
  speed: number;
  chaseSpeed: number;
  detectRange: number;
  loseRange: number;
  attackRange: number;
  attackCooldownMs: number;
  windupMs: number;
  attackMs: number;
  lungeSpeed: number;
  preferredDistance: number;
  lineOfSight: boolean;
  /** 0..1, fraction of knockback ignored. */
  knockbackResist: number;
  hurtMs: number;
  /** Multiplier per damage type (0 = immune). */
  resistances: Partial<Record<DamageType, number>>;
  stunImmune: boolean;
  drops: DropTable | null;
  projectile: EnemyProjectileConfig;
  /** `points` may also list marker ids (strings) when given as overrides; spawnEnemy resolves them. */
  patrol: { mode: "wander" | "path"; points: Vec2[]; radius: number; pauseMs: number; chase: boolean };
  guard: { upMs: number; downMs: number; frontalDot: number; breakers: DamageType[] };
  phases: EnemyPhase[];
  boss: boolean;
  /** Stay defeated after leaving and re-entering the map. */
  persistent: boolean;
  /** Extra tags for author rules. */
  tags: string[];
}

const BASE: EnemyConfig = {
  template: "base",
  behavior: "melee",
  sprite: "enemy_slime",
  tint: null,
  width: 14,
  height: 14,
  hp: 2,
  damage: 1,
  contactDamage: true,
  speed: 30,
  chaseSpeed: 45,
  detectRange: 90,
  loseRange: 160,
  attackRange: 22,
  attackCooldownMs: 1200,
  windupMs: 350,
  attackMs: 220,
  lungeSpeed: 150,
  preferredDistance: 70,
  lineOfSight: true,
  knockbackResist: 0,
  hurtMs: 160,
  resistances: { boomerang: 1 },
  stunImmune: false,
  drops: null,
  projectile: { speed: 140, damage: 2, range: 200, type: "projectile", blockable: true, sprite: "enemy_shot", count: 1 },
  patrol: { mode: "wander", points: [], radius: 48, pauseMs: 700, chase: true },
  guard: { upMs: 1800, downMs: 1200, frontalDot: 0.3, breakers: ["bomb", "fire", "spin"] },
  phases: [],
  boss: false,
  persistent: false,
  tags: [],
};

/** Original placeholder enemy set (names and art are not Nintendo assets). */
const BUILTIN: Record<string, Partial<EnemyConfig>> = {
  slime: { behavior: "melee", sprite: "enemy_slime", hp: 2, damage: 1, speed: 25, chaseSpeed: 40, attackRange: 20, lungeSpeed: 130 },
  soldier: { behavior: "melee", sprite: "enemy_soldier", hp: 4, damage: 2, speed: 35, chaseSpeed: 60, detectRange: 110, attackRange: 24 },
  spitter: {
    behavior: "shooter",
    sprite: "enemy_spitter",
    hp: 3,
    damage: 1,
    speed: 30,
    chaseSpeed: 35,
    detectRange: 130,
    attackRange: 130,
    attackCooldownMs: 1600,
    windupMs: 400,
    preferredDistance: 70,
  },
  knight: {
    behavior: "guardian",
    sprite: "enemy_knight",
    hp: 6,
    damage: 2,
    speed: 25,
    chaseSpeed: 40,
    knockbackResist: 0.5,
    resistances: { arrow: 0.5, boomerang: 1 },
  },
  sentry: {
    behavior: "patroller",
    sprite: "enemy_sentry",
    hp: 3,
    damage: 1,
    speed: 40,
    patrol: { mode: "wander", points: [], radius: 48, pauseMs: 500, chase: false },
  },
  ogre: {
    behavior: "miniboss",
    sprite: "enemy_ogre",
    width: 26,
    height: 26,
    hp: 24,
    damage: 2,
    speed: 30,
    chaseSpeed: 45,
    detectRange: 200,
    loseRange: 400,
    attackRange: 40,
    attackCooldownMs: 1800,
    windupMs: 500,
    attackMs: 350,
    lungeSpeed: 190,
    knockbackResist: 0.8,
    stunImmune: true,
    lineOfSight: false,
    boss: true,
    persistent: true,
    projectile: { speed: 120, damage: 2, range: 220, type: "projectile", blockable: true, sprite: "enemy_shot", count: 8 },
    phases: [
      { hpBelow: 0.66, speedMultiplier: 1.2, cooldownMultiplier: 0.9, pattern: "burst", burstCount: 8, summonTemplate: "", summonMax: 0 },
      { hpBelow: 0.33, speedMultiplier: 1.5, cooldownMultiplier: 0.7, pattern: "summon", burstCount: 8, summonTemplate: "slime", summonMax: 2 },
    ],
    drops: { chance: 1, entries: [{ item: "heart_container", weight: 1 }] },
  },
};

/**
 * Enemy templates by name. Authors add templates with JSON
 * (`Zelda: Define Enemy`) and extension plugins via the public API.
 */
export class EnemyTemplateRegistry {
  private readonly templates = new Map<string, Partial<EnemyConfig>>();

  constructor() {
    for (const [name, t] of Object.entries(BUILTIN)) this.templates.set(name, t);
  }

  define(name: string, template: Partial<EnemyConfig> & { extends?: string }): void {
    const parent = template.extends ? this.templates.get(template.extends) : undefined;
    const merged = parent ? { ...parent, ...template } : { ...template };
    delete (merged as { extends?: string }).extends;
    this.templates.set(name, merged);
  }

  has(name: string): boolean {
    return this.templates.has(name);
  }

  names(): string[] {
    return [...this.templates.keys()];
  }

  /** Builds a complete config: base <- template <- overrides (nested objects merged). */
  resolve(name: string, overrides: Partial<EnemyConfig> = {}): EnemyConfig | null {
    const t = this.templates.get(name);
    if (!t) return null;
    const cfg = mergeEnemy(mergeEnemy(cloneBase(), t), overrides);
    cfg.template = name;
    return cfg;
  }
}

function cloneBase(): EnemyConfig {
  return JSON.parse(JSON.stringify(BASE)) as EnemyConfig;
}

const NESTED: (keyof EnemyConfig)[] = ["projectile", "patrol", "guard", "resistances"];

function mergeEnemy(target: EnemyConfig, patch: Partial<EnemyConfig>): EnemyConfig {
  for (const [k, v] of Object.entries(patch) as [keyof EnemyConfig, unknown][]) {
    if (v === undefined) continue;
    if (NESTED.includes(k) && v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(target[k] as object, JSON.parse(JSON.stringify(v)));
    } else {
      (target as unknown as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(v));
    }
  }
  return target;
}
