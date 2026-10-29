import type { EnemyConfig } from "../enemies/templates.ts";
import type { Condition, RuleAction } from "../puzzles/ruleTypes.ts";

// ---- parameter definitions ----------------------------------------------------------------
// The editor is a constructor: settings are numbers with an explanation, checkboxes,
// dropdowns and PS Maker's own pickers (map point, path, area, variable, animation, key).
// Text is only asked for content: sign text, messages, item names.
// `label` is used by the official CLI templates but missing from the 0.0.3
// typings; it is passed through untyped and is harmless if ignored.

export const str = (label: string, description: string, defaultValue = "") => ({ type: "string" as const, label, description, defaultValue });
export const num = (label: string, description: string, defaultValue = 0) => ({ type: "number" as const, label, description, defaultValue });
export const bool = (label: string, description: string, defaultValue = false) => ({ type: "boolean" as const, label, description, defaultValue });
export const pos = (label: string, description: string) => ({ type: "position" as const, label, description });
export const npc = (label: string, description: string) => ({ type: "npc" as const, label, description });
export const img = (label: string, description: string) => ({ type: "image" as const, label, description });
export const audio = (label: string, description: string) => ({ type: "audio" as const, label, description });

// PS Maker's own field types, read from the PS Maker 1.2.1 runtime (StoryActions/api/types.ts,
// `ParamType`): the editor draws plugin parameters with the same widgets, which is why
// "position" showed two number inputs and "npc" a character dropdown. The 0.0.3 typings
// only list seven types, so these are cast to the closest one for TypeScript.

/** "map-position": X/Y with the editor's click-in-map picker button. Raw value `{ x, y }`. */
export const mapPos = (label: string, description: string) => ({ type: "map-position", label, description }) as unknown as ReturnType<typeof pos>;

/** "string-enum" with `ui: "dropdown"`. Raw value: the chosen option's value. */
export const choice = (label: string, description: string, options: readonly (string | readonly [string, string])[], defaultValue: string) =>
  ({
    type: "string-enum",
    ui: "dropdown",
    label,
    description,
    defaultValue,
    options: options.map((o) => (typeof o === "string" ? { label: o, value: o } : { value: o[0], label: o[1] })),
  }) as unknown as ReturnType<typeof str>;

/** "in-map-npc": an NPC placed on this map ("Spawned NPC"). Raw value: its inGameCharacterId. */
export const inMapNpc = (label: string, description: string) => ({ type: "in-map-npc", label, description, defaultValue: "" }) as unknown as ReturnType<typeof npc>;

/** "player-animation-picker": one of the player's PS Maker animations. Raw value: animation id. */
export const playerAnim = (label: string, description: string) => ({ type: "player-animation-picker", label, description, defaultValue: "" }) as unknown as ReturnType<typeof str>;

/** "map-rectangle-area": an area drawn on the map. Raw value `{ x, y, width, height }`. */
export const mapArea = (label: string, description: string) => ({ type: "map-rectangle-area", label, description }) as unknown as ReturnType<typeof pos>;

/** "path": points clicked on the map in order. Raw value `[{ x, y }, ...]`. */
export const mapPath = (label: string, description: string) => ({ type: "path", label, description }) as unknown as ReturnType<typeof pos>;

/** "string-enum-multi": several options. Raw value `string[]`. */
export const multi = (label: string, description: string, options: readonly (string | readonly [string, string])[]) =>
  ({
    type: "string-enum-multi",
    label,
    description,
    defaultValue: [],
    options: options.map((o) => (typeof o === "string" ? { label: o, value: o } : { value: o[0], label: o[1] })),
  }) as unknown as ReturnType<typeof pos>;

/** "variable": a dropdown of the project's variables. Raw value: variable id. */
export const variable = (label: string, description: string) => ({ type: "variable", label, description, defaultValue: "" }) as unknown as ReturnType<typeof str>;

/** "key-bindings": PS Maker's key picker. Raw value `[{ type: "key", key: "KeyX" } | { type: "control", controlId }]`. */
export const keys = (label: string, description: string) => ({ type: "key-bindings", label, description, defaultValue: [] }) as unknown as ReturnType<typeof pos>;

