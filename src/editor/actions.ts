import { defineEvent, type PluginContext, type PluginEvent } from "@ps-maker/plugin-api";
import type { Session } from "../core/session.ts";
import type { Toolkit } from "../core/toolkit.ts";
import { parseJsonObject } from "../core/config.ts";
import { DAMAGE_TYPES, type DamageType } from "../core/types.ts";
import { makeDamage, isDamageable } from "../combat/combat.ts";
import { spawnEnemy } from "../enemies/spawn.ts";
import type { EnemyConfig } from "../enemies/templates.ts";
import { Enemy } from "../enemies/enemy.ts";
import { Interactable, type ObjectState } from "../interactions/interactable.ts";
import { createObject, placePickup } from "../interactions/spawnObject.ts";
import type { ObjectConfig } from "../interactions/objectTypes.ts";
import { createDataItem, type DataItemSpec } from "../items/builtinItems.ts";
import { changeHealth, changeMagic, setHealth, setMaxHealth } from "../player/health.ts";
import type { RuleAction, RuleSpec } from "../puzzles/ruleTypes.ts";
import type { WaveRoomSpec } from "../dungeons/dungeonSystem.ts";
import { deriveMapId, ensureSession, getToolkit, sessionMismatch, startSession } from "./runtime.ts";
import { parseFlagValue, parseJsonValue, pickAudioSource, pickImageSource, resolveImage, resolveNpc, resolvePosition } from "./paramResolvers.ts";
import { SOUND_EVENTS } from "../ui/sound.ts";
import { type AnimDef, validateAnim } from "../core/animation.ts";
import { type Facing, isFacing } from "../core/math.ts";
import { audio, bool, boolOr, buildThen, buildWhen, enemyStats, img, listOf, npc, num, numOr, pos, SPRITE_FIELDS, STAT_FIELDS, str, textOf, THEN_FIELDS, WHEN_FIELDS } from "./fields.ts";

type Ctx = PluginContext;

/**
 * Runs an action body with error handling. Errors are logged with the action
 * name; with `debug.rethrowErrors` they are re-thrown for development.
 */
/** Short JSON of what PS Maker passed (game objects abbreviated) for diagnostics. */
function describeParams(params: unknown): string {
  try {
    return JSON.stringify(params, (_k, v) => (v && typeof v === "object" && typeof (v as { setVisible?: unknown }).setVisible === "function" ? `[GameObject ${(v as { name?: string }).name ?? ""}]` : v)).slice(0, 200);
  } catch {
    return String(params);
  }
}

function run(name: string, ctx: Ctx, params: unknown, body: (s: Session, tk: Toolkit) => void): void {
  const tk = getToolkit();
  tk.noteAction(name.replace("Zelda: ", ""));
  tk.logger.info(`${name.replace("Zelda: ", "")} ${describeParams(params)}`);
  try {
    body(ensureSession(ctx), tk);
  } catch (err) {
    tk.logger.error(`Action "${name}" failed:`, err);
    if (tk.config.debug.rethrowErrors) throw err;
  }
}

function json<T>(s: Session, text: string, what: string): T | null {
  const { value, error } = parseJsonValue(text);
  if (error) {
    s.logger.warn(`${what}: invalid JSON (${error}).`);
    return null;
  }
  return (value ?? null) as T | null;
}

/**
 * Actions saved before 0.5.0 may still carry a JSON field that the form no longer
 * shows. It keeps working (so old projects do not silently change) and asks the
 * author to re-open the action.
 */
function legacy<T>(s: Session, params: unknown, key: string, what: string): T | null {
  const text = (params as Record<string, unknown>)[key];
  if (typeof text !== "string" || !text.trim() || text.trim() === "[]") return null;
  s.logger.warnOnce(`legacy-${what}-${key}`, `${what}: uses the old JSON field "${key}" — re-open the action in the editor and use the new fields.`);
  return json<T>(s, text, `${what} ${key}`);
}

function asList<T>(v: T | T[] | null): T[] {
  return v === null ? [] : Array.isArray(v) ? v : [v];
}

function where(s: Session, position: unknown, what: string): { x: number; y: number } | null {
  const p = resolvePosition(position, s.config);
  if (p && p.x === 0 && p.y === 0) s.logger.warn(`${what}: Position is X 0, Y 0 — was it left unset? Tip: F9 in playtest, then click the map to get coordinates.`);
  if (p) return p;
  s.logger.warn(`${what}: no valid position (got ${JSON.stringify(position)}).`);
  return null;
}

/** "walk=a, attack=b" or {"walk":"a"} → animation map; null when empty. */
function parseAnimationMap(text: string): Record<string, string> | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    const { value } = parseJsonValue(t);
    return value && typeof value === "object" ? (value as Record<string, string>) : null;
  }
  const out: Record<string, string> = {};
  for (const part of t.split(",")) {
    const [k, v] = part.split("=").map((x) => x.trim());
    if (k && v) out[k] = v;
  }
  return out;
}

function damageType(v: string): DamageType {
  return (DAMAGE_TYPES as readonly string[]).includes(v) ? (v as DamageType) : "script";
}

function objectById(s: Session, id: string, what: string): Interactable | null {
  const e = s.world.get(id);
  if (e instanceof Interactable) return e;
  s.logger.warn(`${what}: object "${id}" not found on map "${s.mapId}".`);
  return null;
}

// ---- lifecycle & configuration -------------------------------------------------------------

const DIFFICULTY_PRESETS = ["casual", "casual", "alttp", "hardcore"];

