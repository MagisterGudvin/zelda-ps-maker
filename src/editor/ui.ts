import type { PluginEvent } from "@ps-maker/plugin-api";

/**
 * How the actions look in the PS Maker editor, kept apart from what they do:
 * collapsible field groups, fields shown only when they apply, a summary next to the
 * action in the event list, search keywords, number limits and radio buttons.
 *
 * Every property used here is read by the PS Maker 1.2.1 editor for built-in and plugin
 * actions alike (docs/ENGINE_AUDIT.md, section 12): field `group` / `ui` / `min` / `max` /
 * `step` / `required` / `setPositionBtnLabel` / `setPathBtnLabel`, and on the action
 * `parameterVisibility`, `collapsedGroups`, `getPreview` and `meta.keywords`.
 */

type Params = Record<string, unknown>;

interface FieldUi {
  group?: string;
  min?: number;
  max?: number;
  step?: number;
  ui?: "radio" | "dropdown";
  required?: boolean;
  setPositionBtnLabel?: string;
  setPathBtnLabel?: string;
  /** Draw the value on the editor map (on by default for points and areas, off for paths). */
  showPreview?: boolean;
}

/** What the editor passes to getPreview: `resolveParam(key)` formats a field like the editor does. */
interface PreviewContext {
  resolveParam?: (key: string) => string | undefined;
}

export interface ActionUi {
  /** Extra words for the action search. Latin letters and digits only: the editor's search drops every other character (ENGINE_AUDIT, section 12). */
  keywords: string[];
  fields?: Record<string, FieldUi>;
  /** Field → shown only when this returns true (receives the current values with defaults). */
  visible?: Record<string, (p: Params) => boolean>;
  /** Groups closed when the action is opened. */
  collapsed?: string[];
  /** Short summary shown next to the action in the event list. */
  preview?: (p: Params, show: (key: string) => string | undefined) => string | undefined;
}

// ---- helpers ------------------------------------------------------------------------------

const set = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
const isPoint = (v: unknown) => !!v && typeof v === "object" && typeof (v as { x?: unknown }).x === "number";

/** Items counted in numbers (Count matters); the rest are owned or not. */
const COUNTABLE = new Set(["rupees", "bombs", "arrows", "magic", "key", "heart"]);
const countable = (item: unknown) => typeof item === "string" && COUNTABLE.has(item);

/** Object types whose "When used" settings do something. */
const ACTIVATABLE = new Set(["bush", "grass", "pot", "rock", "heavy_rock", "breakable", "bombable_wall", "lever", "button", "pressure_plate", "chest", "door", "torch", "reactive"]);
const SWITCHES = new Set(["lever", "button", "pressure_plate"]);
const HIT_BY_TOOLS = new Set(["reactive", "button", "breakable", "torch", "heavy_rock"]);

const join = (parts: (string | undefined | false)[], sep = ", ") => parts.filter(Boolean).join(sep) || undefined;

/** Fields shared by Add Rule, Run Actions, switch sequences and wave rooms. */
const WHEN_UI: Record<string, FieldUi> = {
  whenGroup: { group: "When" },
  whenObjectAt: { group: "When", setPositionBtnLabel: "Pick object" },
  whenObjectAt2: { group: "When", setPositionBtnLabel: "Pick object" },
  whenVariable: { group: "When" },
  whenItem: { group: "When" },
  whenBoss: { group: "When" },
};
const THEN_UI: Record<string, FieldUi> = {
  openDoorAt: { group: "Then", setPositionBtnLabel: "Pick door" },
  revealAt: { group: "Then", setPositionBtnLabel: "Pick object" },
  turnOnVariable: { group: "Then" },
  giveItem: { group: "Then" },
  giveCount: { group: "Then", min: 1, step: 1 },
  message: { group: "Then" },
  spawnEnemy: { group: "Then" },
  spawnAt: { group: "Then", setPositionBtnLabel: "Pick spawn point" },
};
const THEN_VISIBLE: Record<string, (p: Params) => boolean> = {
  giveCount: (p) => countable(p.giveItem),
  spawnAt: (p) => set(p.spawnEnemy),
};
const WHEN_VISIBLE: Record<string, (p: Params) => boolean> = {
  whenObjectAt2: (p) => isPoint(p.whenObjectAt),
};

