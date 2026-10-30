import { defineEvent, type PluginContext, type PluginEvent } from "@ps-maker/plugin-api";
import type { Session } from "../core/session.ts";
import type { Toolkit } from "../core/toolkit.ts";
import { DAMAGE_TYPES, type DamageType } from "../core/types.ts";
import { makeDamage, isDamageable } from "../combat/combat.ts";
import { spawnEnemy } from "../enemies/spawn.ts";
import type { EnemyConfig } from "../enemies/templates.ts";
import { Enemy } from "../enemies/enemy.ts";
import { Interactable } from "../interactions/interactable.ts";
import { createObject, placePickup } from "../interactions/spawnObject.ts";
import type { ObjectConfig } from "../interactions/objectTypes.ts";
import { createDataItem, type DataItemSpec } from "../items/builtinItems.ts";
import { changeHealth, changeMagic, setHealth, setMaxHealth } from "../player/health.ts";
import { deriveMapId, ensureSession, getToolkit, sessionMismatch, startSession } from "./runtime.ts";
import { assetId, resolveNpc, resolvePosition } from "./paramResolvers.ts";
import { classicLayout, parseLayout, pictureKeys } from "../ui/uiLayout.ts";
import { fontFamilyCss } from "../host/psmakerAssets.ts";
import type { MessageKind } from "../core/events.ts";
import { SOUND_EVENTS } from "../ui/sound.ts";
import { OBJECT_TYPES } from "../interactions/objectTypes.ts";
import { withUi } from "./ui.ts";
import { isReplayedSession, isReplaying, recordMapAction } from "./mapReplay.ts";
import { animFromPick, characterFromParam, characterPlan, mapObjectLook, sheetNames, toSheetDef, type PsSheet, type PsStory } from "../host/psmakerAssets.ts";
import type { Facing } from "../core/math.ts";
import { ABILITY_OPTIONS, animation, areaOf, mapObjectField, audio, bool, boolOr, buildThen, buildWhen, choice, CUSTOM_ENEMY_SLOTS, CUSTOM_ITEM_SLOTS, DUNGEON_OPTIONS, dialogLayoutField, enemyStats, GROUP_OPTIONS, img, inMapNpc, ITEM_OPTIONS, keys, mapArea, mapPath, mapPos, multi, multiOf, npc, num, numOr, pathOf, playerAnim, pointOf, RESOURCE_OPTIONS, SPRITE_FIELDS, STAT_FIELDS, str, TEMPLATE_OPTIONS, templateOf, textOf, THEN_FIELDS, variable, WHEN_FIELDS } from "./fields.ts";

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

/** Short stable hash (FNV-1a) for automatic ids. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

type PsHost = {
  psMakerStory?(): PsStory | null;
  psMakerSheetImage?(sheet: PsSheet): string | null;
  psMakerSheetColumns?(sheet: PsSheet): number | null;
};

const columnsOf = (s: Session) => (sheet: PsSheet) => (s.host as PsHost).psMakerSheetColumns?.(sheet) ?? null;

/** PS Maker project data via the host, warning once when it is not reachable. */
function psStory(s: Session, what: string): PsStory | null {
  const story = (s.host as PsHost).psMakerStory?.() ?? null;
  if (!story) s.logger.warnOnce("ps-story", `${what}: the map scene has no PS Maker project data (scene.story), so PS Maker characters, animations and map objects cannot be used here; built-in sprites are shown.`);
  return story;
}

/**
 * A map object picked as a look: its picture for the normal and the used state, and (unless the
 * author set a size) the body from its collision box with the picture placed around it, as PS
 * Maker places map objects.
 */
function applyObjectLook(s: Session, overrides: Partial<ObjectConfig>, look: unknown, used: unknown, what: string, sizeSet: boolean): void {
  if (!textOf(look) && !textOf(used)) return;
  const story = psStory(s, what);
  if (!story) return;
  const pick = (v: unknown) => {
    if (!textOf(v)) return null;
    const found = mapObjectLook(story, v);
    if (!found) s.logger.warn(`${what}: map object "${textOf(v)}" is not in the project's library; the built-in sprite is used.`);
    return found;
  };
  const normal = pick(look);
  const active = pick(used);
  if (normal) overrides.sprite = normal.sprite;
  if (active) overrides.activeSprite = active.sprite;
  // A chosen "after use" look is shown: a cut bush leaves its stump, a pot its shards.
  if (active) overrides.keepWhenDestroyed = true;
  // Map objects keep their own size: the body is their collision box, not the picture.
  if (normal || active) overrides.spriteScale = 1;
  const main = normal ?? active;
  if (!main?.box || sizeSet) return;
  const size = s.host.textureSize?.(main.sprite) ?? main.frame;
  overrides.width = main.box.width;
  overrides.height = main.box.height;
  if (size) {
    overrides.spriteOffsetX = Math.round(size.w / 2 - (main.box.x + main.box.width / 2));
    overrides.spriteOffsetY = Math.round(size.h / 2 - (main.box.y + main.box.height / 2));
  }
}

/** Registers PS Maker sheets as toolkit sheets (by the texture PS Maker loaded). */
function registerPsSheets(s: Session, tk: Toolkit, sheets: Record<string, PsSheet>, what: string): void {
  for (const [id, sheet] of Object.entries(sheets)) {
    const image = (s.host as PsHost).psMakerSheetImage?.(sheet) ?? null;
    if (!image) {
      s.logger.warn(`${what}: PS Maker sheet "${sheet.name}" (${sheet.src}) is not loaded (no texture "<animation id>frames").`);
      continue;
    }
    tk.configure({ sprites: { sheets: { [id]: toSheetDef(sheet, image) } } }, what);
  }
}

function where(s: Session, position: unknown, what: string): { x: number; y: number } | null {
  if (position === undefined || position === null || position === "") {
    // PS Maker does not save a Position the author never touched.
    if (!s.player.present) {
      s.logger.warn(`${what}: Position is not set and the player was not found.`);
      return null;
    }
    s.logger.warn(`${what}: Position is not set — placed next to the player. Set X/Y in the action (F9 + click the map shows coordinates).`);
    return { x: s.player.box.x + 32, y: s.player.box.y };
  }
  const p = resolvePosition(position, s.config);
  if (p && p.x === 0 && p.y === 0) s.logger.warn(`${what}: Position is X 0, Y 0 — was it left unset? Tip: F9 in playtest, then click the map to get coordinates.`);
  if (p) return p;
  s.logger.warn(`${what}: no valid position (got ${JSON.stringify(position)}).`);
  return null;
}

/** Animations and hitbox of a PS Maker character chosen in a "Look" field. */
function applyLook(s: Session, tk: Toolkit, value: unknown, overrides: Partial<EnemyConfig>, anims: Record<string, string>, what: string): void {
  if (value === undefined || value === null || value === "") return;
  const story = psStory(s, what);
  if (!story) return;
  const ch = characterFromParam(story, value);
  if (!ch) {
    s.logger.warn(`${what}: could not match the chosen character (${describeParams(value)}) with the PS Maker library: ${story.characters.map((c) => c.name).join(", ")}.`);
    return;
  }
  const plan = characterPlan(story, ch, columnsOf(s));
  registerPsSheets(s, tk, plan.sheets, what);
  tk.configure({ sprites: { animations: plan.animations } }, what);
  Object.assign(anims, plan.states);
  if (plan.hitbox) Object.assign(overrides, { width: plan.hitbox.width, height: plan.hitbox.height, spriteOffsetX: plan.hitbox.offsetX, spriteOffsetY: plan.hitbox.offsetY });
  if (Object.keys(plan.states).length === 0) s.logger.warn(`${what}: character "${ch.name}" has no usable sheets (${sheetNames(story, { type: "npc", id: ch.id }).join(", ") || "none"}).`);
}