const startToolkit = defineEvent({
  name: "Zelda: Start Toolkit",
  description: "Starts Zelda Maker Toolkit on this map with the main game settings. Put it first in the map's start events (same settings on every map). / Запускает Toolkit на карте (первым в событиях начала карты).",
  parameterDefs: {
    mapId: str("Map ID", "Unique map name used to remember chests, doors and switches. / Уникальное имя карты для сохранения прогресса.", ""),
    difficulty: num("Difficulty", "1 = easy (longer invulnerability and sword, shield blocks magic, own bombs harmless), 2 = normal, 3 = hard (short invulnerability, fewer drops). / Сложность: 1 лёгкая, 2 обычная, 3 сложная.", 2),
    hearts: num("Hearts", "Starting and maximum hearts. / Сердца в начале игры.", 3),
    swordDamage: num("Sword damage", "Damage of one sword hit (a slime has 2 HP). / Урон меча.", 2),
    hud: bool("Show HUD", "Hearts, item and counters on screen. Turn off if you build your own UI with PS Maker UI components. / Показывать интерфейс Toolkit.", true),
    magicBar: bool("Magic bar", "Show the magic meter (needed for magic items). / Шкала магии.", true),
    shieldButton: bool("Shield on a button", "Off: the shield is raised whenever you are not attacking (classic). On: hold the shield key. / Щит по кнопке.", false),
    hudBottom: bool("HUD at the bottom", "Draw hearts and counters at the bottom of the screen. / Интерфейс внизу экрана.", false),
    autosave: bool("Autosave", "Save after chests, doors, new items and dungeons. / Автосохранение.", true),
    language: str("Language", "auto, en or ru. / Язык интерфейса.", "auto"),
    tileUnits: bool("Positions in tiles", "Tick if objects appear about 16 times too close to the top-left: Position values are then read as tiles. / Координаты в тайлах.", false),
    debugHitboxes: bool("Show hitboxes", "Draw collision/hitbox overlay (toggle with F9). / Показать хитбоксы.", false),
    diagnostics: bool("Show diagnostics", "On-screen panel with positions and recent messages (toggle with F10). / Панель диагностики.", false),
  },
  execute(params, ctx) {
    const tk = getToolkit();
    tk.noteAction("Start Toolkit");
    tk.logger.info(`Start Toolkit ${describeParams(params)}`);
    try {
      const old = params as Record<string, unknown>;
      // Before 0.5.0: a "preset" text field instead of the Difficulty number.
      const preset = params.difficulty === undefined && typeof old.preset === "string" && old.preset ? old.preset : DIFFICULTY_PRESETS[Math.round(numOr(params.difficulty, 2))] ?? "alttp";
      tk.applyPreset(preset);
      // Only fields PS Maker actually passed: an action saved by an older version keeps
      // its difficulty preset values instead of being reset to these defaults.
      const has = (k: string) => old[k] !== undefined;
      const hearts = Math.round(numOr(params.hearts, 0));
      const health = hearts * tk.config.player.heartValue;
      tk.configure(
        {
          player: hearts > 0 ? { maxHealth: health, startHealth: health, respawnHealth: health } : {},
          sword: numOr(params.swordDamage, 0) > 0 ? { damage: numOr(params.swordDamage, 0) } : {},
          shield: has("shieldButton") ? { mode: boolOr(params.shieldButton, false) ? "hold" : "passive" } : {},
          ui: {
            ...(has("hud") ? { enabled: boolOr(params.hud, true) } : {}),
            ...(has("magicBar") ? { showMagic: boolOr(params.magicBar, true) } : {}),
            ...(has("hudBottom") ? { position: boolOr(params.hudBottom, false) ? "bottom" : "top" } : {}),
          },
          save: has("autosave") ? { autoSave: boolOr(params.autosave, true) } : {},
          world: has("tileUnits") ? { positionUnits: boolOr(params.tileUnits, false) ? "tiles" : "pixels" } : {},
          debug: { hitboxes: boolOr(params.debugHitboxes, false), diagnostics: boolOr(params.diagnostics, false) },
        },
        "Start Toolkit",
      );
      if (typeof old.config === "string" && old.config.trim()) {
        tk.logger.warn('Start Toolkit: uses the old JSON field "config" — re-open the action in the editor and use the new fields.');
        const { value, error } = parseJsonObject(old.config, "Start Toolkit config");
        if (error) tk.logger.warn(error);
        if (value) tk.configure(value, "Start Toolkit");
      }
      if (params.language) tk.configure({ language: params.language }, "Start Toolkit");
      const mapId = params.mapId || undefined;
      const reason = sessionMismatch(tk.session, ctx, mapId);
      if (!reason) {
        tk.logger.info(`Already running on map "${tk.session!.mapId}"; kept existing objects.`);
        ensureSession(ctx);
        return;
      }
      startSession(ctx, mapId ?? deriveMapId(ctx.scene), reason);
    } catch (err) {
      tk.logger.error('Action "Zelda: Start Toolkit" failed:', err);
      if (tk.config.debug.rethrowErrors) throw err;
    }
  },
});

const CONTROL_ACTIONS = ["sword", "useItem", "shield", "action", "nextItem", "prevItem", "inventory"] as const;

const setControls = defineEvent({
  name: "Zelda: Set Controls",
  description: "Changes the keys. Key names: X, Z, C, Space, Enter, Shift, Tab, Up, 1... Several keys: X, Space. Empty = keep. / Клавиши управления (пусто — не менять).",
  parameterDefs: {
    sword: str("Sword", "Default: X.", ""),
    useItem: str("Use item", "Default: C.", ""),
    shield: str("Shield", "Only with Shield on a button. Default: V.", ""),
    action: str("Action", "Open, lift, read. Default: Z.", ""),
    nextItem: str("Next item", "Default: E.", ""),
    prevItem: str("Previous item", "Default: Q.", ""),
    inventory: str("Inventory", "Default: I.", ""),
  },
  execute(params, ctx) {
    run("Zelda: Set Controls", ctx, params, (s, tk) => {
      const controls: Record<string, string[]> = {};
      for (const a of CONTROL_ACTIONS) if (listOf(params[a]).length) controls[a] = listOf(params[a]);
      tk.configure({ controls }, "Set Controls");
      (s.host.input as { rebind?: () => void }).rebind?.();
    });
  },
});

const stopToolkit = defineEvent({
  name: "Zelda: Stop Toolkit",
  description: "Removes all toolkit objects from this map (progress is kept). / Убирает объекты Toolkit с карты (прогресс сохраняется).",
  parameterDefs: {},
  execute(_params, _ctx) {
    getToolkit().stop("Stop Toolkit action");
  },
});

const pauseCombat = defineEvent({
  name: "Zelda: Pause Combat",
  description: "Pauses or resumes the toolkit simulation (use around cutscenes and dialogue). / Пауза боёвки на время сцен и диалогов.",
  parameterDefs: { paused: bool("Paused", "true = pause, false = resume.", true) },
  execute(params, ctx) {
    run("Zelda: Pause Combat", ctx, params, (s) => s.setPaused("script", !!params.paused));
  },
});

const debugAction = defineEvent({
  name: "Zelda: Debug",
  description: "Hitbox overlay (F9; click the map to read coordinates) and the diagnostics panel (F10): positions, nearby objects, recent warnings. / Отладка и диагностика.",
  parameterDefs: {
    hitboxes: bool("Hitboxes", "Show hitboxes (F9).", true),
    diagnostics: bool("Diagnostics", "Show the diagnostics panel (F10).", false),
  },
  execute(params, ctx) {
    run("Zelda: Debug", ctx, params, (s) => {
      s.debug?.setEnabled(!!params.hitboxes);
      s.debug?.setDiagnostics(!!params.diagnostics);
    });
  },
});

const runActions = defineEvent({
  name: "Zelda: Run Actions",
  description: "Does several things at once, optionally only when a toolkit condition holds (PS Maker conditions cannot read toolkit state). Empty When fields = always. / Несколько действий сразу, можно с условием.",
  parameterDefs: { ...WHEN_FIELDS, ...THEN_FIELDS },
  execute(params, ctx) {
    run("Zelda: Run Actions", ctx, params, (s) => {
      if (!s.rules) {
        s.logger.warn('Run Actions: the "puzzles" feature is disabled.');
        return;
      }
      const when = legacy<Record<string, unknown>>(s, params, "when", "Run Actions") ?? buildWhen(params);
      const ok = s.rules.evaluate(when);
      const actions = ok ? [...asList(legacy<RuleAction[]>(s, params, "then", "Run Actions")), ...buildThen(params)] : asList(legacy<RuleAction[]>(s, params, "else", "Run Actions"));
      if (ok && actions.length === 0) s.logger.warn("Run Actions: nothing to do — fill at least one action field (Open doors, Reveal, Set flag, Give item, Message, Spawn enemy).");
      if (actions.length) s.rules.execute(actions, "Run Actions");
    });
  },
});

const enterDungeon = defineEvent({
  name: "Zelda: Enter Dungeon",
  description: "Marks the current dungeon: small keys and the Big Key are counted per dungeon. Empty ID = back to the overworld. / Вход в подземелье (пусто — выход).",
  parameterDefs: {
    dungeonId: str("Dungeon ID", "Unique dungeon id; empty to leave.", "dungeon_1"),
    completeOnBoss: bool("Complete on boss", "Defeating a boss enemy completes the dungeon.", true),
  },
  execute(params, ctx) {
    run("Zelda: Enter Dungeon", ctx, params, (s) => {
      if (params.dungeonId) s.dungeons?.enter(params.dungeonId, { completeOnBoss: params.completeOnBoss });
      else s.dungeons?.leave();
    });
  },
});

const OBJECT_OPERATIONS = ["open", "close", "on", "off", "toggle", "reveal", "hide", "reset", "destroy", "state"] as const;