function whenSummary(p: Params, show: (k: string) => string | undefined): string | undefined {
  return join(
    [
      set(p.whenGroup) && `${show("whenGroup")} defeated`,
      isPoint(p.whenObjectAt) && (isPoint(p.whenObjectAt2) ? "2 objects on" : "object on"),
      set(p.whenVariable) && `${show("whenVariable") ?? "variable"} on`,
      set(p.whenItem) && `has ${show("whenItem")}`,
      p.whenBoss === true && "boss defeated",
    ],
    " + ",
  );
}

function thenSummary(p: Params, show: (k: string) => string | undefined): string | undefined {
  return join([
    isPoint(p.openDoorAt) && "open door",
    isPoint(p.revealAt) && "reveal",
    set(p.turnOnVariable) && `${show("turnOnVariable") ?? "variable"} on`,
    set(p.giveItem) && `give ${countable(p.giveItem) && Number(p.giveCount) > 1 ? `${p.giveCount} ` : ""}${show("giveItem")}`,
    set(p.message) && `"${String(p.message).slice(0, 24)}"`,
    set(p.spawnEnemy) && `spawn ${show("spawnEnemy")}`,
  ]);
}

const STATS_UI: Record<string, FieldUi> = {
  hp: { group: "Stats", min: 0, step: 1 },
  damage: { group: "Stats", min: 0, step: 1 },
  speed: { group: "Stats", min: 0, step: 5 },
};

// ---- per action ---------------------------------------------------------------------------

/** Set Player Sprites fields that pick an animation. */
const PLAYER_ANIM_SLOTS = ["attack", "spin", "charge", "chargeWalk", "hurt", "death", "shield", "bow", "boomerang", "bomb", "item", "lift", "carry", "throw", "push", "itemGet"];

