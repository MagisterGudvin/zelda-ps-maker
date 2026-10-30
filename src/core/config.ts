import type { LogLevel } from "./logger.ts";
import type { DamageType, DropTable } from "./types.ts";
import type { AnimDef, SheetDef } from "./animation.ts";
import type { Facing } from "./math.ts";

/**
 * Central configuration. Every value has a safe default; authors override any
 * subset with JSON through `Zelda: Start Toolkit` / `Zelda: Configure`.
 * Durations are milliseconds, distances pixels, speeds pixels per second.
 */
export interface ToolkitConfig {
  language: "auto" | "en" | "ru";
  features: FeatureFlags;
  debug: {
    hitboxes: boolean;
    toggleKey: string;
    logLevel: LogLevel;
    /** Re-throw errors from editor actions after logging them (development aid). */
    rethrowErrors: boolean;
    /** On-screen diagnostics panel (positions, depths, recent log lines). */
    diagnostics: boolean;
    diagnosticsKey: string;
  };
  /** Sound effects: toolkit moment -> audio (Zelda: Set Sound). */
  audio: {
    enabled: boolean;
    volume: number;
    sounds: Record<string, { src: string; volume: number }>;
  };
  /** Author sprite sheets and animations (Zelda: Define Sprite Sheet / Define Animation). */
  sprites: {
    sheets: Record<string, SheetDef>;
    animations: Record<string, AnimDef>;
  };
  world: {
    positionUnits: "pixels" | "tiles";
    tileSize: number;
    /** Treat Arcade static bodies (PS Maker map collision rectangles) as walls. */
    useArcadeStaticBodies: boolean;
    /**
     * Toolkit solids (blocks, chests, doors, pots...) become Arcade static bodies that stop the
     * PS Maker player, so it never walks into them and gets pushed back (screen shake).
     */
    solidBodies: boolean;
    /** PS Maker NPCs (moving Arcade bodies, colliding since PS Maker 1.1) block enemies and projectiles. */
    npcsBlock: boolean;
    /**
     * "auto": follow PS Maker's own sorting — y-sorted when the player's depth
     * equals its y, otherwise the player's layer ± a tiny y offset.
     */
    depthMode: "auto" | "y" | "fixed";
    depthBase: number;
    fixedStepHz: number;
    maxStepsPerFrame: number;
    /** Ticks between rebuilding the cached index of map collision bodies. */
    collisionRefreshTicks: number;
  };
  controls: {
    sword: string[];
    useItem: string[];
    shield: string[];
    action: string[];
    nextItem: string[];
    prevItem: string[];
    inventory: string[];
    /** Opens and closes the pause menu (the UI screen with the role Menu); Escape takes it from PS Maker's options menu then. */
    menu: string[];
    /** Keys of the quick-use slots 1…9 (Slot elements of the HUD): each selects its slot's item. */
    hotbar: string[];
    /** Movement keys of the PS Maker controller, read only as a facing hint. */
    move: { up: string[]; down: string[]; left: string[]; right: string[] };
    gamepad: {
      enabled: boolean;
      sword: number;
      useItem: number;
      shield: number;
      action: number;
      nextItem: number;
      prevItem: number;
      inventory: number;
      menu: number;
    };
  };
  player: {
    /** Health is stored in points; `heartValue` points draw one heart. */
    heartValue: number;
    maxHealth: number;
    startHealth: number;
    maxHealthCap: number;
    invulnerableMs: number;
    knockbackSpeed: number;
    knockbackMs: number;
    /** Shrinks the player's hurtbox relative to the sprite/body (pixels per side). */
    hurtboxInset: number;
    lockMovementWhileAttacking: boolean;
    lockMovementWhileUsingItem: boolean;
    /** Turn toward held movement keys even when blocked by a wall. */
    facingFromInput: boolean;
    facingFromAnimation: boolean;
    deathBehavior: "respawn" | "none";
    respawnDelayMs: number;
    respawnHealth: number;
    maxMagic: number;
    startMagic: number;
    magicRegenPerSecond: number;
    startItems: string[];
    startCounts: Record<string, number>;
    /** Animation ids (from config.sprites) drawn over the PS Maker player sprite. Empty = not used. */
    sprites: {
      attack: string;
      spin: string;
      charge: string;
      hurt: string;
      weaponAttack: string;
      weaponSpin: string;
      weaponCharge: string;
      /** Walking while the sword is charged (e.g. Mana Seed "Sword Walk"); empty = PS Maker walk + built-in blade. */
      chargeWalk: string;
      /** Holding the shield up (shield on a button). */
      shield: string;
      /** Using items: bow, boomerang, placing a bomb; `item` = any other item and the fallback. */
      bow: string;
      boomerang: string;
      bomb: string;
      item: string;
      /** Lifting, carrying (walking with an object overhead), throwing, pushing a block. */
      lift: string;
      carry: string;
      throw: string;
      push: string;
      /** Holding up an item taken from a chest. */
      itemGet: string;
      death: string;
      /** Directions where the weapon layer is drawn behind the body (typical for Mana Seed: up). */
      weaponBehind: Facing[];
      /** Hide the PS Maker sprite while an overlay animation plays. */
      hidePlayer: boolean;
      offsetX: number;
      offsetY: number;
    };
  };
  sword: {
    enabled: boolean;
    damage: number;
    range: number;
    width: number;
    windupMs: number;
    activeMs: number;
    recoveryMs: number;
    /** Sweep the hitbox from the side to the front during the active phase. */
    sweep: boolean;
    /** "auto": show the built-in blade only when no attack animation is configured. */
    showBlade: "auto" | "always" | "never";
    /** Swing pivot offset from the player sprite's center (pixels). */
    pivotOffsetX: number;
    pivotOffsetY: number;
    maxHitsPerTarget: number;
    knockback: number;
    /** Ignore new presses until recovery ends; otherwise recovery can be cancelled. */
    lockUntilRecovered: boolean;
    charge: {
      enabled: boolean;
      chargeMs: number;
      spinDamageMultiplier: number;
      spinRadius: number;
      spinMs: number;
      pokeWhileCharging: boolean;
      pokeDamage: number;
    };
  };
  shield: {
    enabled: boolean;
    mode: "passive" | "hold";
    blocks: DamageType[];
    /** Cosine of the half-angle in front of the player that the shield covers. */
    frontalDot: number;
    /** Knockback (px/s) applied to the player when a block happens. */
    blockPushback: number;
  };
  combat: {
    enemyHitCooldownMs: number;
    flashMs: number;
    /** Global multipliers per damage type (applied before resistances). */
    damageTable: Partial<Record<DamageType, number>>;
    bombsHurtPlayer: boolean;
    /** Freeze enemies and projectiles while a PS Maker dialogue is open. */
    pauseDuringDialogue: boolean;
  };
  items: {
    bomb: { fuseMs: number; radius: number; damage: number; playerDamage: number; maxActive: number; knockback: number };
    boomerang: { speed: number; range: number; damage: number; stunMs: number; maxActive: number };
    bow: { speed: number; range: number; damage: number; maxActive: number };
    fireRod: { speed: number; range: number; damage: number; magicCost: number };
    healingSpell: { magicCost: number; heal: number };
    thrown: { speed: number; range: number; damage: number };
  };
  inventory: {
    capacities: Record<string, number>;
    /** Quick-use order; items not listed are appended in acquisition order. */
    order: string[];
    autoEquipFirst: boolean;
  };
  enemies: {
    /** AI decisions run every N ticks, staggered by enemy index. */
    thinkEveryTicks: number;
    deathFadeMs: number;
    alertMs: number;
    maxActive: number;
    dropLifetimeMs: number;
    defaultDrops: DropTable;
    /** Speed (px/s) an enemy bounces back with after touching the player. */
    contactRecoil: number;
  };
  interactions: {
    pushMs: number;
    liftMs: number;
    reachDistance: number;
    chestOpenFrom: "any" | "below";
    defaultDrops: DropTable;
  };
  ui: {
    enabled: boolean;
    /** Classic HUD (no UI Layout on the map): the magic meter is shown. */
    showMagic: boolean;
    /** Classic HUD: at the top or bottom of the screen ("top-left" etc. are read as top/bottom). */
    position: "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
    /** Layout pixel scale for layouts without their own; 0 = like the map (its camera zoom). */
    scale: number;
    messageMs: number;
    inventoryPanel: boolean;
    pauseWhileInventoryOpen: boolean;
  };