const changeObject = defineEvent({
  name: "Zelda: Change Object",
  description: "Changes an object by id. Operation: open, close (doors, chests), on, off, toggle (levers, buttons, plates), reveal, hide, reset (forget saved progress), destroy, or state (any state name). / Изменить объект.",
  parameterDefs: {
    id: str("ID", "Object id.", ""),
    operation: str("Operation", OBJECT_OPERATIONS.join(" | "), "open"),
    state: str("State", 'Only for operation "state": on, off, opened, closed, locked, unlocked, lit, destroyed, revealed, hidden.', ""),
  },
  execute(params, ctx) {
    run("Zelda: Change Object", ctx, params, (s) => {
      const o = objectById(s, params.id, "Change Object");
      if (!o) return;
      switch (params.operation.trim().toLowerCase()) {
        case "open":
          o.open();
          break;
        case "close":
          o.close();
          break;
        case "on":
          o.setState("on");
          break;
        case "off":
          o.setState("off");
          break;
        case "toggle":
          o.setState(o.objState === "on" ? "off" : "on");
          break;
        case "reveal":
          o.reveal();
          break;
        case "hide":
          o.hide();
          break;
        case "reset":
          o.reset();
          break;
        case "destroy":
          o.destroy();
          break;
        case "state":
          if (params.state) o.setState(params.state as ObjectState);
          break;
        default:
          s.logger.warn(`Change Object: unknown operation "${params.operation}" (use ${OBJECT_OPERATIONS.join(", ")}).`);
      }
    });
  },
});

const removeTarget = defineEvent({
  name: "Zelda: Remove Target",
  description: "Removes an enemy or object by id, or every enemy of a group. Defeat = counts as beaten in battle (drops, rules, boss rewards). / Убрать или победить цель.",
  parameterDefs: {
    id: str("ID", "Enemy or object id (empty to use Group).", ""),
    group: str("Group", "Enemy group.", ""),
    defeat: bool("Defeat", "Enemies die with drops and events instead of vanishing.", true),
  },
  execute(params, ctx) {
    run("Zelda: Remove Target", ctx, params, (s) => {
      const targets = params.id ? [s.world.get(params.id)].filter(Boolean) : s.world.list("enemy").filter((e) => params.group && e.group === params.group);
      if (targets.length === 0) s.logger.warn(`Remove Target: nothing matches id "${params.id}" / group "${params.group}".`);
      for (const e of targets) {
        if (params.defeat && e instanceof Enemy) e.die();
        else if (e) s.world.remove(e);
      }
    });
  },
});

const changePlayerStats = defineEvent({
  name: "Zelda: Change Player Stats",
  description: "Adds to (or, with Set, replaces) the player's health, maximum health and magic. Health is in half-hearts: 2 = one heart. 0 = no change. / Здоровье и магия игрока.",
  parameterDefs: {
    health: num("Health", "Half-hearts to add (negative = damage). / Здоровье в половинках сердца.", 0),
    maxHealth: num("Max health", "Half-hearts added to the maximum (also refills). / Максимум здоровья.", 0),
    magic: num("Magic", "Magic points to add. / Магия.", 0),
    set: bool("Set instead of add", "Use the numbers as new values (fields left at 0 are not changed). / Установить вместо прибавления.", false),
  },
  execute(params, ctx) {
    run("Zelda: Change Player Stats", ctx, params, (s, tk) => {
      const old = params as Record<string, unknown>;
      if (params.health === undefined && typeof old.stat === "string") {
        // Before 0.5.0: Stat / Mode / Amount.
        const stat = old.stat.trim().toLowerCase().replace(/[\s_-]/g, "");
        const set = String(old.mode ?? "").trim().toLowerCase() === "set";
        const amount = numOr(old.amount, 0);
        if (stat === "maxhealth") setMaxHealth(tk, set ? amount : tk.state.player.maxHp + amount, true);
        else if (stat === "magic") changeMagic(tk, set ? amount - tk.state.player.magic : amount);
        else if (set) setHealth(tk, amount);
        else changeHealth(tk, amount);
        return;
      }
      const set = boolOr(params.set, false);
      const maxHealth = numOr(params.maxHealth, 0);
      const health = numOr(params.health, 0);
      const magic = numOr(params.magic, 0);
      if (maxHealth) setMaxHealth(tk, set ? maxHealth : tk.state.player.maxHp + maxHealth, true);
      if (health) {
        if (set) setHealth(tk, health);
        else changeHealth(tk, health);
      }
      if (magic) changeMagic(tk, set ? magic - tk.state.player.magic : magic);
      if (!maxHealth && !health && !magic) s.logger.warn("Change Player Stats: all fields are 0 — nothing changed.");
    });
  },
});

// ---- enemies & objects -----------------------------------------------------------------------

const createEnemy = defineEvent({
  name: "Zelda: Create Enemy",
  description: "Spawns an enemy from a template: slime, soldier, spitter, knight, sentry, ogre or your own (Define Enemy). / Создаёт врага по шаблону.",
  parameterDefs: {
    template: str("Template", "slime, soldier, spitter, knight, sentry, ogre or a Define Enemy name.", "slime"),
    position: pos("Position", "Where to spawn, in map pixels. In playtest press F9 and click the map to read X and Y. / Точка появления."),
    id: str("ID", "Optional unique id (needed for persistent bosses).", ""),
    group: str("Group", "Optional group name: rules can wait until the whole group is defeated. / Группа врагов.", ""),
    ...STAT_FIELDS,
    walkAnimation: str("Walk animation", "Optional animation id (Zelda: Define Animation); also used when standing. / Анимация ходьбы.", ""),
    attackAnimation: str("Attack animation", "Optional animation id. / Анимация атаки.", ""),
    hurtAnimation: str("Hurt animation", "Optional animation id. / Анимация урона.", ""),
    deathAnimation: str("Death animation", "Optional animation id. / Анимация смерти.", ""),
    ...SPRITE_FIELDS,
    patrol: str("Patrol markers", "Optional: marker IDs placed with Zelda: Place Marker, walked in order, e.g. p1, p2, p3. / Маршрут патруля по маркерам.", ""),
  },
  execute(params, ctx) {
    run("Zelda: Create Enemy", ctx, params, (s) => {
      const at = where(s, params.position, "Create Enemy");
      if (!at) return;
      const overrides: Partial<EnemyConfig> = { ...(legacy<Partial<EnemyConfig>>(s, params, "overrides", "Create Enemy") ?? {}), ...enemyStats(params) };
      const anims: Record<string, string> = parseAnimationMap(textOf((params as Record<string, unknown>).animations)) ?? {};
      if (textOf(params.walkAnimation)) anims.walk = textOf(params.walkAnimation);
      if (textOf(params.attackAnimation)) anims.attack = textOf(params.attackAnimation);
      if (textOf(params.hurtAnimation)) anims.hurt = textOf(params.hurtAnimation);
      if (textOf(params.deathAnimation)) anims.death = textOf(params.deathAnimation);
      if (Object.keys(anims).length) overrides.animations = { ...(overrides.animations ?? {}), ...anims } as EnemyConfig["animations"];
      const route = listOf(params.patrol);
      if (route.length > 0) overrides.patrol = { ...(overrides.patrol ?? {}), mode: "path", points: route as unknown as EnemyConfig["patrol"]["points"] } as EnemyConfig["patrol"];
      spawnEnemy(s, textOf(params.template) || "slime", at.x, at.y, { id: textOf(params.id) || undefined, group: textOf(params.group), overrides });
    });
  },
});