/**
 * Stable id from what an object is and where it stands, so progress (opened chests,
 * doors, defeated bosses) is saved without typing ids. Two objects on one spot get #2, #3...
 */
function autoId(s: Session, kind: string, x: number, y: number): string {
  const base = `${kind}@${Math.round(x)},${Math.round(y)}`;
  let id = base;
  for (let n = 2; s.world.has(id); n++) id = `${base}#${n}`;
  return id;
}

/** An id saved by an older version (typed in a text field), or an automatic one. */
function idFor(s: Session, params: unknown, kind: string, x: number, y: number): string {
  return textOf((params as Record<string, unknown>).id) || autoId(s, kind, x, y);
}

/** The toolkit object at a point picked on the map. */
function objectAtParam(s: Session, point: unknown, what: string): Interactable | null {
  const p = pointOf(point);
  if (p) {
    const o = s.world.at("object", p.x, p.y);
    if (o instanceof Interactable) return o;
    s.logger.warn(`${what}: no toolkit object at ${Math.round(p.x)}, ${Math.round(p.y)}.`);
    return null;
  }
  s.logger.warn(`${what}: pick the object on the map.`);
  return null;
}

/**
 * A PS Maker animation picked in the editor as a toolkit animation id (registered on
 * first use); an id from an older Define Animation is returned unchanged.
 */
function psAnimation(s: Session, tk: Toolkit, picked: unknown, loop: boolean, what: string): string {
  const id = textOf(picked);
  if (!id || tk.config.sprites.animations[id]) return id;
  const story = psStory(s, what);
  const found = story ? animFromPick(story, id, loop, columnsOf(s)) : null;
  if (!story || !found) {
    if (story) s.logger.warn(`${what}: PS Maker animation "${id}" not found.`);
    return "";
  }
  registerPsSheets(s, tk, { [found.sheetKey]: found.sheet }, what);
  const animId = `ps_anim_${id}${loop ? "_loop" : ""}`;
  tk.configure({ sprites: { animations: { [animId]: found.anim } } }, what);
  return animId;
}

/** Keys from PS Maker's key picker ([{type:"key", key}] / project controls). */
function keysOf(s: Session, value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const story = (s.host as PsHost).psMakerStory?.() as unknown as { controls?: { bindings?: Record<string, string[]>; custom?: { id: string; keys: string[] }[] } } | undefined;
  const out: string[] = [];
  for (const b of value as { type?: string; key?: string; controlId?: string }[]) {
    if (b?.type === "key" && b.key) out.push(b.key);
    else if (b?.type === "control" && b.controlId) out.push(...(story?.controls?.bindings?.[b.controlId] ?? story?.controls?.custom?.find((c) => c.id === b.controlId)?.keys ?? []));
  }
  return out;
}

function damageType(v: string): DamageType {
  return (DAMAGE_TYPES as readonly string[]).includes(v) ? (v as DamageType) : "script";
}

// ---- lifecycle & configuration -------------------------------------------------------------

/** Difficulty numbers saved by 0.5.0–0.5.3 (1 easy, 2 normal, 3 hard). */
const DIFFICULTY_PRESETS = ["casual", "casual", "alttp", "hardcore"];