  /** Exposes `globalThis.ZeldaMakerToolkit` for extension plugins. */
  publicApi: boolean;
}

export type FeatureId =
  | "combat"
  | "items"
  | "inventory"
  | "enemies"
  | "interactions"
  | "puzzles"
  | "dungeons"
  | "ui"
  | "debugTools";

export type FeatureFlags = Record<FeatureId, boolean>;

export const FEATURE_IDS: readonly FeatureId[] = [
  "combat",
  "items",
  "inventory",
  "enemies",
  "interactions",
  "puzzles",
  "dungeons",
  "ui",
  "debugTools",
];

export function createDefaultConfig(): ToolkitConfig {
  return {
    language: "auto",
    features: {
      combat: true,
      items: true,
      inventory: true,
      enemies: true,
      interactions: true,
      puzzles: true,
      dungeons: true,
      ui: true,
      debugTools: true,
    },
    debug: { hitboxes: false, toggleKey: "F9", logLevel: "warn", rethrowErrors: false, diagnostics: false, diagnosticsKey: "F10" },
    sprites: { sheets: {}, animations: {} },
    audio: { enabled: true, volume: 1, sounds: {} },
    world: {
      positionUnits: "pixels",
      tileSize: 16,
      useArcadeStaticBodies: true,
      solidBodies: true,
      npcsBlock: true,
      depthMode: "auto",
      depthBase: 0,
      fixedStepHz: 60,
      maxStepsPerFrame: 5,
      collisionRefreshTicks: 120,
    },
    controls: {
      sword: ["KeyX"],
      useItem: ["KeyC"],
      shield: ["KeyV"],
      action: ["KeyZ"],
      nextItem: ["KeyE"],
      prevItem: ["KeyQ"],
      inventory: ["KeyI"],
      menu: ["Escape"],
      hotbar: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"],
      move: { up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"], left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"] },
      gamepad: { enabled: true, sword: 0, useItem: 2, shield: 5, action: 1, nextItem: 7, prevItem: 6, inventory: 9, menu: 8 },
    },
    player: {
      heartValue: 2,
      maxHealth: 6,
      startHealth: 6,
      maxHealthCap: 40,
      invulnerableMs: 970,
      knockbackSpeed: 180,
      knockbackMs: 150,
      hurtboxInset: 2,
      lockMovementWhileAttacking: true,
      lockMovementWhileUsingItem: true,
      facingFromInput: true,
      facingFromAnimation: false,
      deathBehavior: "respawn",
      respawnDelayMs: 1200,
      respawnHealth: 6,
      maxMagic: 32,
      startMagic: 32,
      magicRegenPerSecond: 0,
      startItems: ["sword"],
      startCounts: {},
      sprites: { attack: "", spin: "", charge: "", hurt: "", weaponAttack: "", weaponSpin: "", weaponCharge: "", chargeWalk: "", shield: "", bow: "", boomerang: "", bomb: "", item: "", lift: "", carry: "", throw: "", push: "", itemGet: "", death: "", weaponBehind: ["up"], hidePlayer: true, offsetX: 0, offsetY: 0 },
    },
    sword: {
      enabled: true,
      damage: 2,
      range: 18,
      width: 10,
      windupMs: 50,
      activeMs: 130,
      recoveryMs: 120,
      sweep: true,
      showBlade: "auto",
      pivotOffsetX: 0,
      pivotOffsetY: 0,
      maxHitsPerTarget: 1,
      knockback: 220,
      lockUntilRecovered: true,
      charge: {
        enabled: true,
        chargeMs: 800,
        spinDamageMultiplier: 2,
        spinRadius: 26,
        spinMs: 300,
        pokeWhileCharging: true,
        pokeDamage: 1,
      },
    },
    shield: { enabled: true, mode: "hold", blocks: ["projectile", "arrow", "contact"], frontalDot: 0.5, blockPushback: 60 },
    combat: {
      enemyHitCooldownMs: 250,
      flashMs: 250,
      damageTable: {},
      bombsHurtPlayer: true,
      pauseDuringDialogue: true,
    },
    items: {
      bomb: { fuseMs: 2600, radius: 26, damage: 4, playerDamage: 2, maxActive: 2, knockback: 260 },
      boomerang: { speed: 220, range: 110, damage: 0, stunMs: 2000, maxActive: 1 },
      bow: { speed: 300, range: 220, damage: 2, maxActive: 3 },
      fireRod: { speed: 200, range: 160, damage: 4, magicCost: 4 },
      healingSpell: { magicCost: 8, heal: 2 },
      thrown: { speed: 200, range: 64, damage: 2 },
    },
    inventory: {
      capacities: { bombs: 10, arrows: 30, rupees: 999 },
      order: ["bow", "boomerang", "bomb", "fire_rod", "healing_spell"],
      autoEquipFirst: true,
    },
    enemies: {
      thinkEveryTicks: 4,
      deathFadeMs: 300,
      alertMs: 300,
      maxActive: 64,
      dropLifetimeMs: 8000,
      contactRecoil: 140,
      defaultDrops: {
        chance: 0.4,
        entries: [
          { item: "heart", weight: 5 },
          { item: "rupees", count: 1, weight: 5 },
          { item: "rupees", count: 5, weight: 1 },
          { item: "magic", count: 8, weight: 2 },
          { item: "bombs", count: 1, weight: 2 },
          { item: "arrows", count: 5, weight: 2 },
        ],
      },
    },
    interactions: {
      pushMs: 400,
      liftMs: 200,
      reachDistance: 10,
      chestOpenFrom: "any",
      defaultDrops: {
        chance: 0.25,
        entries: [
          { item: "heart", weight: 3 },
          { item: "rupees", count: 1, weight: 4 },
          { item: "magic", count: 8, weight: 1 },
        ],
      },
    },
    ui: {
      enabled: true,
      showMagic: true,
      position: "top",
      scale: 0,
      messageMs: 2200,
      inventoryPanel: true,
      pauseWhileInventoryOpen: true,
    },
    publicApi: true,
  };
}