// Separate from Create Enemy: an empty NPC field must not be able to stop PS Maker
// from running the common case (template + position).
const enemyFromNpc = defineEvent({
  name: "Zelda: Enemy From NPC",
  description: "Turns an NPC already on this map (placed or spawned earlier) into an enemy that keeps the NPC's sprite. / Превращает NPC на карте во врага.",
  parameterDefs: {
    npc: npc("NPC", "The NPC to turn into an enemy. / NPC, который станет врагом."),
    template: str("Template", "Enemy template name (behaviour and stats).", "soldier"),
    id: str("ID", "Optional unique id (needed for persistent bosses).", ""),
    group: str("Group", "Optional group name for rules. / Группа врагов.", ""),
    ...STAT_FIELDS,
  },
  execute(params, ctx) {
    run("Zelda: Enemy From NPC", ctx, params, (s) => {
      const adopt = resolveNpc(params.npc, (s.host as { scene?: unknown }).scene ?? ctx.scene) ?? resolveNpc(params.npc, ctx.scene);
      if (!adopt) {
        s.logger.warn(`Enemy From NPC: NPC ${JSON.stringify(params.npc)} was not found on this map.`);
        return;
      }
      const overrides = { ...(legacy<Partial<EnemyConfig>>(s, params, "overrides", "Enemy From NPC") ?? {}), ...enemyStats(params) };
      spawnEnemy(s, textOf(params.template) || "soldier", adopt.x, adopt.y, { id: textOf(params.id) || undefined, group: textOf(params.group), overrides, adopt });
    });
  },
});

const createObjectAction = defineEvent({
  name: "Zelda: Create Object",
  description:
    "Creates an interactive object: bush, grass, pot, rock, heavy_rock, breakable, bombable_wall, lever, button, pressure_plate, block, chest, door, hidden_passage, torch, reactive, spikes, pit, hook_post, sign. / Создаёт интерактивный объект.",
  parameterDefs: {
    type: str("Type", "Object type (see description).", "bush"),
    position: pos("Position", "Object center."),
    id: str("ID", "Unique id (needed for saving and for other actions to refer to it).", ""),
    sprite: img("Sprite", "Optional custom image for the object."),
    hidden: bool("Hidden", "Starts invisible; Reveal it later. / Скрыт до открытия.", false),
    staysOn: bool("Stays on", "Plates stay pressed and levers/buttons cannot be switched back. / Остаётся включённым.", false),
    width: num("Width", "Pixels; 0 = normal size (16). / Ширина.", 0),
    height: num("Height", "Pixels; 0 = normal size (16). / Высота.", 0),
    text: str("Text", "Sign text, or a message shown when the object is used. / Текст таблички или сообщение.", ""),
    reactsTo: str("Reacts to", "For reactive objects (eye switches, crystals): sword, arrow, bomb, boomerang, fire... comma-separated. / Реагирует на.", ""),
    setFlag: str("On use: set flag", "Flag set when the object is activated (opened, switched on, lit, destroyed). / Флаг при активации.", ""),
    openDoors: str("On use: open doors", "Door ids opened when the object is activated. / Открыть двери при активации.", ""),
    reveal: str("On use: reveal", "Hidden object ids revealed when the object is activated. / Показать объекты при активации.", ""),
  },
  execute(params, ctx) {
    run("Zelda: Create Object", ctx, params, (s) => {
      const at = where(s, params.position, "Create Object");
      if (!at) return;
      const overrides: Partial<ObjectConfig> = legacy<Partial<ObjectConfig>>(s, params, "config", "Create Object") ?? {};
      const sprite = resolveImage(params.sprite);
      if (sprite) overrides.sprite = overrides.sprite ?? sprite;
      if (boolOr(params.hidden, false)) overrides.hidden = true;
      if (boolOr(params.staysOn, false)) {
        overrides.plateMode = "latch";
        overrides.toggle = false;
      }
      if (numOr(params.width, 0) > 0) overrides.width = numOr(params.width, 0);
      if (numOr(params.height, 0) > 0) overrides.height = numOr(params.height, 0);
      if (textOf(params.text)) overrides.message = textOf(params.text);
      const tools = listOf(params.reactsTo).map(damageType);
      if (tools.length) overrides.tools = tools;
      if (textOf(params.setFlag)) overrides.setFlag = textOf(params.setFlag);
      const onUse = buildThen({ openDoors: params.openDoors, reveal: params.reveal });
      if (onUse.length) overrides.onActivate = [...(overrides.onActivate ?? []), ...onUse];
      createObject(s, textOf(params.type) || "bush", at.x, at.y, { id: textOf(params.id) || undefined, overrides });
    });
  },
});

const createChest = defineEvent({
  name: "Zelda: Create Chest",
  description: "Places a treasure chest with an item inside. Opened chests stay open. / Сундук с наградой.",
  parameterDefs: {
    id: str("ID", "Unique chest id.", "chest_1"),
    position: pos("Position", "Chest center."),
    item: str("Item", "Item or resource id: key, big_key, bombs, arrows, rupees, boomerang, bow, heart_container...", "key"),
    count: num("Count", "How many.", 1),
    requiresBigKey: bool("Needs Big Key", "Big chest that needs the dungeon's Big Key.", false),
    hidden: bool("Hidden", "Starts invisible; reveal it with a rule or Zelda: Change Object (reveal).", false),
  },
  execute(params, ctx) {
    run("Zelda: Create Chest", ctx, params, (s) => {
      const at = where(s, params.position, "Create Chest");
      if (!at) return;
      createObject(s, "chest", at.x, at.y, {
        id: params.id || undefined,
        overrides: { contents: params.item ? { item: params.item, count: Math.max(1, params.count || 1) } : null, requires: params.requiresBigKey ? { bigKey: true } : {}, hidden: !!params.hidden },
      });
    });
  },
});

const createDoor = defineEvent({
  name: "Zelda: Create Door",
  description: "Places a door. With no lock ticked it opens by action; Opened by switch = only rules, switches and Change Object open it. / Дверь.",
  parameterDefs: {
    id: str("ID", "Unique door id.", "door_1"),
    position: pos("Position", "Door center."),
    smallKey: bool("Needs a small key", "Opens with a small key of this dungeon. / Нужен маленький ключ.", true),
    bigKey: bool("Needs the Big Key", "Boss door. / Нужен большой ключ.", false),
    bySwitch: bool("Opened by switch", "Opens only from a switch, a rule or Change Object. / Открывается переключателем.", false),
    startOpen: bool("Start open", "Shutter doors that close when a fight starts.", false),
    width: num("Width", "Pixels; 0 = normal size (16). / Ширина.", 0),
    height: num("Height", "Pixels; 0 = normal size (16), e.g. 32 for a two-tile gate. / Высота.", 0),
  },
  execute(params, ctx) {
    run("Zelda: Create Door", ctx, params, (s) => {
      const at = where(s, params.position, "Create Door");
      if (!at) return;
      const old = (params as Record<string, unknown>).lock;
      const lock =
        params.smallKey === undefined && typeof old === "string" && ["none", "small_key", "big_key", "switch"].includes(old)
          ? old
          : boolOr(params.bySwitch, false)
            ? "switch"
            : boolOr(params.bigKey, false)
              ? "big_key"
              : boolOr(params.smallKey, true)
                ? "small_key"
                : "none";
      const overrides: Partial<ObjectConfig> = { lock: lock as ObjectConfig["lock"], startOpen: boolOr(params.startOpen, false) };
      if (numOr(params.width, 0) > 0) overrides.width = numOr(params.width, 0);
      if (numOr(params.height, 0) > 0) overrides.height = numOr(params.height, 0);
      createObject(s, "door", at.x, at.y, { id: textOf(params.id) || undefined, overrides });
    });
  },
});

