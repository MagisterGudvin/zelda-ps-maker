import type { EnemyConfig } from "../enemies/templates.ts";
import type { Condition, RuleAction } from "../puzzles/ruleTypes.ts";

// ---- parameter definitions ----------------------------------------------------------------
// Forms never ask for JSON: choices are dropdowns (PS Maker's "string-enum", below),
// switches are checkboxes, and ids or lists are short text.
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

export const ENEMY_TEMPLATES = ["slime", "soldier", "spitter", "knight", "sentry", "ogre"] as const;

/** Template dropdown plus an optional custom name (from Define Enemy) that wins. */
export function templateOf(p: Record<string, unknown>, fallback: string): string {
  return textOf(p.customTemplate) || textOf(p.template) || fallback;
}

export const customTemplate = () => str("Custom template", "Optional: a name made with Zelda: Define Enemy; used instead of Template. / Свой шаблон.", "");

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

export function listOf(v: unknown): string[] {
  return textOf(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// ---- shared field groups ------------------------------------------------------------------

/** Conditions: every filled field must hold (empty = always). */
export const WHEN_FIELDS = {
  whenDefeated: str("When group defeated", "Every enemy of this group is beaten (Group of Create Enemy). / Побеждены все враги группы.", ""),
  whenActive: str("When objects active", "Object ids, comma-separated: switches and plates on, doors and chests open, torches lit. / Объекты включены или открыты.", ""),
  whenFlag: str("When flag set", "Flag name. / Флаг установлен.", ""),
  whenItem: str("When player has", "Item id, e.g. bow or big_key. / У игрока есть предмет.", ""),
  whenBoss: bool("When boss defeated", "The boss of the current dungeon (Enter Dungeon) is beaten. / Побеждён босс подземелья.", false),
};

/** Actions: every filled field runs. */
export const THEN_FIELDS = {
  openDoors: str("Open doors", "Door ids, comma-separated. / Открыть двери.", ""),
  reveal: str("Reveal", "Hidden object ids (chests, passages), comma-separated. / Показать скрытые объекты.", ""),
  setFlag: str("Set flag", "Flag to set. / Установить флаг.", ""),
  giveItem: str("Give item", "Item or resource id. / Выдать предмет.", ""),
  giveCount: num("Item count", "How many to give.", 1),
  message: str("Message", "Text to show. / Показать сообщение.", ""),
  spawnEnemy: str("Spawn enemy", "Enemy template to create, e.g. ogre. / Создать врага.", ""),
  spawnAt: str("Spawn at marker", "Marker id (Zelda: Place Marker) where it appears. / Маркер появления.", ""),
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
  if (textOf(p.whenDefeated)) when.enemiesDefeated = textOf(p.whenDefeated);
  if (listOf(p.whenActive).length) when.objectActive = listOf(p.whenActive);
  if (textOf(p.whenFlag)) when.flag = textOf(p.whenFlag);
  if (textOf(p.whenItem)) when.hasItem = textOf(p.whenItem);
  if (boolOr(p.whenBoss, false)) when.bossDefeated = true;
  return when;
}

export function buildThen(p: Record<string, unknown>): RuleAction[] {
  const then: RuleAction[] = [];
  if (listOf(p.openDoors).length) then.push({ openDoor: listOf(p.openDoors) });
  if (listOf(p.reveal).length) then.push({ reveal: listOf(p.reveal) });
  if (textOf(p.setFlag)) then.push({ setFlag: textOf(p.setFlag) });
  if (textOf(p.giveItem)) then.push({ giveItem: { item: textOf(p.giveItem), count: Math.max(1, Math.round(numOr(p.giveCount, 1))) } });
  if (textOf(p.message)) then.push({ message: textOf(p.message) });
  if (textOf(p.spawnEnemy)) then.push({ spawnEnemy: { template: textOf(p.spawnEnemy), at: textOf(p.spawnAt) } });
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