const startToolkit = defineEvent({
  name: "Zelda: Start Toolkit",
  description: "Starts Zelda Maker Toolkit on this map with the main game settings. Put it first in the map's start events (same settings on every map). / Запускает Toolkit на карте (первым в событиях начала карты).",
  parameterDefs: {
    difficulty: choice("Difficulty", "Easy: longer invulnerability and sword, shield blocks magic, own bombs harmless. Hard: short invulnerability, fewer drops. / Сложность.", [["casual", "Easy"], ["alttp", "Normal"], ["hardcore", "Hard"]], "alttp"),
    hearts: num("Hearts", "Starting and maximum hearts. / Сердца в начале игры.", 3),
    swordDamage: num("Sword damage", "Damage of one sword hit (a slime has 2 HP). / Урон меча.", 2),
    hud: bool("Show HUD", "Hearts, item and counters on screen. Turn off if you build your own UI with PS Maker UI components. / Показывать интерфейс Toolkit.", true),
    magicBar: bool("Magic bar", "Show the magic meter (needed for magic items). / Шкала магии.", true),
    shieldButton: bool("Shield on a button", "Off: the shield is raised whenever you are not attacking (classic). On: hold the shield key. / Щит по кнопке.", false),
    hudBottom: bool("HUD at the bottom", "Draw hearts and counters at the bottom of the screen. / Интерфейс внизу экрана.", false),
    progressVariable: variable("Progress variable", "A Text variable (global) that holds the toolkit's progress: then PS Maker's own Save / Load game menus keep opened chests, items and hearts too. / Текстовая переменная: прогресс Toolkit в сохранениях PS Maker."),
    language: choice("Language", "Interface language. / Язык интерфейса.", [["auto", "Auto"], ["en", "English"], ["ru", "Русский"]], "auto"),
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
      // 0.5.0–0.5.3 saved Difficulty as a number (projects still carry it).
      const d = old.difficulty;
      const preset = typeof d === "number" ? (DIFFICULTY_PRESETS[Math.round(d)] ?? "alttp") : textOf(d) || "alttp";
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
          world: has("tileUnits") ? { positionUnits: boolOr(params.tileUnits, false) ? "tiles" : "pixels" } : {},
          debug: { hitboxes: boolOr(params.debugHitboxes, false), diagnostics: boolOr(params.diagnostics, false) },
        },
        "Start Toolkit",
      );
      if (params.language) tk.configure({ language: params.language }, "Start Toolkit");
      if (has("progressVariable")) tk.progressVariable = textOf(old.progressVariable) || null;
      // The map is remembered by its PS Maker map id (scene key); a Map ID typed in older versions still wins.
      const mapId = textOf(old.mapId) || undefined;
      // A session re-created when PS Maker woke the map up gives way to a Start Toolkit in "Map enter".
      const reason = sessionMismatch(tk.session, ctx, mapId) ?? (isReplayedSession(tk.session) && !isReplaying() ? "the map's actions run again" : null);
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

const CONTROL_ACTIONS = ["sword", "useItem", "shield", "action", "nextItem", "prevItem", "inventory", "menu"] as const;

const setControls = defineEvent({
  name: "Zelda: Set Controls",
  description: "Changes the toolkit keys with PS Maker's key picker (empty = keep). Defaults: sword X, item C, shield V, action Z, items Q/E, inventory I, menu Enter. / Клавиши Toolkit (пусто — не менять).",
  parameterDefs: {
    sword: keys("Sword", "Default: X."),
    useItem: keys("Use item", "Default: C."),
    shield: keys("Shield", "Only with Shield on a button. Default: V."),
    action: keys("Action", "Open, lift, read. Default: Z."),
    nextItem: keys("Next item", "Default: E."),
    prevItem: keys("Previous item", "Default: Q."),
    inventory: keys("Inventory", "Default: I."),
    menu: keys("Menu", "Opens the UI screen marked Menu key. Default: Enter."),
  },
  execute(params, ctx) {
    run("Zelda: Set Controls", ctx, params, (s, tk) => {
      const controls: Record<string, string[]> = {};
      for (const a of CONTROL_ACTIONS) {
        const k = keysOf(s, (params as Record<string, unknown>)[a]);
        if (k.length) controls[a] = k;
      }
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
      const ok = s.rules.evaluate(buildWhen(params));
      const actions = ok ? buildThen(params) : [];
      if (ok && actions.length === 0) s.logger.warn("Run Actions: nothing to do — fill at least one action field (Open doors, Reveal, Set flag, Give item, Message, Spawn enemy).");
      if (actions.length) s.rules.execute(actions, "Run Actions");
    });
  },
});

const enterDungeon = defineEvent({
  name: "Zelda: Enter Dungeon",
  description: "Marks the current dungeon: small keys and the Big Key are counted per dungeon. Overworld = back outside. / Вход в подземелье.",
  parameterDefs: {
    dungeonId: choice("Dungeon", "Keys, map and boss are counted per dungeon. / Подземелье.", DUNGEON_OPTIONS, "dungeon_1"),
    completeOnBoss: bool("Complete on boss", "Defeating a boss enemy completes the dungeon.", true),
  },
  execute(params, ctx) {
    run("Zelda: Enter Dungeon", ctx, params, (s) => {
      const id = textOf(params.dungeonId);
      if (id) s.dungeons?.enter(id, { completeOnBoss: boolOr(params.completeOnBoss, true) });
      else s.dungeons?.leave();
    });
  },
});

const OBJECT_OPERATIONS = [["open", "Open"], ["close", "Close"], ["on", "Switch on"], ["off", "Switch off"], ["toggle", "Toggle"], ["light", "Light (torch)"], ["unlock", "Unlock"], ["reveal", "Reveal"], ["hide", "Hide"], ["reset", "Reset (forget saved state)"], ["destroy", "Destroy"]] as const;

const changeObject = defineEvent({
  name: "Zelda: Change Object",
  description: "Changes a toolkit object picked on the map: open or close doors and chests, switch levers and plates, light torches, reveal, hide, reset or destroy. / Изменить объект.",
  parameterDefs: {
    objectAt: mapPos("Object at", "Pick the object on the map. / Объект на карте."),
    operation: choice("Operation", "What to do with it. / Действие.", OBJECT_OPERATIONS, "open"),
  },
  execute(params, ctx) {
    run("Zelda: Change Object", ctx, params, (s) => {
      const o = objectAtParam(s, params.objectAt, "Change Object");
      if (!o) return;
      switch (textOf(params.operation).toLowerCase()) {
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
        case "light":
          o.setState("lit");
          break;
        case "unlock":
          o.setState("unlocked");
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
        default:
          s.logger.warn(`Change Object: unknown operation "${textOf(params.operation)}".`);
      }
    });
  },
});

const removeTarget = defineEvent({
  name: "Zelda: Remove Target",
  description: "Removes every enemy of a group, or the object picked on the map. Defeat = counts as beaten in battle (drops, rules, boss rewards). / Убрать или победить цель.",
  parameterDefs: {
    group: choice("Enemy group", "All enemies of this group. / Группа врагов.", GROUP_OPTIONS, ""),
    objectAt: mapPos("Object at", "Or an object picked on the map. / Или объект на карте."),
    defeat: bool("Defeat", "Enemies die with drops and events instead of vanishing.", true),
  },
  execute(params, ctx) {
    run("Zelda: Remove Target", ctx, params, (s) => {
      const group = textOf(params.group);
      const at = pointOf(params.objectAt);
      const targets = group ? s.world.list("enemy").filter((e) => e.group === group) : [at ? s.world.at("object", at.x, at.y) : null].filter(Boolean);
      if (targets.length === 0) s.logger.warn("Remove Target: nothing matches (choose a group or pick an object on the map).");
      for (const e of targets) {
        if (boolOr(params.defeat, true) && e instanceof Enemy) e.die();
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
    template: choice("Template", "Behaviour and stats; Custom enemy 1–6 are made with Zelda: Define Enemy. / Шаблон врага.", TEMPLATE_OPTIONS, "slime"),
    position: mapPos("Position", "Where to spawn: pick it on the map. Empty = next to the player. / Точка появления."),
    character: npc("Look (PS Maker character)", "Optional: pick a character from your library, e.g. Slime. Its animations (Run/Walk, Idle, Attack, Hurt, Death) and collision box are used; it does not have to be on the map. / Внешний вид — персонаж PS Maker."),
    group: choice("Group", "Rules can wait until the whole group is defeated. / Группа врагов.", GROUP_OPTIONS, ""),
    ...STAT_FIELDS,
    walkAnimation: animation("Walk animation", "Optional: a PS Maker animation (any direction; the whole sheet is used); also used when standing. Overrides Look. / Анимация ходьбы."),
    attackAnimation: animation("Attack animation", "Optional PS Maker animation. / Анимация атаки."),
    hurtAnimation: animation("Hurt animation", "Optional PS Maker animation. / Анимация урона."),
    deathAnimation: animation("Death animation", "Optional PS Maker animation. / Анимация смерти."),
    ...SPRITE_FIELDS,
    patrol: mapPath("Patrol route", "Optional: click the points of the route on the map; the enemy walks them in order. / Маршрут патруля."),
  },
  execute(params, ctx) {
    run("Zelda: Create Enemy", ctx, params, (s, tk) => {
      const at = where(s, params.position, "Create Enemy");
      if (!at) return;
      const overrides: Partial<EnemyConfig> = {};
      const anims: Record<string, string> = {};
      applyLook(s, tk, params.character, overrides, anims, "Create Enemy");
      Object.assign(overrides, enemyStats(params));
      for (const [state, picked, loop] of [["walk", params.walkAnimation, true], ["attack", params.attackAnimation, false], ["hurt", params.hurtAnimation, false], ["death", params.deathAnimation, false]] as const) {
        const id = psAnimation(s, tk, picked, loop, "Create Enemy");
        if (id) anims[state] = id;
      }
      if (Object.keys(anims).length) overrides.animations = { ...(overrides.animations ?? {}), ...anims } as EnemyConfig["animations"];
      // Route: points clicked on the map.
      const route = pathOf(params.patrol);
      if (route.length > 0) overrides.patrol = { ...(overrides.patrol ?? {}), mode: "path", points: route as EnemyConfig["patrol"]["points"] } as EnemyConfig["patrol"];
      const template = templateOf(params, "slime");
      spawnEnemy(s, template, at.x, at.y, { id: idFor(s, params, template, at.x, at.y), group: textOf(params.group), overrides });
    });
  },
});

// Separate from Create Enemy: an empty NPC field must not be able to stop PS Maker
// from running the common case (template + position).
const enemyFromNpc = defineEvent({
  name: "Zelda: Enemy From NPC",
  description: "Turns an NPC already on this map (placed or spawned earlier) into an enemy that keeps the NPC's sprite. / Превращает NPC на карте во врага.",
  parameterDefs: {
    npc: inMapNpc("NPC", "An NPC on this map (placed or spawned earlier) that becomes the enemy. / NPC на карте, который станет врагом."),
    template: choice("Template", "Behaviour and stats. / Шаблон врага.", TEMPLATE_OPTIONS, "soldier"),
    group: choice("Group", "Rules can wait until the whole group is defeated. / Группа врагов.", GROUP_OPTIONS, ""),
    ...STAT_FIELDS,
  },
  execute(params, ctx) {
    run("Zelda: Enemy From NPC", ctx, params, (s) => {
      const adopt = resolveNpc(params.npc, (s.host as { scene?: unknown }).scene ?? ctx.scene);
      if (!adopt) {
        s.logger.warn(`Enemy From NPC: NPC ${JSON.stringify(params.npc)} was not found on this map.`);
        return;
      }
      const overrides = enemyStats(params);
      spawnEnemy(s, templateOf(params, "soldier"), adopt.x, adopt.y, { id: idFor(s, params, "npc_enemy", adopt.x, adopt.y), group: textOf(params.group), overrides, adopt });
    });
  },
});

const createObjectAction = defineEvent({
  name: "Zelda: Create Object",
  description: "Creates an interactive object: bushes, pots, rocks, walls to bomb, levers, buttons, plates, blocks, torches, chests, doors, hidden passages, spikes, pits, signs... / Создаёт интерактивный объект.",
  parameterDefs: {
    type: choice("Type", "Object type. / Тип объекта.", OBJECT_TYPES, "bush"),
    position: mapPos("Position", "Object center: pick it on the map. / Центр объекта."),
    look: mapObjectField("Look (map object)", "A map object of your library (e.g. a Mana Seed bush): its picture and collision box. Built-in = the toolkit's sprite. / Вид — объект карты из библиотеки."),
    lookUsed: mapObjectField("Look when used", "Picture after use: cut bush, broken pot, lever on, plate pressed, torch lit, chest open... Built-in = the toolkit's sprite. / Вид после использования."),
    sprite: img("Sprite (image)", "Or an image of your library instead of a map object. / Или картинка из библиотеки."),
    hidden: bool("Hidden", "Starts invisible; reveal it later. / Скрыт до открытия.", false),
    staysOn: bool("Stays on", "Plates stay pressed and levers/buttons cannot be switched back. / Остаётся включённым.", false),
    width: num("Width", "Pixels; 0 = normal size (16). / Ширина.", 0),
    height: num("Height", "Pixels; 0 = normal size (16). / Высота.", 0),
    text: str("Text", "Sign text, or a message shown when the object is used. / Текст таблички или сообщение.", ""),
    reactsTo: multi("Reacts to", "For eye switches, crystals and breakables: what hits it. / Реагирует на.", DAMAGE_TYPES),
    turnOnVariable: variable("On use: turn on variable", "Project variable set to true when the object is activated (opened, switched on, lit, destroyed). / Включить переменную при активации."),
    openDoorAt: mapPos("On use: open door at", "Door picked on the map, opened when the object is activated. / Открыть дверь при активации."),
    revealAt: mapPos("On use: reveal object at", "Hidden object picked on the map, revealed when the object is activated. / Показать объект при активации."),
  },
  execute(params, ctx) {
    run("Zelda: Create Object", ctx, params, (s) => {
      const at = where(s, params.position, "Create Object");
      if (!at) return;
      const overrides: Partial<ObjectConfig> = {};
      applyObjectLook(s, overrides, params.look, params.lookUsed, "Create Object", numOr(params.width, 0) > 0 || numOr(params.height, 0) > 0);
      if (boolOr(params.hidden, false)) overrides.hidden = true;
      if (boolOr(params.staysOn, false)) {
        overrides.plateMode = "latch";
        overrides.toggle = false;
      }
      if (numOr(params.width, 0) > 0) overrides.width = numOr(params.width, 0);
      if (numOr(params.height, 0) > 0) overrides.height = numOr(params.height, 0);
      if (textOf(params.text)) overrides.message = textOf(params.text);
      const tools = multiOf(params.reactsTo).map(damageType);
      if (tools.length) overrides.tools = tools;
      const onUse = buildThen({ openDoorAt: params.openDoorAt, revealAt: params.revealAt, turnOnVariable: params.turnOnVariable });
      if (onUse.length) overrides.onActivate = onUse;
      const type = textOf(params.type) || "bush";
      createObject(s, type, at.x, at.y, { id: idFor(s, params, type, at.x, at.y), overrides });
    });
  },
});

const createChest = defineEvent({
  name: "Zelda: Create Chest",
  description: "Places a treasure chest with an item inside. Opened chests stay open. / Сундук с наградой.",
  parameterDefs: {
    position: mapPos("Position", "Chest center."),
    item: choice("Item", "What is inside. / Что внутри.", ITEM_OPTIONS, "key"),
    count: num("Count", "How many (rupees, bombs, arrows...). / Сколько.", 1),
    requiresBigKey: bool("Needs Big Key", "Big chest that needs the dungeon's Big Key.", false),
    hidden: bool("Hidden", "Starts invisible; reveal it with a rule or Zelda: Change Object (reveal).", false),
    look: mapObjectField("Look: closed", "A map object of your library for the closed chest. Built-in = the toolkit's chest. / Вид закрытого сундука."),
    lookOpen: mapObjectField("Look: open", "Map object for the opened chest. / Вид открытого сундука."),
  },
  execute(params, ctx) {
    run("Zelda: Create Chest", ctx, params, (s) => {
      const at = where(s, params.position, "Create Chest");
      if (!at) return;
      const overrides: Partial<ObjectConfig> = { contents: params.item ? { item: params.item, count: Math.max(1, params.count || 1) } : null, requires: params.requiresBigKey ? { bigKey: true } : {}, hidden: !!params.hidden };
      applyObjectLook(s, overrides, params.look, params.lookOpen, "Create Chest", false);
      createObject(s, "chest", at.x, at.y, { id: idFor(s, params, "chest", at.x, at.y), overrides });
    });
  },
});

const createDoor = defineEvent({
  name: "Zelda: Create Door",
  description: "Places a door. Lock: none (opens by action), small key, Big Key, or switch (only switches, rules and Change Object open it). / Дверь.",
  parameterDefs: {
    position: mapPos("Position", "Door center."),
    lock: choice("Lock", "What opens it. / Замок.", [["none", "None"], ["small_key", "Small key"], ["big_key", "Big Key"], ["switch", "Switch / rule"]], "small_key"),
    startOpen: bool("Start open", "Shutter doors that close when a fight starts.", false),
    width: num("Width", "Pixels; 0 = normal size (16). / Ширина.", 0),
    height: num("Height", "Pixels; 0 = normal size (16), e.g. 32 for a two-tile gate. / Высота.", 0),
    look: mapObjectField("Look: closed", "A map object of your library for the closed door. Built-in = the toolkit's door. / Вид закрытой двери."),
    lookOpen: mapObjectField("Look: open", "Map object for the open door (empty passage if you like). / Вид открытой двери."),
  },
  execute(params, ctx) {
    run("Zelda: Create Door", ctx, params, (s) => {
      const at = where(s, params.position, "Create Door");
      if (!at) return;
      const lock = ["none", "small_key", "big_key", "switch"].includes(textOf(params.lock)) ? textOf(params.lock) : "small_key";
      const overrides: Partial<ObjectConfig> = { lock: lock as ObjectConfig["lock"], startOpen: boolOr(params.startOpen, false) };
      if (numOr(params.width, 0) > 0) overrides.width = numOr(params.width, 0);
      if (numOr(params.height, 0) > 0) overrides.height = numOr(params.height, 0);
      applyObjectLook(s, overrides, params.look, params.lookOpen, "Create Door", numOr(params.width, 0) > 0 || numOr(params.height, 0) > 0);
      createObject(s, "door", at.x, at.y, { id: idFor(s, params, "door", at.x, at.y), overrides });
    });
  },
});

const placeItem = defineEvent({
  name: "Zelda: Place Item",
  description: "Puts a collectible on the ground (key, heart, rupees, bombs...). / Предмет на земле.",
  parameterDefs: {
    item: choice("Item", "What lies there. / Предмет.", ITEM_OPTIONS, "key"),
    count: num("Count", "How many (rupees, bombs, arrows...). / Сколько.", 1),
    position: mapPos("Position", "Where it lies: pick it on the map. / Где лежит."),
    once: bool("Only once", "Once taken it never comes back (keys, heart containers). / Не появляется снова.", true),
    look: mapObjectField("Look (map object)", "A map object of your library for the item on the ground. Built-in = the toolkit's sprite. / Вид предмета."),
  },
  execute(params, ctx) {
    run("Zelda: Place Item", ctx, params, (s) => {
      const at = where(s, params.position, "Place Item");
      if (!at) return;
      const item = textOf(params.item) || "key";
      const id = textOf((params as Record<string, unknown>).id) || (boolOr(params.once, true) ? autoId(s, `item_${item}`, at.x, at.y) : undefined);
      const story = textOf(params.look) ? psStory(s, "Place Item") : null;
      const look = story ? mapObjectLook(story, params.look) : null;
      if (textOf(params.look) && story && !look) s.logger.warn(`Place Item: map object "${textOf(params.look)}" is not in the project's library; the built-in sprite is used.`);
      placePickup(s, item, Math.max(1, Math.round(numOr(params.count, 1))), at.x, at.y, id, look?.sprite);
    });
  },
});

const damageTarget = defineEvent({
  name: "Zelda: Damage Target",
  description: "Deals damage to the player, to every enemy of a group, or to an object picked on the map. / Наносит урон.",
  parameterDefs: {
    player: bool("Hit the player", "Damage the player. / Урон игроку.", false),
    group: choice("Enemy group", "Damage every enemy of this group. / Урон группе врагов.", GROUP_OPTIONS, ""),
    objectAt: mapPos("Object at", "Or an object picked on the map. / Или объект на карте."),
    amount: num("Amount", "Damage points (2 = one heart for the player). / Урон.", 1),
    damageType: choice("Damage type", "Enemies may resist some types. / Тип урона.", DAMAGE_TYPES, "script"),
  },
  execute(params, ctx) {
    run("Zelda: Damage Target", ctx, params, (s) => {
      const type = damageType(textOf(params.damageType));
      const amount = numOr(params.amount, 1);
      if (boolOr(params.player, false)) {
        s.player.applyDamage(amount, { type, sourceId: "script", originX: s.player.box.x, originY: s.player.box.y, knockback: 0 });
        return;
      }
      const at = pointOf(params.objectAt);
      const targets = textOf(params.group) ? s.world.list("enemy").filter((e) => e.group === textOf(params.group)) : [at ? s.world.at("object", at.x, at.y) : null];
      let hit = 0;
      for (const e of targets) {
        if (!e || !isDamageable(e)) continue;
        e.receiveHit(makeDamage({ amount, type, team: "neutral", sourceId: "script", originX: e.x, originY: e.y }));
        hit++;
      }
      if (hit === 0) s.logger.warn("Damage Target: nothing to hit (tick Hit the player, choose a group or pick an object).");
    });
  },
});

// ---- puzzles & rules -----------------------------------------------------------------------

const addRule = defineEvent({
  name: "Zelda: Add Rule",
  description: "When the conditions become true (every filled When field), do the filled actions. E.g. When object at: the plate → Open door at: the door. / Правило «условие → действия».",
  parameterDefs: {
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
      // A rule is remembered (Once) by what it says, so no id has to be typed.
      const when = buildWhen(params);
      const then = buildThen(params);
      const id = `rule_${hashText(JSON.stringify([when, then]))}`;
      if (Object.keys(when).length === 0) {
        s.logger.warn(`Add Rule: no condition — fill at least one When field.`);
        return;
      }
      if (then.length === 0) s.logger.warn(`Add Rule: no actions — fill at least one action field.`);
      s.rules.addRule({ id, when, then, once: boolOr(params.once, true) });
    });
  },
});

const switchSequence = defineEvent({
  name: "Zelda: Create Switch Sequence",
  description: "Switches must be activated in this order; a wrong one resets them. When solved, the filled actions run. Put it after the switches. / Переключатели в заданном порядке (ставить после них).",
  parameterDefs: {
    order: mapPath("Switches in order", "Click the switches on the map in the right order. / Переключатели по порядку."),
    resetOnWrong: bool("Reset on wrong", "Turn all switches off after a wrong one.", true),
    ...THEN_FIELDS,
  },
  execute(params, ctx) {
    run("Zelda: Create Switch Sequence", ctx, params, (s) => {
      if (!s.rules) return;
      const points = pathOf(params.order);
      const switches = points.map((p) => s.world.at("object", p.x, p.y, 12, (e) => e instanceof Interactable && e.cfg.type !== "block")?.id ?? "").filter(Boolean);
      if (points.length && switches.length < points.length) s.logger.warn(`Create Switch Sequence: ${points.length - switches.length} of the clicked points have no switch — put this action after the switches.`);
      if (switches.length === 0) return;
      s.rules.addSequence({
        id: `sequence_${switches.join("_")}`,
        switches,
        resetOnWrong: boolOr(params.resetOnWrong, true),
        onSolved: buildThen(params),
      });
    });
  },
});

// ---- sprite sheets & animations (Mana Seed and other packs) ----------------------------------

const setPlayerSprites = defineEvent({
  name: "Zelda: Set Player Sprites",
  description: "Player animations from PS Maker (e.g. Mana Seed Sword Attack) for sword, items, lifting, pushing, shield and death: pick any direction, all directions of that sheet are used. Empty = not used (the normal PS Maker sprite or the built-in blade). / Анимации игрока из PS Maker.",
  parameterDefs: {
    attack: playerAnim("Attack", "Sword swing, e.g. Sword Attack. / Удар мечом."),
    spin: playerAnim("Spin attack", "Optional; empty = Attack. / Круговой удар."),
    charge: playerAnim("Charging", "Optional: while the sword is held; empty = last Attack frame. / Зарядка удара."),
    chargeWalk: playerAnim("Walking while charging", "Optional: walking with the sword held, e.g. Sword Walk; empty = normal walk with the built-in blade. / Ходьба с заряженным мечом."),
    hurt: playerAnim("Hurt", "Optional, e.g. Sword Hurt. / Получение урона."),
    death: playerAnim("Death", "Optional, e.g. Sword Death; the last frame stays until respawn. / Смерть."),
    shield: playerAnim("Shield up", "Optional: while the shield button is held (Start Toolkit: Shield on a button). / Щит поднят."),
    bow: playerAnim("Bow", "Optional: shooting an arrow; empty = Use item. / Лук."),
    boomerang: playerAnim("Boomerang", "Optional: throwing the boomerang; empty = Use item. / Бумеранг."),
    bomb: playerAnim("Bomb", "Optional: placing a bomb; empty = Use item. / Бомба."),
    item: playerAnim("Use item", "Optional: any other item (rods, magic, your own items) and the fallback for the four above. / Использование предмета."),
    lift: playerAnim("Lift", "Optional: picking up a pot, bush or rock. / Поднять."),
    carry: playerAnim("Carry", "Optional: walking with the object overhead; stands on the first frame. / Нести над головой."),
    throw: playerAnim("Throw", "Optional: throwing what you carry. / Бросить."),
    push: playerAnim("Push", "Optional: leaning on a block to push it. / Толкать блок."),
    itemGet: playerAnim("Item get", "Optional: holding up an item from a chest for a second (the player stands still meanwhile). / Достать предмет из сундука."),
    weaponAttack: animation("Weapon layer: attack", "Optional: a separate weapon sheet drawn over the body (when the weapon is not in the body frames). / Слой оружия: удар."),
    weaponSpin: animation("Weapon layer: spin", "Optional. / Слой оружия: круговой."),
    weaponCharge: animation("Weapon layer: charging", "Optional. / Слой оружия: зарядка."),
    behindUp: bool("Weapon behind when facing up", "Draw the weapon layer behind the body. / Оружие за телом (вверх).", true),
    behindDown: bool("Weapon behind when facing down", "Draw the weapon layer behind the body. / Оружие за телом (вниз).", false),
    behindLeft: bool("Weapon behind when facing left", "Draw the weapon layer behind the body. / Оружие за телом (влево).", false),
    behindRight: bool("Weapon behind when facing right", "Draw the weapon layer behind the body. / Оружие за телом (вправо).", false),
    hidePlayer: bool("Hide PS Maker sprite", "Hide the normal sprite while an animation plays. / Скрывать обычный спрайт.", true),
    offsetX: num("Offset X", "Move the animation, pixels. / Сдвиг по X.", 0),
    offsetY: num("Offset Y", "Move the animation, pixels. / Сдвиг по Y.", 0),
    pivotX: num("Swing center X", "Move the point the sword swings around, pixels. / Центр взмаха по X.", 0),
    pivotY: num("Swing center Y", "e.g. 4 to swing from lower on the body. / Центр взмаха по Y.", 0),
  },
  execute(params, ctx) {
    run("Zelda: Set Player Sprites", ctx, params, (s, tk) => {
      const behind: Facing[] = (["up", "down", "left", "right"] as const).filter((d) => boolOr(params[`behind${d[0].toUpperCase()}${d.slice(1)}` as "behindUp"], d === "up"));
      const pick = (v: unknown) => psAnimation(s, tk, v, false, "Set Player Sprites");
      const loop = (v: unknown) => psAnimation(s, tk, v, true, "Set Player Sprites");
      tk.configure(
        {
          player: {
            sprites: {
              attack: pick(params.attack),
              weaponAttack: pick(params.weaponAttack),
              spin: pick(params.spin),
              weaponSpin: pick(params.weaponSpin),
              charge: pick(params.charge),
              weaponCharge: pick(params.weaponCharge),
              hurt: pick(params.hurt),
              // Ongoing states loop while they last; one-shot actions play once and hold the last frame.
              chargeWalk: loop(params.chargeWalk),
              shield: loop(params.shield),
              carry: loop(params.carry),
              push: loop(params.push),
              death: pick(params.death),
              bow: pick(params.bow),
              boomerang: pick(params.boomerang),
              bomb: pick(params.bomb),
              item: pick(params.item),
              lift: pick(params.lift),
              throw: pick(params.throw),
              itemGet: pick(params.itemGet),
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
    });
  },
});

const setSound = defineEvent({
  name: "Zelda: Set Sound",
  description: `Plays a sound at a toolkit moment: ${SOUND_EVENTS.join(", ")}. Leave Audio empty to remove it. / Звук для момента игры.`,
  parameterDefs: {
    moment: choice("Moment", "When the sound plays. / Когда звучит.", SOUND_EVENTS, "swordSwing"),
    sound: audio("Sound", "Audio asset."),
    volume: num("Volume", "0 = silent, 1 = full volume, 0.5 = half. / Громкость.", 1),
  },
  execute(params, ctx) {
    run("Zelda: Set Sound", ctx, params, (s, tk) => {
      if (!(SOUND_EVENTS as readonly string[]).includes(params.moment)) {
        s.logger.warn(`Set Sound: unknown moment "${params.moment}" (${SOUND_EVENTS.join(", ")}).`);
        return;
      }
      const src = textOf((params as Record<string, unknown>).soundKey) || assetId(params.sound);
      tk.configure({ audio: { sounds: { [params.moment]: { src, volume: Number.isFinite(params.volume) ? params.volume : 1 } } } }, "Set Sound");
      if (!src) s.logger.info(`Set Sound: "${params.moment}" has no sound now.`);
    });
  },
});

const waveRoom = defineEvent({
  name: "Zelda: Create Wave Room",
  description: "A room with enemy waves: draw its area on the map. Doors inside the area stay shut until every wave is beaten; waves start when the player walks in. Add enemies with Zelda: Add Wave Enemy inside the area. / Комната с волнами врагов.",
  parameterDefs: {
    area: mapArea("Room area", "Draw the room on the map. / Область комнаты."),
    startAtOnce: bool("Start at once", "Start when the map loads instead of when the player walks in. / Начать сразу.", false),
    delayMs: num("Pause between waves (ms)", "Time before the next wave: 1000 = one second. / Пауза между волнами.", 800),
    ...THEN_FIELDS,
  },
  execute(params, ctx) {
    run("Zelda: Create Wave Room", ctx, params, (s) => {
      if (!s.dungeons) return;
      const area = areaOf(params.area);
      if (!area) {
        s.logger.warn("Create Wave Room: draw the room area on the map.");
        return;
      }
      const onCleared = buildThen(params);
      const atOnce = boolOr(params.startAtOnce, false);
      s.dungeons.addWaveRoom({
        id: `room@${Math.round(area.x)},${Math.round(area.y)}`,
        area,
        autoStart: atOnce,
        startOnEnter: !atOnce,
        delayMs: Math.max(0, numOr(params.delayMs, 800)),
        onCleared: onCleared.length ? onCleared : undefined,
      });
    });
  },
});

const addWaveEnemy = defineEvent({
  name: "Zelda: Add Wave Enemy",
  description: "Adds one enemy to a wave: it belongs to the wave room whose area contains its position. / Добавляет врага в волну комнаты, в которой стоит.",
  parameterDefs: {
    wave: num("Wave", "Wave number: 1 = first wave, 2 = second... / Номер волны.", 1),
    template: choice("Template", "Behaviour and stats. / Шаблон врага.", TEMPLATE_OPTIONS, "slime"),
    position: mapPos("Position", "Spawn point inside the room: pick it on the map. / Точка появления."),
    ...STAT_FIELDS,
  },
  execute(params, ctx) {
    run("Zelda: Add Wave Enemy", ctx, params, (s) => {
      if (!s.dungeons) return;
      const p = resolvePosition(params.position, s.config);
      if (!p) {
        s.logger.warn("Add Wave Enemy: pick the spawn point on the map.");
        return;
      }
      const overrides = enemyStats(params);
      const wave = Math.max(1, Math.round(numOr(params.wave, 1)));
      s.dungeons.addWaveSpawnAt(wave, { template: templateOf(params, "slime"), x: p.x, y: p.y, overrides: Object.keys(overrides).length ? overrides : undefined });
    });
  },
});

// ---- object state ---------------------------------------------------------------------------

// ---- inventory, health, flags ----------------------------------------------------------------

const giveItem = defineEvent({
  name: "Zelda: Give Item",
  description: "Gives an item or resource. / Выдаёт предмет.",
  parameterDefs: {
    item: choice("Item", "What to give. / Предмет.", ITEM_OPTIONS, "bombs"),
    count: num("Count", "How many (rupees, bombs, arrows...). / Сколько.", 1),
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
  parameterDefs: { resource: choice("Resource", "What to spend. / Ресурс.", RESOURCE_OPTIONS, "rupees"), amount: num("Amount", "How many. / Сколько.", 1) },
  execute(params, ctx) {
    run("Zelda: Spend Resource", ctx, params, (s, tk) => {
      if (!tk.inventory.spend(params.resource, params.amount)) s.logger.info(`Spend Resource: not enough ${params.resource}.`);
    });
  },
});

const removeItem = defineEvent({
  name: "Zelda: Remove Item",
  description: "Takes an owned item away. / Забирает предмет.",
  parameterDefs: { item: choice("Item", "Which item. / Предмет.", ABILITY_OPTIONS, "boomerang") },
  execute(params, ctx) {
    run("Zelda: Remove Item", ctx, params, (_s, tk) => {
      tk.inventory.remove(params.item);
    });
  },
});

const equipItem = defineEvent({
  name: "Zelda: Equip Item",
  description: "Puts an owned item into the quick-use slot. / Ставит предмет в быстрый слот.",
  parameterDefs: { item: choice("Item", "Which item. / Предмет.", ABILITY_OPTIONS, "boomerang") },
  execute(params, ctx) {
    run("Zelda: Equip Item", ctx, params, (s, tk) => {
      if (!tk.inventory.equip(params.item || null)) s.logger.warn(`Equip Item: "${params.item}" is not an owned quick-use item.`);
    });
  },
});

const setAbility = defineEvent({
  name: "Zelda: Set Ability",
  description: "Enables or disables an ability/item (sword, shield, bow, bomb...). / Включает/отключает способность.",
  parameterDefs: { ability: choice("Ability", "Which item or ability. / Способность.", ABILITY_OPTIONS, "sword"), enabled: bool("Enabled", "Allow using it. / Разрешить.", true) },
  execute(params, ctx) {
    run("Zelda: Set Ability", ctx, params, (_s, tk) => tk.inventory.setAbility(params.ability, params.enabled));
  },
});

const uiLayout = defineEvent({
  name: "Zelda: UI Layout",
  description: "Your own HUD or a menu screen, made with the mouse: open this action and the designer works on the map (game window frame) with a panel beside it — pictures, texts, meters, hearts, counters, the item box, buttons. Without a screen name it is the HUD; with one it is a screen opened by Open UI Screen, a button or the Menu key. Put it after Start Toolkit. / Свой HUD или экран меню из дизайнера.",
  parameterDefs: {
    name: str("Screen name", "Empty = the HUD. A name (e.g. pause) makes this a screen opened by Zelda: Open UI Screen, a button or the Menu key. / Пусто — HUD; имя — экран меню.", ""),
    layout: str("Layout data", "Written by the designer on the map; do not edit by hand. Empty = the classic Zelda HUD. / Данные макета — пишет дизайнер.", ""),
  },
  execute(params, ctx) {
    run("Zelda: UI Layout", ctx, params, (s, tk) => {
      const p = params as Record<string, unknown>;
      const screen = textOf(p.name).trim();
      const { layout: parsed, error } = parseLayout(textOf(p.layout));
      if (error) s.logger.warn(`UI Layout${screen ? ` "${screen}"` : ""}: ${error}; ${screen ? "the screen is empty" : "the classic HUD is shown"}.`);
      const layout = parsed ?? (screen ? { ...classicLayout(), elements: [] } : classicLayout());
      if (screen) tk.uiScreens.set(screen, layout);
      else tk.hudLayout = layout;
      const story = psStory(s, "UI Layout");
      // Fonts of the texts: PS Maker loads a project font only when it first shows its own text.
      for (const id of new Set([layout.theme.font, ...layout.elements.map((e) => (e.type === "text" || e.type === "button" ? e.font : ""))].filter(Boolean))) {
        tk.uiFonts[id] = fontFamilyCss(story, id);
        s.host.loadProjectFont?.(id);
      }
      for (const e of layout.elements) {
        for (const key of pictureKeys(e)) if (s.host.textureSize && !s.host.textureSize(key)) s.logger.warnOnce(`ui-pic-${key}`, `UI Layout: picture "${key}" (${e.id}) is not loaded; the built-in look is shown.`);
      }
      s.hud?.markDirty();
    });
  },
});

const openUiScreen = defineEvent({
  name: "Zelda: Open UI Screen",
  description: "Opens a UI screen made with Zelda: UI Layout (by its screen name) over the game. Arrow keys choose a button, the action key presses it, the sword or inventory key goes back. / Открывает экран меню.",
  parameterDefs: {
    name: str("Screen name", "The screen name given in its Zelda: UI Layout. / Имя экрана.", ""),
  },
  execute(params, ctx) {
    run("Zelda: Open UI Screen", ctx, params, (s) => {
      s.screens?.open(textOf((params as Record<string, unknown>).name).trim());
    });
  },
});

const closeUiScreen = defineEvent({
  name: "Zelda: Close UI Screen",
  description: "Closes a UI screen or layer by its name, else the open screen (back to the one it was opened from); or all of them. / Закрывает экран меню или слой.",
  parameterDefs: {
    name: str("Screen name", "Empty = the open screen. A layer (a screen that does not take the keys) closes only by its name. / Имя экрана или слоя.", ""),
    all: bool("All screens", "Close every open screen and layer. / Закрыть все экраны и слои.", false),
  },
  execute(params, ctx) {
    run("Zelda: Close UI Screen", ctx, params, (s) => s.screens?.close(params.all === true, textOf((params as Record<string, unknown>).name).trim()));
  },
});

const MESSAGE_KINDS = [["sign", "Signs and object texts"], ["item", "Item received (chests, big items)"], ["hint", "Hints (locked, need an item, too heavy)"], ["info", "Short notes (saved, rupees and other pickups)"]] as const;

const messageStyle = defineEvent({
  name: "Zelda: Message Style",
  description: "Shows toolkit messages (signs, \"You got...\") as PS Maker dialogues, with everything their dialogue layout has (Game UI → Dialogue layouts: background, font, name box, portrait, typing sound). The game waits while one is open. Put it after Start Toolkit. / Сообщения Toolkit диалогом PS Maker.",
  parameterDefs: {
    layout: dialogLayoutField("Dialogue layout", "Which dialogue layout of the project the messages use. / Макет диалога PS Maker."),
    kinds: { ...multi("Messages as dialogues", "Which toolkit messages are dialogues; the others stay short HUD notes. / Какие сообщения показывать диалогом.", MESSAGE_KINDS), defaultValue: ["sign", "item"] },
  },
  execute(params, ctx) {
    run("Zelda: Message Style", ctx, params, (s, tk) => {
      const p = params as Record<string, unknown>;
      const story = psStory(s, "Message Style");
      const raw = Array.isArray(p.kinds) ? p.kinds : ["sign", "item"];
      const kinds = raw.filter((k): k is MessageKind => typeof k === "string" && MESSAGE_KINDS.some(([v]) => v === k));
      const layout = textOf(p.layout);
      const layouts = (story?.gameUI?.dialogLayouts ?? []) as { id?: string }[];
      if (layout && !layouts.some((l) => l?.id === layout)) s.logger.warn(`Message Style: dialogue layout "${layout}" is not in the project; the default one is used.`);
      tk.messageBox = { layoutId: layout, kinds };
    });
  },
});

const showMessage = defineEvent({
  name: "Zelda: Show Message",
  description: "Shows a toolkit message: a short HUD note, or a PS Maker dialogue (layout from Message Style). For conversations use PS Maker's Dialogue. / Сообщение Toolkit.",
  parameterDefs: {
    text: str("Text", "Message to show. / Текст сообщения.", ""),
    durationMs: num("Duration (ms)", "How long a short note stays: 1000 = one second. / Сколько показывать.", 2200),
    box: bool("As a dialogue", "Show it as a PS Maker dialogue (closed with the action key) instead of a note. / Диалогом.", false),
  },
  execute(params, ctx) {
    run("Zelda: Show Message", ctx, params, (s) => s.bus.emit("zelda:message", { text: s.i18n.text(params.text), durationMs: params.durationMs, ...(boolOr(params.box, false) ? { kind: "box" as const } : {}) }));
  },
});

const STAT_OPTIONS = [
  ["rupees", "Rupees"],
  ["bombs", "Bombs"],
  ["arrows", "Arrows"],
  ["key", "Small keys (this dungeon)"],
  ["hearts", "Hearts"],
  ["maxHearts", "Max hearts (heart containers)"],
  ["fullHearts", "Full hearts (whole number)"],
  ["halfHeart", "Half heart (1 or 0)"],
  ["health", "Health points"],
  ["maxHealth", "Max health points"],
  ["magic", "Magic"],
  ["magicPercent", "Magic in % (0-100)"],
  ["itemName", "Selected item: name (Text variable)"],
  ["itemCount", "Selected item: ammo (bombs, arrows)"],
  ["selected", "Item is selected (1 or 0)"],
  ["owned", "Item is owned (1 or 0)"],
  ["enemies", "Enemies left on the map"],
] as const;

const linkVariable = defineEvent({
  name: "Zelda: Show Stat In Variable",
  description: "Keeps a project variable equal to a toolkit value (rupees, keys, hearts...). Use it in PS Maker conditions (a shop: if Rupees ≥ 50) or in UI components. Stays on for the whole game. / Значение Toolkit в переменной проекта.",
  parameterDefs: {
    stat: choice("Value", "What to copy. / Что показывать.", STAT_OPTIONS, "rupees"),
    item: choice("Item", "For \"Item is selected / owned\". / Предмет.", ITEM_OPTIONS, "bow"),
    variableId: variable("Variable", "A number variable of the project (true/false for 0 / not 0; a Text variable for the item name). / Переменная проекта."),
  },
  execute(params, ctx) {
    run("Zelda: Show Stat In Variable", ctx, params, (s, tk) => {
      const id = textOf(params.variableId);
      if (!id) {
        s.logger.warn("Show Stat In Variable: choose a variable.");
        return;
      }
      if (s.host.getVariable && s.host.getVariable(id) === undefined) s.logger.warn(`Show Stat In Variable: project variable "${id}" not found.`);
      const stat = textOf(params.stat) || "rupees";
      tk.variableLinks.set(id, stat === "selected" || stat === "owned" ? `${stat}:${textOf((params as Record<string, unknown>).item) || "bow"}` : stat);
    });
  },
});

const setRespawn = defineEvent({
  name: "Zelda: Set Respawn Point",
  description: "Where the player revives after falling in battle on this map (empty = current position). / Точка возрождения.",
  parameterDefs: { position: mapPos("Position", "Respawn point.") },
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

// ---- extension by data --------------------------------------------------------------------------

const defineItem = defineEvent({
  name: "Zelda: Define Item",
  description: "Adds a usable item without code: a shot (Damage > 0), a burst around the player (Area attack) or a healing item (Heal > 0). With none of these it is a quest item. / Свой предмет без кода.",
  parameterDefs: {
    slot: choice("Item", "Which custom item this defines; then pick it in Give Item, chests, rules. / Какой свой предмет.", CUSTOM_ITEM_SLOTS, "custom_item_1"),
    name: str("Name", "Shown in messages and the inventory. / Название.", "Ice Rod"),
    icon: img("Icon", "Optional icon image. / Иконка."),
    resource: choice("Uses", "What one use costs. / Что расходует.", [["", "Nothing"], ...RESOURCE_OPTIONS], "magic"),
    cost: num("Cost", "How much of it per use (magic meter: 32 points). / Стоимость.", 4),
    damage: num("Damage", "Damage of the shot or burst; 0 = no attack. / Урон.", 3),
    damageType: choice("Damage type", "Enemies may resist some types. / Тип урона.", DAMAGE_TYPES, "magic"),
    area: bool("Area attack", "Hit everything around the player instead of shooting. / Удар вокруг игрока.", false),
    stunMs: num("Stun (ms)", "Freeze hit enemies; 1000 = one second.", 0),
    heal: num("Heal", "Half-hearts restored per use (makes it a healing item). / Лечение.", 0),
    give: bool("Give now", "Also give the item to the player.", false),
  },
  execute(params, ctx) {
    run("Zelda: Define Item", ctx, params, (_s, tk) => {
      const id = textOf(params.slot) || "custom_item_1";
      const damage = numOr(params.damage, 0);
      const heal = numOr(params.heal, 0);
      const type = damageType(textOf(params.damageType) || "magic");
      const stunMs = Math.max(0, numOr(params.stunMs, 0));
      const spec: DataItemSpec = {
        id,
        name: textOf(params.name) || id,
        icon: assetId(params.icon) || undefined,
        resource: textOf(params.resource) || undefined,
        cost: Math.max(0, numOr(params.cost, 1)),
        effect: heal > 0 ? "heal" : damage > 0 ? (boolOr(params.area, false) ? "area" : "projectile") : "none",
        amount: heal,
        projectile: { damage, damageType: type, stunMs },
        area: { damage, damageType: type, stunMs },
      };
      tk.items.register(createDataItem(spec));
      if (boolOr(params.give, false)) tk.inventory.give(spec.id, 1, { silent: true });
    });
  },
});

const defineEnemy = defineEvent({
  name: "Zelda: Define Enemy",
  description: "Makes your own enemy type from an existing one: other stats and a PS Maker character's look. Then choose it as Template in Create Enemy. / Свой тип врага.",
  parameterDefs: {
    slot: choice("Enemy type", "Which custom type this defines. / Какой свой тип.", CUSTOM_ENEMY_SLOTS, "custom_enemy_1"),
    basedOn: choice("Based on", "Behaviour to start from. / На основе шаблона.", TEMPLATE_OPTIONS, "soldier"),
    look: npc("Look (PS Maker character)", "Optional: a character from your library; its animations and collision box are used. / Внешний вид — персонаж PS Maker."),
    ...STAT_FIELDS,
    detectRange: num("Sight range", "Pixels at which it notices the player; 0 = template value. / Дальность обзора.", 0),
    boss: bool("Boss", "Defeating it completes the dungeon (with Enter Dungeon). / Босс.", false),
    immuneTo: multi("Immune to", "Damage types that do nothing to it. / Неуязвим к.", DAMAGE_TYPES),
    ...SPRITE_FIELDS,
  },
  execute(params, ctx) {
    run("Zelda: Define Enemy", ctx, params, (s, tk) => {
      const name = textOf(params.slot) || "custom_enemy_1";
      const t: Partial<EnemyConfig> & { extends?: string } = { extends: textOf(params.basedOn) || "soldier" };
      const anims: Record<string, string> = {};
      applyLook(s, tk, params.look, t, anims, "Define Enemy");
      if (Object.keys(anims).length) t.animations = anims as EnemyConfig["animations"];
      Object.assign(t, enemyStats(params));
      const range = numOr(params.detectRange, 0);
      if (range > 0) t.detectRange = range;
      if (boolOr(params.boss, false)) t.boss = true;
      const immune = multiOf(params.immuneTo).map(damageType);
      if (immune.length) t.resistances = { ...(t.resistances ?? {}), ...Object.fromEntries(immune.map((d) => [d, 0])) };
      tk.enemyTemplates.define(name, t);
    });
  },
});

/**
 * PS Maker's StoryRunner runs the actions of an event one after another and waits
 * for `ctx.endAction()` before the next one (confirmed in the PS Maker 1.2.1 runtime;
 * the published 0.0.3 typings do not mention it). Every toolkit action does its work
 * synchronously, so it ends right after, also when it failed.
 */
function endsAction(e: PluginEvent<any>): PluginEvent<any> {
  const execute = e.execute;
  return {
    ...e,
    execute(params: any, ctx: any) {
      const before = getToolkit().session;
      try {
        execute.call(e, params, ctx);
      } finally {
        try {
          recordMapAction(e.name, (p, c) => execute.call(e, p as any, c as any), params, ctx, before);
        } catch (err) {
          getToolkit().logger.error(`Could not remember "${e.name}" for this map:`, err);
        }
        (ctx as { endAction?: (result?: object) => void } | undefined)?.endAction?.({});
      }
    },
  };
}

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
  changeObject,
  removeTarget,
  damageTarget,
  addRule,
  runActions,
  switchSequence,
  waveRoom,
  addWaveEnemy,
  enterDungeon,
  giveItem,
  spendResource,
  removeItem,
  equipItem,
  changePlayerStats,
  setAbility,
  showMessage,
  messageStyle,
  uiLayout,
  openUiScreen,
  closeUiScreen,
  linkVariable,
  setRespawn,
  respawnPlayer,
  defineItem,
  defineEnemy,
  setPlayerSprites,
  setSound,
].map((e) => withUi(endsAction(e)));