const placeItem = defineEvent({
  name: "Zelda: Place Item",
  description: "Puts a collectible on the ground (key, heart, bombs...). With an ID it never respawns once taken. / Предмет на земле.",
  parameterDefs: {
    item: str("Item", "Item or resource id.", "key"),
    count: num("Count", "How many.", 1),
    position: pos("Position", "Where."),
    id: str("ID", "Optional id to make it persistent.", ""),
  },
  execute(params, ctx) {
    run("Zelda: Place Item", ctx, params, (s) => {
      const at = where(s, params.position, "Place Item");
      if (at) placePickup(s, params.item, Math.max(1, params.count || 1), at.x, at.y, params.id || undefined);
    });
  },
});

const damageTarget = defineEvent({
  name: "Zelda: Damage Target",
  description: "Deals damage to an enemy or object by id (use 'player' for the player). / Наносит урон по id.",
  parameterDefs: {
    id: str("ID", "Enemy/object id or 'player'.", ""),
    amount: num("Amount", "Damage points.", 1),
    damageType: str("Damage type", "sword, bomb, arrow, fire, ice, magic, script...", "script"),
  },
  execute(params, ctx) {
    run("Zelda: Damage Target", ctx, params, (s) => {
      const type = damageType(params.damageType);
      if (params.id === "player") {
        s.player.applyDamage(params.amount, { type, sourceId: "script", originX: s.player.box.x, originY: s.player.box.y, knockback: 0 });
        return;
      }
      const e = s.world.get(params.id);
      if (!e || !isDamageable(e)) {
        s.logger.warn(`Damage Target: "${params.id}" not found or not damageable.`);
        return;
      }
      e.receiveHit(makeDamage({ amount: params.amount, type, team: "neutral", sourceId: "script", originX: e.x, originY: e.y }));
    });
  },
});

// ---- puzzles & rules -----------------------------------------------------------------------

const addRule = defineEvent({
  name: "Zelda: Add Rule",
  description: "When the conditions become true (every filled When field), do the filled actions. E.g. When objects active: plate_1 → Open doors: door_2. / Правило «условие → действия».",
  parameterDefs: {
    id: str("Rule ID", "Unique rule id.", "rule_1"),
    ...WHEN_FIELDS,
    ...THEN_FIELDS,
    once: bool("Once", "Fire only the first time (remembered in saves).", true),
  },
  execute(params, ctx) {
    run("Zelda: Add Rule", ctx, params, (s) => {
      if (!s.rules) {
        s.logger.warn('Add Rule: the "puzzles" feature is disabled.');
        return;
      }
      const id = textOf(params.id) || "rule";
      const when = legacy<Record<string, unknown>>(s, params, "when", `Rule ${id}`) ?? buildWhen(params);
      const then = [...asList(legacy<RuleAction[]>(s, params, "then", `Rule ${id}`)), ...buildThen(params)];
      if (Object.keys(when).length === 0) {
        s.logger.warn(`Add Rule ${id}: no condition — fill at least one When field.`);
        return;
      }
      if (then.length === 0) s.logger.warn(`Add Rule ${id}: no actions — fill at least one action field (Open doors, Reveal, Set flag, Give item, Message, Spawn enemy).`);
      const spec: RuleSpec = { id, when, then, once: boolOr(params.once, true) };
      const otherwise = legacy<RuleAction[]>(s, params, "else", `Rule ${id}`);
      if (otherwise) spec.else = asList(otherwise);
      s.rules.addRule(spec);
    });
  },
});

const switchSequence = defineEvent({
  name: "Zelda: Create Switch Sequence",
  description: "Switches must be activated in this order; a wrong one resets them. When solved, the filled actions run. / Переключатели в заданном порядке.",
  parameterDefs: {
    id: str("Puzzle ID", "Unique id; solved state is saved as flag puzzle:<id>.", "sequence_1"),
    switches: str("Switch IDs", "Comma-separated ids in the correct order.", "switch_a,switch_b,switch_c"),
    resetOnWrong: bool("Reset on wrong", "Turn all switches off after a wrong one.", true),
    ...THEN_FIELDS,
  },
  execute(params, ctx) {
    run("Zelda: Create Switch Sequence", ctx, params, (s) => {
      if (!s.rules) return;
      s.rules.addSequence({
        id: textOf(params.id) || "sequence",
        switches: listOf(params.switches),
        resetOnWrong: boolOr(params.resetOnWrong, true),
        onSolved: [...asList(legacy<RuleAction[]>(s, params, "onSolved", "Switch Sequence")), ...buildThen(params)],
      });
    });
  },
});

const placeMarker = defineEvent({
  name: "Zelda: Place Marker",
  description:
    "Names a map point once (tip: press F9 in playtest and click the map to get X/Y), e.g. for patrol routes (Patrol markers of Create Enemy). / Именованная точка карты, например для маршрута патруля.",
  parameterDefs: {
    id: str("Marker ID", "Name of the point, e.g. boss_spot.", "marker_1"),
    position: pos("Position", "Point in map pixels. In playtest press F9 and click the map to read/copy X and Y."),
  },
  execute(params, ctx) {
    run("Zelda: Place Marker", ctx, params, (s) => {
      if (!params.id) {
        s.logger.warn("Place Marker: Marker ID is empty.");
        return;
      }
      const p = resolvePosition(params.position, s.config);
      if (!p) {
        s.logger.warn(`Place Marker "${params.id}": no valid position (got ${JSON.stringify(params.position)}).`);
        return;
      }
      s.markers.set(params.id, p);
    });
  },
});

// ---- sprite sheets & animations (Mana Seed and other packs) ----------------------------------

const defineSheet = defineEvent({
  name: "Zelda: Define Sprite Sheet",
  description: "Registers a sprite sheet image cut into equal frames (Mana Seed: 64x64). Frames are numbered from 0, left to right, top to bottom; check them with Zelda: Preview Sprite Sheet. / Спрайт-лист.",
  parameterDefs: {
    id: str("Sheet ID", "Name used by animations, e.g. hero.", "hero"),
    image: img("Image", "The sheet image."),
    imageKey: str("Image key or URL", "Optional: texture key or image URL if the Image picker does not work.", ""),
    frameWidth: num("Frame width", "Pixels.", 64),
    frameHeight: num("Frame height", "Pixels.", 64),
    margin: num("Margin", "Empty pixels around the sheet.", 0),
    spacing: num("Spacing", "Empty pixels between frames.", 0),
  },
  execute(params, ctx) {
    run("Zelda: Define Sprite Sheet", ctx, params, (s, tk) => {
      const scene = (s.host as { scene?: { textures?: { exists(k: string): boolean } } }).scene;
      const exists = (k: string) => !!scene?.textures?.exists(k);
      const image = params.imageKey || pickImageSource(params.image, exists);
      if (!image || !params.id) {
        s.logger.warn(`Define Sprite Sheet "${params.id}": no image (got ${describeParams(params.image)}).`);
        return;
      }
      if (!(params.frameWidth > 0 && params.frameHeight > 0)) {
        s.logger.warn(`Define Sprite Sheet "${params.id}": frame size must be positive.`);
        return;
      }
      tk.configure({ sprites: { sheets: { [params.id]: { image, frameWidth: params.frameWidth, frameHeight: params.frameHeight, margin: params.margin || 0, spacing: params.spacing || 0 } } } }, "Define Sprite Sheet");
    });
  },
});