/** "animation": any PS Maker animation. Raw value: animation id. */
export const animation = (label: string, description: string) => ({ type: "animation", label, description, defaultValue: "" }) as unknown as ReturnType<typeof str>;

/** A point picked on the map, or null. */
export function pointOf(v: unknown): { x: number; y: number } | null {
  const o = v as { x?: unknown; y?: unknown } | null;
  return o && typeof o === "object" && typeof o.x === "number" && typeof o.y === "number" && Number.isFinite(o.x) && Number.isFinite(o.y) ? { x: o.x, y: o.y } : null;
}

/** Points of a path, or []. */
export function pathOf(v: unknown): { x: number; y: number }[] {
  return Array.isArray(v) ? v.map(pointOf).filter((p): p is { x: number; y: number } => p !== null) : [];
}

/**
 * An area drawn on the map as a top-left rectangle, or null. PS Maker saves the area's centre in
 * x/y (its area editor draws from x - width / 2), and a negative size when drawn backwards.
 */
export function areaOf(v: unknown): { x: number; y: number; width: number; height: number } | null {
  const o = v as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null;
  if (!o || typeof o !== "object") return null;
  const [x, y] = [o.x, o.y].map(Number);
  const [w, h] = [o.width, o.height].map((n) => Math.abs(Number(n)));
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x: x - w / 2, y: y - h / 2, width: w, height: h } : null;
}

/** Options of a multi-select ("string-enum-multi" saves a list). */
export function multiOf(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

// ---- option lists -------------------------------------------------------------------------

export const ENEMY_TEMPLATES = ["slime", "soldier", "spitter", "knight", "sentry", "ogre"] as const;
/** Enemy types made with Zelda: Define Enemy (slots instead of typed names). */
export const CUSTOM_ENEMY_SLOTS = [1, 2, 3, 4, 5, 6].map((n) => [`custom_enemy_${n}`, `Custom enemy ${n}`] as const);
export const TEMPLATE_OPTIONS = [...ENEMY_TEMPLATES, ...CUSTOM_ENEMY_SLOTS];

/** Items made with Zelda: Define Item. */
export const CUSTOM_ITEM_SLOTS = [1, 2, 3, 4].map((n) => [`custom_item_${n}`, `Custom item ${n}`] as const);

/** Everything that can be given, found in chests or placed on the ground. */
export const ITEM_OPTIONS = [
  ["rupees", "Rupees"],
  ["heart", "Heart (refill)"],
  ["heart_container", "Heart container (+1 max)"],
  ["magic", "Magic (refill)"],
  ["bombs", "Bombs"],
  ["arrows", "Arrows"],
  ["key", "Small key"],
  ["big_key", "Big Key"],
  ["map", "Dungeon map"],
  ["compass", "Compass"],
  ["sword", "Sword"],
  ["shield", "Shield"],
  ["glove", "Power glove (lift rocks)"],
  ["bomb", "Bomb bag (use bombs)"],
  ["boomerang", "Boomerang"],
  ["bow", "Bow"],
  ["fire_rod", "Fire rod"],
  ["healing_spell", "Healing spell"],
  ...CUSTOM_ITEM_SLOTS,
] as const;

/** Items the player equips or that can be switched off (abilities). */
export const ABILITY_OPTIONS = [["sword", "Sword"], ["shield", "Shield"], ["glove", "Power glove"], ["bomb", "Bombs"], ["boomerang", "Boomerang"], ["bow", "Bow"], ["fire_rod", "Fire rod"], ["healing_spell", "Healing spell"], ...CUSTOM_ITEM_SLOTS] as const;

export const RESOURCE_OPTIONS = [["rupees", "Rupees"], ["bombs", "Bombs"], ["arrows", "Arrows"], ["magic", "Magic"], ["key", "Small keys"]] as const;

/** Enemy groups by number (rules wait for a whole group). */
export const GROUP_OPTIONS = [["", "No group"], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), `Group ${n}`] as const)] as const;

export const DUNGEON_OPTIONS = [["", "Overworld (no dungeon)"], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`dungeon_${n}`, `Dungeon ${n}`] as const)] as const;


/** Template dropdown. */
export function templateOf(p: Record<string, unknown>, fallback: string): string {
  return textOf(p.template) || fallback;
}