export const ACTION_UI: Record<string, ActionUi> = {
  "Zelda: Start Toolkit": {
    keywords: ["start", "setup", "settings", "init", "difficulty", "hud", "language"],
    fields: {
      difficulty: { ui: "radio" },
      hearts: { min: 1, max: 20, step: 1 },
      swordDamage: { min: 1, max: 20, step: 1 },
      hud: { group: "Interface" },
      magicBar: { group: "Interface" },
      hudBottom: { group: "Interface" },
      language: { group: "Interface", ui: "radio" },
      shieldButton: { group: "Game" },
      progressVariable: { group: "Game" },
      tileUnits: { group: "Debug" },
      debugHitboxes: { group: "Debug" },
      diagnostics: { group: "Debug" },
    },
    visible: { magicBar: (p) => p.hud !== false, hudBottom: (p) => p.hud !== false },
    collapsed: ["Debug"],
    preview: (p, show) => join([show("difficulty"), `${p.hearts ?? 3} hearts`, `sword ${p.swordDamage ?? 2}`]),
  },
  "Zelda: Set Controls": {
    keywords: ["keys", "controls", "keyboard", "bindings", "input", "gamepad"],
    preview: (p) => join(["sword", "useItem", "shield", "action", "nextItem", "prevItem", "inventory", "menu"].map((k) => set(p[k]) && k)),
  },
  "Zelda: Stop Toolkit": { keywords: ["stop", "disable", "shutdown"] },
  "Zelda: Pause Combat": {
    keywords: ["pause", "cutscene", "freeze", "combat"],
    preview: (p) => (p.paused === false ? "resume" : "pause"),
  },
  "Zelda: Debug": {
    keywords: ["debug", "hitbox", "diagnostics", "log"],
    preview: (p) => join([p.hitboxes !== false && "hitboxes", p.diagnostics === true && "diagnostics"]),
  },
  "Zelda: Create Enemy": {
    keywords: ["enemy", "monster", "spawn", "foe", "slime", "mob", "create enemy"],
    fields: {
      position: { setPositionBtnLabel: "Pick spawn point" },
      ...STATS_UI,
      patrol: { group: "Patrol", setPathBtnLabel: "Draw route", showPreview: true },
      walkAnimation: { group: "Animations" },
      attackAnimation: { group: "Animations" },
      hurtAnimation: { group: "Animations" },
      deathAnimation: { group: "Animations" },
      spriteOffsetX: { group: "Animations", step: 1 },
      spriteOffsetY: { group: "Animations", step: 1 },
      spriteScale: { group: "Animations", min: 0, step: 0.25 },
    },
    collapsed: ["Stats", "Patrol", "Animations"],
    preview: (p, show) => join([show("template") ?? "slime", set(p.group) && show("group"), isPoint(p.position) ? show("position") : "next to the player"]),
  },
  "Zelda: Enemy From NPC": {
    keywords: ["npc", "enemy", "character", "hostile"],
    fields: { npc: { required: true }, ...STATS_UI },
    collapsed: ["Stats"],
    preview: (_p, show) => join([show("npc"), show("template")], " → "),
  },
  "Zelda: Create Object": {
    keywords: ["object", "bush", "pot", "lever", "button", "plate", "block", "torch", "sign", "pit", "spikes", "rock", "switch", "crystal"],
    fields: {
      position: { required: true },
      text: {},
      reactsTo: {},
      turnOnVariable: { group: "When used" },
      openDoorAt: { group: "When used", setPositionBtnLabel: "Pick door" },
      revealAt: { group: "When used", setPositionBtnLabel: "Pick object" },
      look: { group: "Look and size" },
      lookUsed: { group: "Look and size" },
      sprite: { group: "Look and size" },
      width: { group: "Look and size", min: 0, step: 8 },
      height: { group: "Look and size", min: 0, step: 8 },
    },
    visible: {
      staysOn: (p) => SWITCHES.has(String(p.type)),
      reactsTo: (p) => HIT_BY_TOOLS.has(String(p.type)),
      text: (p) => p.type === "sign" || SWITCHES.has(String(p.type)) || p.type === "reactive",
      turnOnVariable: (p) => ACTIVATABLE.has(String(p.type)),
      openDoorAt: (p) => ACTIVATABLE.has(String(p.type)),
      revealAt: (p) => ACTIVATABLE.has(String(p.type)),
    },
    collapsed: ["Look and size"],
    preview: (p, show) => join([show("type") ?? "bush", isPoint(p.position) && show("position")]),
  },
  "Zelda: Create Chest": {
    keywords: ["chest", "treasure", "loot", "reward", "box"],
    fields: { position: { required: true }, count: { min: 1, step: 1 }, look: { group: "Look" }, lookOpen: { group: "Look" } },
    visible: { count: (p) => countable(p.item) },
    collapsed: ["Look"],
    preview: (p, show) => join([`${countable(p.item) && Number(p.count) > 1 ? `${p.count} ` : ""}${show("item") ?? "key"}`, p.requiresBigKey === true && "big chest", p.hidden === true && "hidden"]),
  },
  "Zelda: Create Door": {
    keywords: ["door", "gate", "shutter", "lock", "boss door"],
    fields: { position: { required: true }, lock: { ui: "radio" }, width: { group: "Look and size", min: 0, step: 8 }, height: { group: "Look and size", min: 0, step: 8 }, look: { group: "Look and size" }, lookOpen: { group: "Look and size" } },
    collapsed: ["Look and size"],
    preview: (p, show) => join([show("lock") ?? "small key", p.startOpen === true && "starts open"]),
  },
  "Zelda: Place Item": {
    keywords: ["item", "pickup", "key", "heart", "rupee", "drop", "collectible"],
    fields: { position: { required: true }, count: { min: 1, step: 1 }, look: { group: "Look" } },
    visible: { count: (p) => countable(p.item) },
    collapsed: ["Look"],
    preview: (p, show) => `${countable(p.item) && Number(p.count) > 1 ? `${p.count} ` : ""}${show("item") ?? "key"}`,
  },
  "Zelda: Change Object": {
    keywords: ["open", "close", "switch", "reveal"],
    fields: { objectAt: { required: true, setPositionBtnLabel: "Pick object" } },
    preview: (p, show) => join([show("operation") ?? "open", isPoint(p.objectAt) && show("objectAt")]),
  },
  "Zelda: Remove Target": {
    keywords: ["remove", "kill", "defeat", "destroy", "despawn"],
    fields: { objectAt: { setPositionBtnLabel: "Pick object" } },
    visible: { objectAt: (p) => !set(p.group) },
    preview: (p, show) => (set(p.group) ? show("group") : isPoint(p.objectAt) ? "object" : undefined),
  },
  "Zelda: Damage Target": {
    keywords: ["damage", "hurt", "hit", "attack"],
    fields: { objectAt: { setPositionBtnLabel: "Pick object" }, amount: { min: 1, step: 1 } },
    visible: { group: (p) => p.player !== true, objectAt: (p) => p.player !== true && !set(p.group) },
    preview: (p, show) => join([p.player === true ? "player" : set(p.group) ? show("group") : "object", `${p.amount ?? 1}`], " −"),
  },
  "Zelda: Add Rule": {
    keywords: ["rule", "condition", "puzzle", "when"],
    fields: { ...WHEN_UI, ...THEN_UI },
    visible: { ...WHEN_VISIBLE, ...THEN_VISIBLE },
    preview: (p, show) => join([whenSummary(p, show), thenSummary(p, show)], " → "),
  },
  "Zelda: Run Actions": {
    keywords: ["run", "if", "condition", "check", "branch"],
    fields: { ...WHEN_UI, ...THEN_UI },
    visible: { ...WHEN_VISIBLE, ...THEN_VISIBLE },
    preview: (p, show) => {
      const when = whenSummary(p, show);
      const then = thenSummary(p, show);
      return when ? join([`if ${when}`, then], " → ") : then;
    },
  },
  "Zelda: Create Switch Sequence": {
    keywords: ["sequence", "order", "switches", "puzzle"],
    fields: { order: { required: true, setPathBtnLabel: "Click switches in order", showPreview: true }, ...THEN_UI },
    visible: THEN_VISIBLE,
    preview: (p, show) => join([Array.isArray(p.order) && p.order.length ? `${p.order.length} switches` : undefined, thenSummary(p, show)], " → "),
  },
  "Zelda: Create Wave Room": {
    keywords: ["waves", "arena", "room"],
    fields: { area: { required: true }, delayMs: { min: 0, step: 100 }, ...THEN_UI },
    visible: THEN_VISIBLE,
    preview: (p, show) => join([show("area"), p.startAtOnce === true ? "at once" : "on enter", thenSummary(p, show)]),
  },
  "Zelda: Add Wave Enemy": {
    keywords: ["wave", "enemy", "spawn", "arena"],
    fields: { wave: { min: 1, max: 9, step: 1 }, position: { required: true, setPositionBtnLabel: "Pick spawn point" }, ...STATS_UI },
    collapsed: ["Stats"],
    preview: (p, show) => `wave ${p.wave ?? 1}: ${show("template") ?? "slime"}`,
  },
  "Zelda: Enter Dungeon": {
    keywords: ["dungeon", "keys", "small key", "big key", "map", "compass"],
    preview: (_p, show) => show("dungeonId") ?? "overworld",
  },
  "Zelda: Give Item": {
    keywords: ["give", "item", "reward", "add", "rupees", "bombs"],
    fields: { count: { min: 1, step: 1 } },
    visible: { count: (p) => countable(p.item) },
    preview: (p, show) => `${countable(p.item) && Number(p.count) > 1 ? `${p.count} ` : ""}${show("item") ?? "bombs"}`,
  },
  "Zelda: Spend Resource": {
    keywords: ["spend", "pay", "buy", "shop"],
    fields: { amount: { min: 1, step: 1 } },
    preview: (p, show) => `${p.amount ?? 1} ${show("resource") ?? "rupees"}`,
  },
  "Zelda: Remove Item": { keywords: ["remove", "take", "lose", "item"], preview: (_p, show) => show("item") },
  "Zelda: Equip Item": { keywords: ["equip", "select", "item", "slot"], preview: (_p, show) => show("item") },
  "Zelda: Change Player Stats": {
    keywords: ["health", "heal", "magic", "hearts"],
    preview: (p) =>
      join([
        Number(p.health) ? `${p.set === true ? "=" : Number(p.health) > 0 ? "+" : ""}${p.health} health` : undefined,
        Number(p.maxHealth) ? `${p.set === true ? "=" : "+"}${p.maxHealth} max` : undefined,
        Number(p.magic) ? `${p.set === true ? "=" : Number(p.magic) > 0 ? "+" : ""}${p.magic} magic` : undefined,
      ]),
  },
  "Zelda: Show Stat In Variable": {
    keywords: ["variable", "stat", "hud", "rupees", "counter", "sync"],
    fields: { variableId: { required: true } },
    visible: { item: (p) => p.stat === "selected" || p.stat === "owned" },
    preview: (_p, show) => join([show("stat"), show("variableId")], " → "),
  },
  "Zelda: Set Ability": {
    keywords: ["ability", "disable", "enable"],
    preview: (p, show) => `${show("ability") ?? "sword"} ${p.enabled === false ? "off" : "on"}`,
  },
  "Zelda: UI Layout": {
    keywords: ["hud", "ui", "interface", "designer", "layout", "hearts", "counter", "bar", "menu", "screen", "button", "skin"],
    fields: { layout: { group: "Data" } },
    collapsed: ["Data"],
    preview: (p) => {
      const text = typeof p.layout === "string" ? p.layout : "";
      const n = text ? (text.match(/"type":/g) ?? []).length : 0;
      const what = set(p.name) ? `screen "${String(p.name)}"` : "HUD";
      return text ? `${what}, ${n} elements` : set(p.name) ? `${what}, empty` : "classic HUD";
    },
  },
  "Zelda: Open UI Screen": {
    keywords: ["menu", "screen", "ui", "open", "pause", "shop"],
    fields: { name: { required: true } },
    preview: (p) => (set(p.name) ? String(p.name) : undefined),
  },
  "Zelda: Close UI Screen": {
    keywords: ["menu", "screen", "ui", "close", "back"],
    preview: (p) => (p.all === true ? "all" : "top screen"),
  },
  "Zelda: Message Style": {
    keywords: ["message", "dialogue", "dialog", "box", "text", "style", "sign"],
    preview: (p, show) => join([set(p.layout) ? show("layout") : "default layout", Array.isArray(p.kinds) ? `${p.kinds.length} kinds` : undefined]),
  },
  "Zelda: Show Message": {
    keywords: ["message", "text", "toast", "notification", "say"],
    fields: { durationMs: { min: 0, step: 100 } },
    visible: { durationMs: (p) => p.box !== true },
    preview: (p) => (set(p.text) ? `"${String(p.text).slice(0, 40)}"` : undefined),
  },
  "Zelda: Set Respawn Point": {
    keywords: ["respawn", "checkpoint"],
    fields: { position: { setPositionBtnLabel: "Pick respawn point" } },
    preview: (p, show) => (isPoint(p.position) ? show("position") : "current position"),
  },
  "Zelda: Respawn Player": { keywords: ["respawn", "revive", "death", "restart"] },
  "Zelda: Define Item": {
    keywords: ["item", "custom", "weapon", "magic", "rod", "wand", "define item"],
    fields: { cost: { min: 0, step: 1 }, damage: { min: 0, step: 1 }, stunMs: { min: 0, step: 100 }, heal: { min: 0, step: 1 } },
    visible: {
      cost: (p) => set(p.resource),
      damage: (p) => !(Number(p.heal) > 0),
      damageType: (p) => Number(p.damage) > 0 && !(Number(p.heal) > 0),
      area: (p) => Number(p.damage) > 0 && !(Number(p.heal) > 0),
      stunMs: (p) => Number(p.damage) > 0 && !(Number(p.heal) > 0),
    },
    preview: (p, show) => join([show("slot"), set(p.name) && String(p.name)], ": "),
  },
  "Zelda: Define Enemy": {
    keywords: ["enemy", "custom", "boss", "type"],
    fields: {
      look: { group: "Look" },
      ...STATS_UI,
      detectRange: { group: "Stats", min: 0, step: 8 },
      boss: { group: "Stats" },
      immuneTo: { group: "Stats" },
      spriteOffsetX: { group: "Look", step: 1 },
      spriteOffsetY: { group: "Look", step: 1 },
      spriteScale: { group: "Look", min: 0, step: 0.25 },
    },
    preview: (_p, show) => join([show("slot"), `based on ${show("basedOn") ?? "soldier"}`], ": "),
  },
  "Zelda: Set Player Sprites": {
    keywords: ["sprite", "animation", "attack", "mana seed", "shield", "bow", "lift", "carry", "push", "death"],
    fields: {
      ...Object.fromEntries(["shield", "bow", "boomerang", "bomb", "item"].map((k) => [k, { group: "Items and shield" }])),
      ...Object.fromEntries(["lift", "carry", "throw", "push", "itemGet"].map((k) => [k, { group: "Lifting, pushing, chests" }])),
      weaponAttack: { group: "Weapon layer" },
      weaponSpin: { group: "Weapon layer" },
      weaponCharge: { group: "Weapon layer" },
      behindUp: { group: "Weapon layer" },
      behindDown: { group: "Weapon layer" },
      behindLeft: { group: "Weapon layer" },
      behindRight: { group: "Weapon layer" },
      hidePlayer: { group: "Placement" },
      offsetX: { group: "Placement", step: 1 },
      offsetY: { group: "Placement", step: 1 },
      pivotX: { group: "Placement", step: 1 },
      pivotY: { group: "Placement", step: 1 },
    },
    visible: Object.fromEntries(
      ["behindUp", "behindDown", "behindLeft", "behindRight"].map((k) => [k, (p: Params) => set(p.weaponAttack) || set(p.weaponSpin) || set(p.weaponCharge)]),
    ),
    collapsed: ["Weapon layer", "Placement"],
    preview: (p, show) => {
      const others = PLAYER_ANIM_SLOTS.filter((k) => k !== "attack" && set(p[k])).length;
      return join([show("attack") && `attack: ${show("attack")}`, others > 0 && `+${others} more`]);
    },
  },
  "Zelda: Set Sound": {
    keywords: ["sound", "sfx", "audio", "effect"],
    fields: { volume: { min: 0, max: 1, step: 0.1 } },
    preview: (_p, show) => join([show("moment"), show("sound")], ": "),
  },
};