const defineAnimation = defineEvent({
  name: "Zelda: Define Animation",
  description:
    "Names frames of a sprite sheet (numbers from Preview Sprite Sheet). Fill only Frames for one animation in every direction, or the four direction fields; Left mirrors Right when empty. FPS 0 = stretch over the action. / Анимация из кадров.",
  parameterDefs: {
    id: str("Animation ID", "e.g. hero_slash.", "hero_slash"),
    sheet: str("Sheet ID", "From Zelda: Define Sprite Sheet.", "hero"),
    frames: str("Frames (facing down)", "Frame numbers, e.g. 0, 1, 2, 3. Used for every direction that has no own frames. / Кадры (вниз или для всех).", ""),
    framesUp: str("Frames facing up", "Optional, e.g. 8, 9, 10.", ""),
    framesLeft: str("Frames facing left", "Optional; empty = mirrored Right.", ""),
    framesRight: str("Frames facing right", "Optional, e.g. 16, 17, 18.", ""),
    fps: num("FPS", "Frames per second; 0 = fit the action duration (attacks).", 0),
    loop: bool("Loop", "Repeat (walk/idle).", false),
  },
  execute(params, ctx) {
    run("Zelda: Define Animation", ctx, params, (s, tk) => {
      const id = textOf(params.id);
      const t = textOf(params.frames);
      const nums = (v: unknown) => textOf(v).split(/[\s,;]+/).filter(Boolean).map(Number);
      let frames: AnimDef["frames"] | null;
      if (t.startsWith("{") || t.startsWith("[")) frames = json<AnimDef["frames"]>(s, t, `Define Animation ${id}`); // before 0.5.0
      else if (textOf(params.framesUp) || textOf(params.framesLeft) || textOf(params.framesRight)) {
        const dirs: Partial<Record<Facing, number[]>> = {};
        if (t) dirs.down = nums(t);
        if (textOf(params.framesUp)) dirs.up = nums(params.framesUp);
        if (textOf(params.framesLeft)) dirs.left = nums(params.framesLeft);
        if (textOf(params.framesRight)) dirs.right = nums(params.framesRight);
        frames = dirs;
      } else frames = nums(t);
      const def: AnimDef = { sheet: textOf(params.sheet), frames: frames ?? [], loop: boolOr(params.loop, false) };
      if (numOr(params.fps, 0) > 0) def.fps = numOr(params.fps, 0);
      // A missing sheet is only a warning: it may be defined later in the same event list.
      const problems = validateAnim(def, tk.config.sprites.sheets);
      const blocking = problems.filter((p) => !p.startsWith("sheet "));
      if (problems.length > 0) s.logger.warn(`Define Animation "${id}": ${problems.join("; ")}.`);
      if (blocking.length > 0 || !id) return;
      tk.configure({ sprites: { animations: { [id]: def } } }, "Define Animation");
    });
  },
});

const setPlayerSprites = defineEvent({
  name: "Zelda: Set Player Sprites",
  description: "Uses sprite-sheet animations for the player's attacks (body and weapon layers, e.g. Mana Seed character + weapon sheets). Empty = built-in blade. / Анимации атаки игрока.",
  parameterDefs: {
    attack: str("Attack (body)", "Animation id for the sword swing.", ""),
    weaponAttack: str("Attack (weapon)", "Weapon layer for the swing.", ""),
    spin: str("Spin (body)", "Spin attack; empty = attack.", ""),
    weaponSpin: str("Spin (weapon)", "", ""),
    charge: str("Charge (body)", "While charging; empty = last attack frame.", ""),
    weaponCharge: str("Charge (weapon)", "", ""),
    hurt: str("Hurt (body)", "While knocked back.", ""),
    behindUp: bool("Weapon behind when facing up", "Draw the weapon layer behind the body. / Оружие за телом (вверх).", true),
    behindDown: bool("Weapon behind when facing down", "", false),
    behindLeft: bool("Weapon behind when facing left", "", false),
    behindRight: bool("Weapon behind when facing right", "", false),
    hidePlayer: bool("Hide PS Maker sprite", "Hide the normal sprite while an animation plays.", true),
    offsetX: num("Offset X", "Pixels.", 0),
    offsetY: num("Offset Y", "Pixels.", 0),
    pivotX: num("Swing center X", "Move the point the sword swings around, pixels. / Центр взмаха по X.", 0),
    pivotY: num("Swing center Y", "e.g. 4 to swing from lower on the body. / Центр взмаха по Y.", 0),
  },
  execute(params, ctx) {
    run("Zelda: Set Player Sprites", ctx, params, (s, tk) => {
      const old = (params as Record<string, unknown>).weaponBehind;
      const behind: Facing[] =
        params.behindUp === undefined && typeof old === "string"
          ? listOf(old).filter((x): x is Facing => isFacing(x))
          : (["up", "down", "left", "right"] as const).filter((d) => boolOr(params[`behind${d[0].toUpperCase()}${d.slice(1)}` as "behindUp"], d === "up"));
      const anim = (v: unknown) => textOf(v);
      tk.configure(
        {
          player: {
            sprites: {
              attack: anim(params.attack),
              weaponAttack: anim(params.weaponAttack),
              spin: anim(params.spin),
              weaponSpin: anim(params.weaponSpin),
              charge: anim(params.charge),
              weaponCharge: anim(params.weaponCharge),
              hurt: anim(params.hurt),
              weaponBehind: behind,
              hidePlayer: boolOr(params.hidePlayer, true),
              offsetX: numOr(params.offsetX, 0),
              offsetY: numOr(params.offsetY, 0),
            },
          },
          sword: { pivotOffsetX: numOr(params.pivotX, 0), pivotOffsetY: numOr(params.pivotY, 0) },
        },
        "Set Player Sprites",
      );
      for (const id of [params.attack, params.weaponAttack, params.spin, params.weaponSpin, params.charge, params.weaponCharge, params.hurt].map(anim)) {
        if (id && !tk.config.sprites.animations[id]) s.logger.warn(`Set Player Sprites: animation "${id}" is not defined yet (Zelda: Define Animation).`);
      }
    });
  },
});

const setSound = defineEvent({
  name: "Zelda: Set Sound",
  description: `Plays a sound at a toolkit moment: ${SOUND_EVENTS.join(", ")}. Leave Audio empty to remove it. / Звук для момента игры.`,
  parameterDefs: {
    moment: str("Moment", SOUND_EVENTS.join(" | "), "swordSwing"),
    sound: audio("Sound", "Audio asset."),
    soundKey: str("Sound key or URL", "Optional: audio key or file URL if the Sound picker does not work.", ""),
    volume: num("Volume", "0..1", 1),
  },
  execute(params, ctx) {
    run("Zelda: Set Sound", ctx, params, (s, tk) => {
      if (!(SOUND_EVENTS as readonly string[]).includes(params.moment)) {
        s.logger.warn(`Set Sound: unknown moment "${params.moment}" (${SOUND_EVENTS.join(", ")}).`);
        return;
      }
      const scene = (s.host as { scene?: { cache?: { audio?: { exists(k: string): boolean } } } }).scene;
      const src = params.soundKey || pickAudioSource(params.sound, (k) => !!scene?.cache?.audio?.exists(k));
      tk.configure({ audio: { sounds: { [params.moment]: { src, volume: Number.isFinite(params.volume) ? params.volume : 1 } } } }, "Set Sound");
      if (!src) s.logger.info(`Set Sound: "${params.moment}" has no sound now.`);
    });
  },
});

const previewSheet = defineEvent({
  name: "Zelda: Preview Sprite Sheet",
  description: "Shows a sprite sheet full screen with every frame number, to pick frames for Define Animation. Run it again with Show off to close. / Просмотр кадров.",
  parameterDefs: { sheet: str("Sheet ID", "Sheet to show.", "hero"), show: bool("Show", "Open or close.", true) },
  execute(params, ctx) {
    run("Zelda: Preview Sprite Sheet", ctx, params, (s) => {
      if (!s.host.previewSheet(params.show ? params.sheet : null)) s.logger.warn(`Preview Sprite Sheet: sheet "${params.sheet}" is not defined.`);
    });
  },
});