// ---- reading values -------------------------------------------------------------------------
// PS Maker passes only the fields saved with the action: an action saved by an older
// plugin version has no value for newer fields, so every read falls back to a default.

export function numOr(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

export function boolOr(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

export function textOf(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

// ---- shared field groups ------------------------------------------------------------------

/** Conditions: every filled field must hold (empty = always). */
export const WHEN_FIELDS = {
  whenGroup: choice("When group defeated", "Every enemy of this group is beaten (Group of Create Enemy). / Побеждена вся группа врагов.", GROUP_OPTIONS, ""),
  whenObjectAt: mapPos("When object at", "Pick a switch, plate, lever, torch, chest or door on the map: it must be on / open / lit. / Объект включён или открыт."),
  whenObjectAt2: mapPos("…and object at", "Optional second object. / Второй объект."),
  whenVariable: variable("When variable is on", "A project variable that must be true (or not 0). / Переменная проекта включена."),
  whenItem: choice("When player has", "Item the player must have. / У игрока есть предмет.", [["", "—"], ...ITEM_OPTIONS], ""),
  whenBoss: bool("When boss defeated", "The boss of the current dungeon (Enter Dungeon) is beaten. / Побеждён босс подземелья.", false),
};

/** Actions: every filled field runs. */
export const THEN_FIELDS = {
  openDoorAt: mapPos("Open door at", "Pick a door on the map. / Открыть дверь."),
  revealAt: mapPos("Reveal object at", "Pick a hidden chest or passage on the map. / Показать скрытый объект."),
  turnOnVariable: variable("Turn on variable", "Set a project variable to true (or 1): PS Maker conditions can check it. / Включить переменную проекта."),
  giveItem: choice("Give item", "Item to give. / Выдать предмет.", [["", "—"], ...ITEM_OPTIONS], ""),
  giveCount: num("Item count", "How many to give (rupees, bombs, arrows...). / Сколько.", 1),
  message: str("Message", "Text to show. / Показать сообщение.", ""),
  spawnEnemy: choice("Spawn enemy", "Enemy to create. / Создать врага.", [["", "—"], ...TEMPLATE_OPTIONS], ""),
  spawnAt: mapPos("Spawn at", "Where the enemy appears. / Где появится."),
};

/** Enemy stat changes: 0 keeps the template value. */
export const STAT_FIELDS = {
  hp: num("Health", "Hit points; 0 = template value. / Здоровье (0 — как в шаблоне).", 0),
  damage: num("Damage", "Damage to the player; 0 = template value. / Урон (0 — как в шаблоне).", 0),
  speed: num("Speed", "Pixels per second; 0 = template value. / Скорость (0 — как в шаблоне).", 0),
};

/** Where a sprite-sheet picture sits relative to the enemy's hitbox (e.g. 64x64 Mana Seed frames). */
export const SPRITE_FIELDS = {
  spriteOffsetX: num("Sprite offset X", "Move the picture relative to the hitbox, pixels. / Сдвиг картинки по X.", 0),
  spriteOffsetY: num("Sprite offset Y", "e.g. -16 when the feet are low in a 64x64 frame. / Сдвиг картинки по Y.", 0),
  spriteScale: num("Sprite scale", "0 = template value (1). / Масштаб картинки.", 0),
};

export function buildWhen(p: Record<string, unknown>): Condition {
  const when: Condition = {};
  const group = textOf(p.whenGroup);
  if (group) when.enemiesDefeated = group;
  const points = [pointOf(p.whenObjectAt), pointOf(p.whenObjectAt2)].filter(Boolean);
  if (points.length) when.objectActiveAt = points;
  if (textOf(p.whenVariable)) when.variableOn = textOf(p.whenVariable);
  if (textOf(p.whenItem)) when.hasItem = textOf(p.whenItem);
  if (boolOr(p.whenBoss, false)) when.bossDefeated = true;
  return when;
}

export function buildThen(p: Record<string, unknown>): RuleAction[] {
  const then: RuleAction[] = [];
  const door = pointOf(p.openDoorAt);
  if (door) then.push({ openDoorAt: door });
  const hidden = pointOf(p.revealAt);
  if (hidden) then.push({ revealAt: hidden });
  if (textOf(p.turnOnVariable)) then.push({ setVariable: { id: textOf(p.turnOnVariable), value: true } });
  if (textOf(p.giveItem)) then.push({ giveItem: { item: textOf(p.giveItem), count: Math.max(1, Math.round(numOr(p.giveCount, 1))) } });
  if (textOf(p.message)) then.push({ message: textOf(p.message) });
  const spawnAt = pointOf(p.spawnAt);
  if (textOf(p.spawnEnemy)) then.push({ spawnEnemy: spawnAt ? { template: textOf(p.spawnEnemy), x: spawnAt.x, y: spawnAt.y } : { template: textOf(p.spawnEnemy), at: "" } });
  return then;
}

export function enemyStats(p: Record<string, unknown>): Partial<EnemyConfig> {
  const out: Partial<EnemyConfig> = {};
  const hp = numOr(p.hp, 0);
  const damage = numOr(p.damage, 0);
  const speed = numOr(p.speed, 0);
  if (hp > 0) out.hp = hp;
  if (damage > 0) out.damage = damage;
  if (speed > 0) {
    out.speed = speed;
    out.chaseSpeed = speed;
  }
  if (numOr(p.spriteOffsetX, 0)) out.spriteOffsetX = numOr(p.spriteOffsetX, 0);
  if (numOr(p.spriteOffsetY, 0)) out.spriteOffsetY = numOr(p.spriteOffsetY, 0);
  if (numOr(p.spriteScale, 0) > 0) out.spriteScale = numOr(p.spriteScale, 0);
  return out;
}

// ---- map objects of the project as a look ---------------------------------------------------

/**
 * Options of the "Look (map object)" dropdowns: "Built-in" plus the project's map object library.
 * PS Maker has no map object field for plugins, but its plugin registry keeps the action
 * definitions by reference, so the toolkit fills this list in the editor from the open project
 * (editorPreview.ts) and the dropdowns show the project's objects.
 */
export const MAP_OBJECT_OPTIONS: { label: string; value: string }[] = [{ label: "Built-in", value: "" }];

/** A dropdown of the project's map objects (raw value: the map object id; "" = built-in sprite). */
export const mapObjectField = (label: string, description: string) =>
  ({ type: "string-enum", ui: "dropdown", label, description, defaultValue: "", options: MAP_OBJECT_OPTIONS }) as unknown as ReturnType<typeof str>;

/** Refills MAP_OBJECT_OPTIONS in place; true when it changed. */
export function fillMapObjectOptions(objects: readonly { id: string; name: string }[] | undefined): boolean {
  return fillOptions(MAP_OBJECT_OPTIONS, objects);
}

/** Dialogue layouts of the project (gameUI.dialogLayouts); "" = the project's default layout. */
export const DIALOG_LAYOUT_OPTIONS: { label: string; value: string }[] = [{ label: "Default layout", value: "" }];
export const dialogLayoutField = (label: string, description: string) =>
  ({ type: "string-enum", ui: "dropdown", label, description, defaultValue: "", options: DIALOG_LAYOUT_OPTIONS }) as unknown as ReturnType<typeof str>;
export function fillDialogLayoutOptions(layouts: readonly { id: string; name: string }[] | undefined): boolean {
  return fillOptions(DIALOG_LAYOUT_OPTIONS, layouts);
}

/**
 * PS Maker 1.2.1 has no parameter type for these project lists, so the dropdown's options are
 * filled in place from the open project (the registry keeps the action definitions by reference).
 * Duplicate names get a number. True when the list changed.
 */
function fillOptions(target: { label: string; value: string }[], items: readonly { id: string; name: string }[] | undefined): boolean {
  const seen = new Map<string, number>();
  const next = [target[0]];
  for (const o of items ?? []) {
    if (!o?.id) continue;
    const n = (seen.get(o.name) ?? 0) + 1;
    seen.set(o.name, n);
    next.push({ label: n > 1 ? `${o.name} (${n})` : o.name || o.id, value: o.id });
  }
  if (next.length === target.length && next.every((o, i) => o.value === target[i].value && o.label === target[i].label)) return false;
  target.splice(0, target.length, ...next);
  return true;
}