/** Applies the editor presentation to an action (keeps its behaviour untouched). */
export function withUi(e: PluginEvent<any>): PluginEvent<any> {
  const ui = ACTION_UI[e.name];
  if (!ui) return e;
  // Main fields first, then the groups (the editor places a group where its first field is).
  const entries = Object.entries(e.parameterDefs as Record<string, object>).map(([key, def]) => [key, { ...def, ...(ui.fields?.[key] ?? {}) }] as const);
  const defs: Record<string, object> = {};
  for (const [key, def] of entries) if (!(def as FieldUi).group) defs[key] = def;
  for (const [key, def] of entries) if ((def as FieldUi).group) defs[key] = def;
  const preview = ui.preview;
  return {
    ...e,
    parameterDefs: defs,
    meta: { category: "Zelda Maker Toolkit", keywords: ui.keywords },
    ...(ui.visible ? { parameterVisibility: ui.visible } : {}),
    ...(ui.collapsed ? { collapsedGroups: ui.collapsed } : {}),
    ...(preview
      ? {
          getPreview(params: Params, ctx?: PreviewContext) {
            const show = (key: string) => ctx?.resolveParam?.(key) ?? fallbackText((params ?? {})[key]);
            try {
              const text = preview(params ?? {}, show);
              return text ? { text } : undefined;
            } catch {
              return undefined;
            }
          },
        }
      : {}),
  } as PluginEvent<any>;
}

/** Text of a value when the editor's formatter is not available (tests, older editors). */
function fallbackText(v: unknown): string | undefined {
  if (!set(v)) return undefined;
  if (isPoint(v)) return `x: ${Math.round((v as { x: number }).x)}, y: ${Math.round((v as { y: number }).y)}`;
  if (typeof v === "object") return undefined;
  return String(v);
}