const waveRoom = defineEvent({
  name: "Zelda: Create Wave Room",
  description: "Room with enemy waves: doors stay shut until every wave is beaten, then the filled actions run. Add enemies with Zelda: Add Wave Enemy. / Комната с волнами врагов.",
  parameterDefs: {
    id: str("Room ID", "Unique room id (cleared state is saved).", "arena"),
    lockDoors: str("Doors to lock", "Comma-separated door ids closed during the fight.", ""),
    autoStart: bool("Start at once", "Start when the map loads; otherwise use Zelda: Start Waves (e.g. from a trigger area).", false),
    delayMs: num("Pause between waves (ms)", "1000 = one second.", 800),
    ...THEN_FIELDS,
  },
  execute(params, ctx) {
    run("Zelda: Create Wave Room", ctx, params, (s) => {
      if (!s.dungeons) return;
      const extra = legacy<Partial<WaveRoomSpec>>(s, params, "advanced", "Create Wave Room") ?? {};
      const onCleared = [...asList(legacy<RuleAction[]>(s, params, "onCleared", "Create Wave Room")), ...buildThen(params)];
      s.dungeons.addWaveRoom({
        ...extra,
        id: textOf(params.id) || extra.id || "arena",
        autoStart: boolOr(params.autoStart, false),
        delayMs: params.delayMs === undefined ? extra.delayMs : Math.max(0, numOr(params.delayMs, 800)),
        lockDoors: listOf(params.lockDoors).length ? listOf(params.lockDoors) : (extra.lockDoors ?? []),
        onCleared: onCleared.length ? onCleared : extra.onCleared,
      });
    });
  },
});

const addWaveEnemy = defineEvent({
  name: "Zelda: Add Wave Enemy",
  description: "Adds one enemy to a wave of a wave room at the given point. / Добавляет врага в волну.",
  parameterDefs: {
    roomId: str("Room ID", "Wave room id.", "arena"),
    wave: num("Wave", "Wave number: 1, 2, 3...", 1),
    template: str("Template", "Enemy template.", "slime"),
    position: pos("Position", "Spawn point."),
    ...STAT_FIELDS,
  },
  execute(params, ctx) {
    run("Zelda: Add Wave Enemy", ctx, params, (s) => {
      if (!s.dungeons) return;
      const p = resolvePosition(params.position, s.config);
      if (!p) {
        s.logger.warn(`Add Wave Enemy: no valid position (got ${JSON.stringify(params.position)}).`);
        return;
      }
      const overrides = { ...(legacy<Partial<EnemyConfig>>(s, params, "overrides", "Add Wave Enemy") ?? {}), ...enemyStats(params) };
      // Store as a marker: resolvePosition already converted to pixels.
      const roomId = textOf(params.roomId) || "arena";
      const marker = `__wave_${roomId}_${s.markers.size}`;
      s.markers.set(marker, p);
      s.dungeons.addWaveSpawn(roomId, Math.max(1, Math.round(numOr(params.wave, 1))), { template: textOf(params.template) || "slime", at: marker, overrides: Object.keys(overrides).length ? overrides : undefined });
    });
  },
});

const startWaves = defineEvent({
  name: "Zelda: Start Waves",
  description: "Starts a wave room (e.g. from a trigger area at the room entrance). / Запускает волны врагов.",
  parameterDefs: { roomId: str("Room ID", "Wave room id.", "") },
  execute(params, ctx) {
    run("Zelda: Start Waves", ctx, params, (s) => s.dungeons?.startWaves(params.roomId));
  },
});

// ---- object state ---------------------------------------------------------------------------

// ---- inventory, health, flags ----------------------------------------------------------------

const giveItem = defineEvent({
  name: "Zelda: Give Item",
  description: "Gives an item or resource (sword, shield, bow, boomerang, bombs, arrows, rupees, key, big_key, heart_container, magic...). / Выдаёт предмет.",
  parameterDefs: {
    item: str("Item", "Item or resource id.", "bombs"),
    count: num("Count", "How many.", 1),
    silent: bool("Silent", "Do not show the 'You got...' message.", false),
  },
  execute(params, ctx) {
    run("Zelda: Give Item", ctx, params, (_s, tk) => {
      tk.inventory.give(params.item, params.count, { silent: params.silent });
    });
  },
});

const spendResource = defineEvent({
  name: "Zelda: Spend Resource",
  description: "Removes resources if there are enough (rupees, bombs, arrows, magic, key). / Тратит ресурс.",
  parameterDefs: { resource: str("Resource", "Resource id.", "rupees"), amount: num("Amount", "How many.", 1) },
  execute(params, ctx) {
    run("Zelda: Spend Resource", ctx, params, (s, tk) => {
      if (!tk.inventory.spend(params.resource, params.amount)) s.logger.info(`Spend Resource: not enough ${params.resource}.`);
    });
  },
});

const removeItem = defineEvent({
  name: "Zelda: Remove Item",
  description: "Takes an owned item away. / Забирает предмет.",
  parameterDefs: { item: str("Item", "Item id.", "") },
  execute(params, ctx) {
    run("Zelda: Remove Item", ctx, params, (_s, tk) => {
      tk.inventory.remove(params.item);
    });
  },
});

const equipItem = defineEvent({
  name: "Zelda: Equip Item",
  description: "Puts an owned item into the quick-use slot. / Ставит предмет в быстрый слот.",
  parameterDefs: { item: str("Item", "Item id.", "") },
  execute(params, ctx) {
    run("Zelda: Equip Item", ctx, params, (s, tk) => {
      if (!tk.inventory.equip(params.item || null)) s.logger.warn(`Equip Item: "${params.item}" is not an owned quick-use item.`);
    });
  },
});

const setFlag = defineEvent({
  name: "Zelda: Set Flag",
  description: "Sets a toolkit flag used by rules (true/false/number/text). / Устанавливает флаг.",
  parameterDefs: { flag: str("Flag", "Flag name.", ""), value: str("Value", "true, false, a number or text.", "true") },
  execute(params, ctx) {
    run("Zelda: Set Flag", ctx, params, (_s, tk) => tk.setFlag(params.flag, parseFlagValue(params.value)));
  },
});

const setAbility = defineEvent({
  name: "Zelda: Set Ability",
  description: "Enables or disables an ability/item (sword, shield, bow, bomb...). / Включает/отключает способность.",
  parameterDefs: { ability: str("Ability", "Item/ability id.", "sword"), enabled: bool("Enabled", "Allow using it.", true) },
  execute(params, ctx) {
    run("Zelda: Set Ability", ctx, params, (_s, tk) => tk.inventory.setAbility(params.ability, params.enabled));
  },
});

const showMessage = defineEvent({
  name: "Zelda: Show Message",
  description: "Shows a short HUD message (not a PS Maker dialogue box). / Короткое сообщение в HUD.",
  parameterDefs: { text: str("Text", "Message text or localization key.", ""), durationMs: num("Duration (ms)", "How long.", 2200) },
  execute(params, ctx) {
    run("Zelda: Show Message", ctx, params, (s) => s.bus.emit("zelda:message", { text: s.i18n.text(params.text), durationMs: params.durationMs }));
  },
});