export interface ConfigIssue {
  path: string;
  message: string;
}

/**
 * Deep-merges `patch` into `target` in place, validating every key against the
 * shape of `target`. Unknown keys and type mismatches are reported and skipped
 * so a typo in an author's JSON never corrupts the defaults.
 *
 * Records whose default is an empty-or-open map (capacities, damageTable,
 * startCounts) accept new keys.
 */
export function mergeConfig(target: object, patch: unknown, path = "", issues: ConfigIssue[] = []): ConfigIssue[] {
  if (patch === undefined || patch === null) return issues;
  if (typeof patch !== "object" || Array.isArray(patch)) {
    issues.push({ path: path || "<root>", message: "expected an object" });
    return issues;
  }
  const t = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const keyPath = path ? `${path}.${key}` : key;
    const isOpenRecord = OPEN_RECORDS.has(path);
    if (!(key in t) && !isOpenRecord) {
      issues.push({ path: keyPath, message: "unknown option (ignored)" });
      continue;
    }
    const current = t[key];
    if (current === undefined && isOpenRecord) {
      t[key] = value;
      continue;
    }
    if (Array.isArray(current)) {
      if (!Array.isArray(value)) {
        issues.push({ path: keyPath, message: "expected an array" });
        continue;
      }
      t[key] = value.slice();
    } else if (current !== null && typeof current === "object") {
      mergeConfig(current, value, keyPath, issues);
    } else if (typeof current !== typeof value) {
      issues.push({ path: keyPath, message: `expected ${typeof current}, got ${typeof value}` });
    } else {
      t[key] = value;
    }
  }
  return issues;
}

const OPEN_RECORDS = new Set(["inventory.capacities", "combat.damageTable", "player.startCounts", "sprites.sheets", "sprites.animations", "audio.sounds"]);

/** Ready-made balance presets selectable from the editor. */
export const CONFIG_PRESETS: Record<string, unknown> = {
  alttp: {},
  casual: {
    player: { maxHealth: 10, startHealth: 10, invulnerableMs: 1400, respawnHealth: 10 },
    sword: { range: 22, charge: { chargeMs: 500 } },
    shield: { blocks: ["projectile", "arrow", "contact", "fire", "magic"] },
    combat: { bombsHurtPlayer: false },
  },
  hardcore: {
    player: { maxHealth: 4, startHealth: 4, invulnerableMs: 600, respawnHealth: 2 },
    sword: { damage: 1, lockUntilRecovered: true },
    enemies: { defaultDrops: { chance: 0.15 } },
  },
};