const setRespawn = defineEvent({
  name: "Zelda: Set Respawn Point",
  description: "Where the player revives after falling in battle on this map (empty = current position). / Точка возрождения.",
  parameterDefs: { position: pos("Position", "Respawn point.") },
  execute(params, ctx) {
    run("Zelda: Set Respawn Point", ctx, params, (s) => {
      const p = resolvePosition(params.position, s.config);
      s.player.setRespawnPoint(p ? p.x : s.player.box.x, p ? p.y : s.player.box.y);
    });
  },
});

const respawnPlayer = defineEvent({
  name: "Zelda: Respawn Player",
  description: "Revives the player at the respawn point (for deathBehavior 'none'). / Возрождает игрока.",
  parameterDefs: {},
  execute(params, ctx) {
    run("Zelda: Respawn Player", ctx, params, (s) => s.player.respawn());
  },
});

// ---- saves ------------------------------------------------------------------------------------

const saveProgress = defineEvent({
  name: "Zelda: Save Progress",
  description: "Saves toolkit progress (health, items, chests, doors, switches, dungeons) to the browser. / Сохраняет прогресс.",
  parameterDefs: { slot: str("Slot", "Save slot name.", "default") },
  execute(params, ctx) {
    run("Zelda: Save Progress", ctx, params, (_s, tk) => {
      tk.saves.save(params.slot || undefined);
    });
  },
});

const loadProgress = defineEvent({
  name: "Zelda: Load Progress",
  description: "Loads toolkit progress saved earlier. / Загружает прогресс.",
  parameterDefs: { slot: str("Slot", "Save slot name.", "default") },
  execute(params, ctx) {
    run("Zelda: Load Progress", ctx, params, (s, tk) => {
      if (!tk.saves.load({ slot: params.slot || undefined })) s.logger.info("Load Progress: no save found.");
    });
  },
});

const resetProgress = defineEvent({
  name: "Zelda: Reset Progress",
  description: "Deletes a save slot and optionally starts a new game. / Удаляет сохранение.",
  parameterDefs: { slot: str("Slot", "Save slot name.", "default"), newGame: bool("New game", "Also reset current progress.", true) },
  execute(params, ctx) {
    run("Zelda: Reset Progress", ctx, params, (s, tk) => {
      tk.saves.delete(params.slot || undefined);
      if (params.newGame) {
        tk.newGame();
        s.onStateReplaced();
      }
      s.bus.emit("zelda:message", { text: s.i18n.t("msg.reset"), durationMs: 1200 });
    });
  },
});

// ---- extension by data --------------------------------------------------------------------------

const defineItem = defineEvent({
  name: "Zelda: Define Item",
  description: "Adds a usable item without code: a shot (Damage > 0), a burst around the player (Area attack) or a healing item (Heal > 0). With none of these it is a quest item. / Свой предмет без кода.",
  parameterDefs: {
    id: str("Item ID", "Unique id, e.g. ice_rod.", "ice_rod"),
    name: str("Name", "Shown in messages and the inventory. / Название.", "Ice Rod"),
    icon: img("Icon", "Optional icon image. / Иконка."),
    resource: str("Uses", "What one use costs: magic, arrows, bombs, rupees or empty = free. / Расходует.", "magic"),
    cost: num("Cost", "How much of it per use.", 4),
    damage: num("Damage", "Damage of the shot or burst; 0 = no attack. / Урон.", 3),
    damageType: str("Damage type", "magic, fire, ice, arrow, bomb... (enemies may resist).", "magic"),
    area: bool("Area attack", "Hit everything around the player instead of shooting. / Удар вокруг игрока.", false),
    stunMs: num("Stun (ms)", "Freeze hit enemies; 1000 = one second.", 0),
    heal: num("Heal", "Half-hearts restored per use (makes it a healing item). / Лечение.", 0),
    give: bool("Give now", "Also give the item to the player.", false),
  },
  execute(params, ctx) {
    run("Zelda: Define Item", ctx, params, (s, tk) => {
      let spec = legacy<DataItemSpec>(s, params, "json", "Define Item");
      if (!spec) {
        const id = textOf(params.id);
        if (!id) {
          s.logger.warn("Define Item: Item ID is empty.");
          return;
        }
        const damage = numOr(params.damage, 0);
        const heal = numOr(params.heal, 0);
        const type = damageType(textOf(params.damageType) || "magic");
        const stunMs = Math.max(0, numOr(params.stunMs, 0));
        spec = {
          id,
          name: textOf(params.name) || id,
          icon: resolveImage(params.icon) || undefined,
          resource: textOf(params.resource) || undefined,
          cost: Math.max(0, numOr(params.cost, 1)),
          effect: heal > 0 ? "heal" : damage > 0 ? (boolOr(params.area, false) ? "area" : "projectile") : "none",
          amount: heal,
          projectile: { damage, damageType: type, stunMs },
          area: { damage, damageType: type, stunMs },
        };
      }
      tk.items.register(createDataItem(spec));
      if (boolOr(params.give, false)) tk.inventory.give(spec.id, 1, { silent: true });
    });
  },
});

const defineEnemy = defineEvent({
  name: "Zelda: Define Enemy",
  description: "Makes a new enemy type from an existing one with other stats; use its name as the Template of Create Enemy. / Новый тип врага на основе существующего.",
  parameterDefs: {
    name: str("Template name", "New template name.", "red_soldier"),
    basedOn: str("Based on", "slime, soldier, spitter, knight, sentry, ogre or another Define Enemy name.", "soldier"),
    ...STAT_FIELDS,
    detectRange: num("Sight range", "Pixels at which it notices the player; 0 = template value. / Дальность обзора.", 0),
    boss: bool("Boss", "Defeating it completes the dungeon (with Enter Dungeon). / Босс.", false),
    immuneTo: str("Immune to", "Damage types that do nothing, comma-separated: arrow, fire, bomb... / Неуязвим к.", ""),
    ...SPRITE_FIELDS,
  },
  execute(params, ctx) {
    run("Zelda: Define Enemy", ctx, params, (s, tk) => {
      const name = textOf(params.name);
      if (!name) {
        s.logger.warn("Define Enemy: Template name is empty.");
        return;
      }
      const old = legacy<Partial<EnemyConfig> & { extends?: string }>(s, params, "json", "Define Enemy");
      const t: Partial<EnemyConfig> & { extends?: string } = old ?? { extends: textOf(params.basedOn) || "soldier" };
      Object.assign(t, enemyStats(params));
      const range = numOr(params.detectRange, 0);
      if (range > 0) t.detectRange = range;
      if (boolOr(params.boss, false)) t.boss = true;
      const immune = listOf(params.immuneTo).map(damageType);
      if (immune.length) t.resistances = { ...(t.resistances ?? {}), ...Object.fromEntries(immune.map((d) => [d, 0])) };
      tk.enemyTemplates.define(name, t);
    });
  },
});

/** Every action shown in the PS Maker event editor. */
export const ZELDA_ACTIONS: PluginEvent<any>[] = [
  startToolkit,
  setControls,
  stopToolkit,
  pauseCombat,
  debugAction,
  createEnemy,
  enemyFromNpc,
  createObjectAction,
  createChest,
  createDoor,
  placeItem,
  placeMarker,
  changeObject,
  removeTarget,
  damageTarget,
  addRule,
  runActions,
  switchSequence,
  waveRoom,
  addWaveEnemy,
  startWaves,
  enterDungeon,
  giveItem,
  spendResource,
  removeItem,
  equipItem,
  changePlayerStats,
  setFlag,
  setAbility,
  showMessage,
  setRespawn,
  respawnPlayer,
  saveProgress,
  loadProgress,
  resetProgress,
  defineItem,
  defineEnemy,
  defineSheet,
  defineAnimation,
  setPlayerSprites,
  previewSheet,
  setSound,
];
