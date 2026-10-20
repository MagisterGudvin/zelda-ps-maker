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
import { deriveMapId, ensureSession, getToolkit, startSession } from "./runtime.ts";
import { mapSceneOf } from "../host/phaserHost.ts";
import { parseFlagValue, parseJsonValue, pickImageSource, resolveImage, resolveNpc, resolvePosition } from "./paramResolvers.ts";
import { type AnimDef, validateAnim } from "../core/animation.ts";
import { type Facing, isFacing } from "../core/math.ts";

// ---- parameter helpers ------------------------------------------------------------------
// `label` is used by the official CLI templates but missing from the 0.0.3
// typings; it is passed through untyped and is harmless if ignored.

const str = (label: string, description: string, defaultValue = "") => ({ type: "string" as const, label, description, defaultValue });
const num = (label: string, description: string, defaultValue = 0) => ({ type: "number" as const, label, description, defaultValue });
const bool = (label: string, description: string, defaultValue = false) => ({ type: "boolean" as const, label, description, defaultValue });
const pos = (label: string, description: string) => ({ type: "position" as const, label, description });
const npc = (label: string, description: string) => ({ type: "npc" as const, label, description });
const img = (label: string, description: string) => ({ type: "image" as const, label, description });

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

function where(s: Session, ctx: Ctx, position: unknown, npcValue: unknown, what: string): { x: number; y: number; adopt: unknown } | null {
  const adopt = resolveNpc(npcValue, ctx.scene);
  if (adopt) return { x: adopt.x, y: adopt.y, adopt };
  if (npcValue !== undefined && npcValue !== null && npcValue !== "") s.logger.warn(`${what}: NPC "${String(npcValue)}" was not found in the scene; using the position parameter.`);
  const p = resolvePosition(position, s.config);
  if (p && p.x === 0 && p.y === 0) s.logger.warn(`${what}: Position is X 0, Y 0 (top-left corner) — was it left unset? Tip: F9 in playtest, then click the map to get coordinates.`);
  if (p) return { x: p.x, y: p.y, adopt: undefined };
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

const startToolkit = defineEvent({
  name: "Zelda: Start Toolkit",
  description: "Starts Zelda Maker Toolkit on this map. Put it first in the map's On-load events. / Запускает Toolkit на карте (первым в On-load событиях).",
  parameterDefs: {
    mapId: str("Map ID", "Unique map name used to remember chests, doors and switches. / Уникальное имя карты для сохранения прогресса.", ""),
    preset: str("Preset", "Balance preset: alttp, casual, hardcore. / Пресет баланса.", "alttp"),
    config: str("Config JSON", 'Optional JSON overrides, e.g. {"sword":{"damage":3}}. / JSON-настройки.', ""),
    language: str("Language", "auto, en or ru. / Язык интерфейса.", "auto"),
    debugHitboxes: bool("Show hitboxes", "Draw collision/hitbox overlay (toggle with F9). / Показать хитбоксы.", false),
    diagnostics: bool("Show diagnostics", "On-screen panel with positions and recent messages (toggle with F10). / Панель диагностики.", false),
  },
  execute(params, ctx) {
    const tk = getToolkit();
    tk.logger.info(`Start Toolkit ${describeParams(params)}`);
    try {
      if (params.preset) tk.applyPreset(params.preset);
      const { value, error } = parseJsonObject(params.config, "Start Toolkit config");
      if (error) tk.logger.warn(error);
      if (value) tk.configure(value, "Start Toolkit");
      if (params.language) tk.configure({ language: params.language }, "Start Toolkit");
      tk.configure({ debug: { hitboxes: !!params.debugHitboxes, diagnostics: !!params.diagnostics } }, "Start Toolkit");
      const current = tk.session;
      const mapId = params.mapId || undefined;
      if (current && !current.isDisposed && (current.host as { scene?: unknown }).scene === mapSceneOf(ctx) && (!mapId || mapId === current.mapId)) return;
      startSession(ctx, mapId ?? deriveMapId(ctx.scene));
    } catch (err) {
      tk.logger.error('Action "Zelda: Start Toolkit" failed:', err);
      if (tk.config.debug.rethrowErrors) throw err;
    }
  },
});

const configure = defineEvent({
  name: "Zelda: Configure",
  description: "Changes toolkit settings with JSON at any time (controls, balance, UI). / Меняет настройки JSON-ом.",
  parameterDefs: { config: str("Config JSON", 'e.g. {"controls":{"sword":["Space"]},"ui":{"position":"top-right"}}', "") },
  execute(params, ctx) {
    run("Zelda: Configure", ctx, params, (s, tk) => {
      const { value, error } = parseJsonObject(params.config, "Configure");
      if (error) s.logger.warn(error);
      if (value) tk.configure(value, "Configure");
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

const diagnosticsAction = defineEvent({
  name: "Zelda: Diagnostics",
  description: "Shows an on-screen panel: player/camera positions, nearby toolkit objects, recent messages (same as F10). Use it when something does not appear. / Панель диагностики.",
  parameterDefs: { enabled: bool("Enabled", "Show the panel.", true) },
  execute(params, ctx) {
    run("Zelda: Diagnostics", ctx, params, (s) => s.debug?.setDiagnostics(!!params.enabled));
  },
});

const toggleDebug = defineEvent({
  name: "Zelda: Toggle Debug",
  description: "Shows or hides the hitbox/state overlay. / Показ отладочных хитбоксов.",
  parameterDefs: { enabled: bool("Enabled", "Show the overlay.", true) },
  execute(params, ctx) {
    run("Zelda: Toggle Debug", ctx, params, (s) => s.debug?.setEnabled(!!params.enabled));
  },
});

// ---- enemies & objects -----------------------------------------------------------------------

const createEnemy = defineEvent({
  name: "Zelda: Create Enemy",
  description: "Spawns an enemy from a template (slime, soldier, spitter, knight, sentry, ogre or your own). / Создаёт врага по шаблону.",
  parameterDefs: {
    template: str("Template", "Enemy template name.", "slime"),
    position: pos("Position", "Where to spawn (ignored if an NPC is chosen)."),
    npc: npc("Use NPC", "Optional: turn this placed NPC into the enemy (uses its sprite). / Превратить NPC во врага."),
    id: str("ID", "Optional unique id (needed for persistent bosses and rules).", ""),
    group: str("Group", 'Group for rules like {"enemiesDefeated":"room1"}.', ""),
    animations: str("Animations", "Optional sprite-sheet animations: walk=slime_walk, attack=slime_attack, hurt=..., death=..., idle=... (ids from Zelda: Define Animation). / Анимации из спрайт-листа.", ""),
    patrol: str("Patrol markers", "Optional: marker IDs placed with Zelda: Place Marker, walked in order, e.g. p1,p2,p3. / Маршрут патруля по маркерам.", ""),
    overrides: str("Overrides JSON", 'Change stats, e.g. {"hp":6,"speed":50,"resistances":{"arrow":0}}', ""),
  },
  execute(params, ctx) {
    run("Zelda: Create Enemy", ctx, params, (s) => {
      const at = where(s, ctx, params.position, params.npc, "Create Enemy");
      if (!at) return;
      const overrides = json<Partial<EnemyConfig>>(s, params.overrides, "Create Enemy overrides") ?? {};
      const anims = parseAnimationMap(params.animations ?? "");
      if (anims) overrides.animations = { ...(overrides.animations ?? {}), ...anims } as EnemyConfig["animations"];
      const route = (params.patrol ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (route.length > 0) overrides.patrol = { ...(overrides.patrol ?? {}), mode: "path", points: route as unknown as EnemyConfig["patrol"]["points"] } as EnemyConfig["patrol"];
      spawnEnemy(s, params.template || "slime", at.x, at.y, { id: params.id || undefined, group: params.group, overrides, adopt: at.adopt });
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
    id: str("ID", "Unique id (required for persistence and rules).", ""),
    config: str("Config JSON", 'Overrides, e.g. {"tools":["arrow"],"setFlag":"eye_hit","onActivate":[{"openDoor":"d1"}]}', ""),
    sprite: img("Sprite", "Optional custom image for the object."),
  },
  execute(params, ctx) {
    run("Zelda: Create Object", ctx, params, (s) => {
      const at = where(s, ctx, params.position, undefined, "Create Object");
      if (!at) return;
      const overrides = json<Partial<ObjectConfig>>(s, params.config, "Create Object config") ?? {};
      const sprite = resolveImage(params.sprite);
      if (sprite) overrides.sprite = overrides.sprite ?? sprite;
      createObject(s, params.type || "bush", at.x, at.y, { id: params.id || undefined, overrides });
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
    hidden: bool("Hidden", "Starts invisible; reveal it with a rule or `Zelda: Reveal Object`.", false),
  },
  execute(params, ctx) {
    run("Zelda: Create Chest", ctx, params, (s) => {
      const at = where(s, ctx, params.position, undefined, "Create Chest");
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
  description: "Places a door. Lock: none, small_key, big_key or switch (opened by rules). / Дверь: замок small_key, big_key или switch.",
  parameterDefs: {
    id: str("ID", "Unique door id.", "door_1"),
    position: pos("Position", "Door center."),
    lock: str("Lock", "none | small_key | big_key | switch", "small_key"),
    startOpen: bool("Start open", "Shutter doors that close when a fight starts.", false),
  },
  execute(params, ctx) {
    run("Zelda: Create Door", ctx, params, (s) => {
      const at = where(s, ctx, params.position, undefined, "Create Door");
      if (!at) return;
      const lock = ["none", "small_key", "big_key", "switch"].includes(params.lock) ? params.lock : "small_key";
      createObject(s, "door", at.x, at.y, { id: params.id || undefined, overrides: { lock: lock as ObjectConfig["lock"], startOpen: !!params.startOpen } });
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
      const at = where(s, ctx, params.position, undefined, "Place Item");
      if (at) placePickup(s, params.item, Math.max(1, params.count || 1), at.x, at.y, params.id || undefined);
    });
  },
});

const removeTarget = defineEvent({
  name: "Zelda: Remove Target",
  description: "Removes an enemy or object by id (enemies die without drops). / Удаляет врага или объект.",
  parameterDefs: { id: str("ID", "Enemy or object id.", "") },
  execute(params, ctx) {
    run("Zelda: Remove Target", ctx, params, (s) => {
      const e = s.world.get(params.id);
      if (e) s.world.remove(e);
      else s.logger.warn(`Remove Target: "${params.id}" not found.`);
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
  description: 'When a condition becomes true, run actions. E.g. when {"switchOn":["plate_1"]} then [{"openDoor":"door_2"}]. / Правило «условие → действия».',
  parameterDefs: {
    id: str("Rule ID", "Unique rule id.", "rule_1"),
    when: str("When (JSON)", 'Condition, e.g. {"enemiesDefeated":"room1"}', ""),
    then: str("Then (JSON)", 'Actions, e.g. [{"reveal":"chest_2"},{"message":"A chest appeared!"}]', "[]"),
    else: str("Else (JSON)", "Optional actions when the condition turns false again (needs Once = false).", ""),
    once: bool("Once", "Fire only the first time (remembered in saves).", true),
  },
  execute(params, ctx) {
    run("Zelda: Add Rule", ctx, params, (s) => {
      if (!s.rules) {
        s.logger.warn('Add Rule: the "puzzles" feature is disabled.');
        return;
      }
      const when = json<Record<string, unknown>>(s, params.when, `Rule ${params.id} when`);
      const then = json<RuleAction[]>(s, params.then, `Rule ${params.id} then`);
      const otherwise = json<RuleAction[]>(s, params.else, `Rule ${params.id} else`);
      if (!when || !then) return;
      const spec: RuleSpec = { id: params.id, when, then: Array.isArray(then) ? then : [then], once: params.once };
      if (otherwise) spec.else = Array.isArray(otherwise) ? otherwise : [otherwise];
      s.rules.addRule(spec);
    });
  },
});

const ifAction = defineEvent({
  name: "Zelda: If",
  description: 'Checks a toolkit condition now (item, flag, enemy state...) and runs toolkit actions. E.g. when {"hasItem":"bow"}. / Проверка условия и действия.',
  parameterDefs: {
    when: str("When (JSON)", 'e.g. {"flag":"talked_to_sage"} or {"enemyState":{"id":"boss","state":"dead"}}', ""),
    then: str("Then (JSON)", "Actions if true.", "[]"),
    else: str("Else (JSON)", "Actions if false.", "[]"),
  },
  execute(params, ctx) {
    run("Zelda: If", ctx, params, (s) => {
      if (!s.rules) return;
      const when = json<Record<string, unknown>>(s, params.when, "If when");
      if (!when) return;
      const branch = json<RuleAction[]>(s, s.rules.evaluate(when) ? params.then : params.else, "If branch");
      if (branch) s.rules.execute(Array.isArray(branch) ? branch : [branch], "If");
    });
  },
});

const runActions = defineEvent({
  name: "Zelda: Run Actions",
  description: 'Runs a list of toolkit actions, e.g. [{"giveItem":{"item":"bombs","count":5}},{"openDoor":"d1"}]. / Выполняет список действий.',
  parameterDefs: { actions: str("Actions (JSON)", "Array of action objects.", "[]") },
  execute(params, ctx) {
    run("Zelda: Run Actions", ctx, params, (s) => {
      const list = json<RuleAction[]>(s, params.actions, "Run Actions");
      if (list && s.rules) s.rules.execute(Array.isArray(list) ? list : [list], "Run Actions");
    });
  },
});

const switchSequence = defineEvent({
  name: "Zelda: Create Switch Sequence",
  description: "Switches must be activated in this order; a wrong one resets them. / Переключатели в заданном порядке.",
  parameterDefs: {
    id: str("Puzzle ID", "Unique id; solved state is saved as flag puzzle:<id>.", "sequence_1"),
    switches: str("Switch IDs", "Comma-separated ids in the correct order.", "switch_a,switch_b,switch_c"),
    resetOnWrong: bool("Reset on wrong", "Turn all switches off after a wrong one.", true),
    onSolved: str("On solved (JSON)", 'Actions, e.g. [{"openDoor":"door_3"}]', "[]"),
  },
  execute(params, ctx) {
    run("Zelda: Create Switch Sequence", ctx, params, (s) => {
      if (!s.rules) return;
      const onSolved = json<RuleAction[]>(s, params.onSolved, "Switch sequence onSolved") ?? [];
      s.rules.addSequence({
        id: params.id,
        switches: params.switches.split(",").map((x) => x.trim()).filter(Boolean),
        resetOnWrong: params.resetOnWrong,
        onSolved: Array.isArray(onSolved) ? onSolved : [onSolved],
      });
    });
  },
});

const placeMarker = defineEvent({
  name: "Zelda: Place Marker",
  description:
    'Names a map point once (tip: press F9 in playtest and click the map to get X/Y). Use the name instead of coordinates: patrol routes, Add Wave Enemy, and rule actions like {"spawnEnemy":{"template":"ogre","at":"boss_spot"}}. / Именованная точка карты вместо ввода координат.',
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
    'Names frames of a sprite sheet. Frames: "8,9,10,11" for all directions or JSON per direction {"down":[0,1,2],"up":[8,9,10],"right":[16,17,18]} (left mirrors right if omitted). FPS 0 = stretch over the action. / Анимация из кадров.',
  parameterDefs: {
    id: str("Animation ID", "e.g. hero_slash.", "hero_slash"),
    sheet: str("Sheet ID", "From Zelda: Define Sprite Sheet.", "hero"),
    frames: str("Frames", "Frame numbers (see Preview Sprite Sheet).", ""),
    fps: num("FPS", "Frames per second; 0 = fit the action duration (attacks).", 0),
    loop: bool("Loop", "Repeat (walk/idle).", false),
  },
  execute(params, ctx) {
    run("Zelda: Define Animation", ctx, params, (s, tk) => {
      const t = (params.frames ?? "").trim();
      const frames = t.startsWith("{") || t.startsWith("[") ? json<AnimDef["frames"]>(s, t, `Define Animation ${params.id}`) : t.split(/[\s,;]+/).filter(Boolean).map(Number);
      const def: AnimDef = { sheet: params.sheet, frames: frames ?? [], loop: params.loop };
      if (params.fps > 0) def.fps = params.fps;
      // A missing sheet is only a warning: it may be defined later in the same event list.
      const problems = validateAnim(def, tk.config.sprites.sheets);
      const blocking = problems.filter((p) => !p.startsWith("sheet "));
      if (problems.length > 0) s.logger.warn(`Define Animation "${params.id}": ${problems.join("; ")}.`);
      if (blocking.length > 0 || !params.id) return;
      tk.configure({ sprites: { animations: { [params.id]: def } } }, "Define Animation");
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
    weaponBehind: str("Weapon behind in", "Directions where the weapon is drawn behind the body: up, left...", "up"),
    hidePlayer: bool("Hide PS Maker sprite", "Hide the normal sprite while an animation plays.", true),
    offsetX: num("Offset X", "Pixels.", 0),
    offsetY: num("Offset Y", "Pixels.", 0),
  },
  execute(params, ctx) {
    run("Zelda: Set Player Sprites", ctx, params, (s, tk) => {
      const behind = params.weaponBehind.split(",").map((x) => x.trim()).filter((x): x is Facing => isFacing(x));
      tk.configure(
        {
          player: {
            sprites: {
              attack: params.attack,
              weaponAttack: params.weaponAttack,
              spin: params.spin,
              weaponSpin: params.weaponSpin,
              charge: params.charge,
              weaponCharge: params.weaponCharge,
              hurt: params.hurt,
              weaponBehind: behind,
              hidePlayer: params.hidePlayer,
              offsetX: params.offsetX || 0,
              offsetY: params.offsetY || 0,
            },
          },
        },
        "Set Player Sprites",
      );
      for (const id of [params.attack, params.weaponAttack, params.spin, params.weaponSpin, params.charge, params.weaponCharge, params.hurt]) {
        if (id && !tk.config.sprites.animations[id]) s.logger.warn(`Set Player Sprites: animation "${id}" is not defined yet (Zelda: Define Animation).`);
      }
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
  description: "Room with enemy waves: doors stay shut until every wave is beaten. Add enemies with Zelda: Add Wave Enemy. / Комната с волнами врагов.",
  parameterDefs: {
    id: str("Room ID", "Unique room id (cleared state is saved).", "arena"),
    lockDoors: str("Doors to lock", "Comma-separated door ids closed during the fight.", ""),
    autoStart: bool("Start at once", "Start when the map loads; otherwise use Zelda: Start Waves (e.g. from a trigger area).", false),
    onCleared: str("On cleared (JSON)", 'Actions after the last wave, e.g. [{"reveal":"arena_chest"}]', "[]"),
    advanced: str("Advanced JSON", 'Optional: extra fields, e.g. {"delayMs":1000} or whole waves [[{"template":"slime","at":"m1"}]].', ""),
  },
  execute(params, ctx) {
    run("Zelda: Create Wave Room", ctx, params, (s) => {
      if (!s.dungeons) return;
      const extra = json<Partial<WaveRoomSpec>>(s, params.advanced, "Wave room advanced") ?? {};
      const onCleared = json<RuleAction[]>(s, params.onCleared, "Wave room onCleared");
      s.dungeons.addWaveRoom({
        ...extra,
        id: params.id || extra.id || "arena",
        autoStart: params.autoStart,
        lockDoors: params.lockDoors ? params.lockDoors.split(",").map((x) => x.trim()).filter(Boolean) : (extra.lockDoors ?? []),
        onCleared: onCleared ? (Array.isArray(onCleared) ? onCleared : [onCleared]) : extra.onCleared,
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
    overrides: str("Overrides JSON", 'Optional stat changes, e.g. {"hp":4}.', ""),
  },
  execute(params, ctx) {
    run("Zelda: Add Wave Enemy", ctx, params, (s) => {
      if (!s.dungeons) return;
      const p = resolvePosition(params.position, s.config);
      if (!p) {
        s.logger.warn(`Add Wave Enemy: no valid position (got ${JSON.stringify(params.position)}).`);
        return;
      }
      const overrides = json<Partial<EnemyConfig>>(s, params.overrides, "Add Wave Enemy overrides") ?? undefined;
      // Store as a marker: resolvePosition already converted to pixels.
      const marker = `__wave_${params.roomId}_${s.markers.size}`;
      s.markers.set(marker, p);
      s.dungeons.addWaveSpawn(params.roomId, params.wave || 1, { template: params.template || "slime", at: marker, overrides });
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

const enterDungeon = defineEvent({
  name: "Zelda: Enter Dungeon",
  description: "Marks the current dungeon: small keys and the Big Key are counted per dungeon. / Вход в подземелье.",
  parameterDefs: {
    dungeonId: str("Dungeon ID", "Unique dungeon id.", "dungeon_1"),
    completeOnBoss: bool("Complete on boss", "Defeating a boss enemy completes the dungeon.", true),
  },
  execute(params, ctx) {
    run("Zelda: Enter Dungeon", ctx, params, (s) => s.dungeons?.enter(params.dungeonId, { completeOnBoss: params.completeOnBoss }));
  },
});

const leaveDungeon = defineEvent({
  name: "Zelda: Leave Dungeon",
  description: "Back to the overworld key counter. / Выход из подземелья.",
  parameterDefs: {},
  execute(params, ctx) {
    run("Zelda: Leave Dungeon", ctx, params, (s) => s.dungeons?.leave());
  },
});

// ---- object state ---------------------------------------------------------------------------

const activateSwitch = defineEvent({
  name: "Zelda: Activate Switch",
  description: "Turns a lever/button/plate on or off. / Включает или выключает переключатель.",
  parameterDefs: { id: str("ID", "Switch id.", ""), on: bool("On", "true = on, false = off.", true) },
  execute(params, ctx) {
    run("Zelda: Activate Switch", ctx, params, (s) => objectById(s, params.id, "Activate Switch")?.setState(params.on ? "on" : "off"));
  },
});

const openDoor = defineEvent({
  name: "Zelda: Open Door",
  description: "Opens a door (or chest) by id. / Открывает дверь или сундук.",
  parameterDefs: { id: str("ID", "Door id.", "") },
  execute(params, ctx) {
    run("Zelda: Open Door", ctx, params, (s) => objectById(s, params.id, "Open Door")?.open());
  },
});

const closeDoor = defineEvent({
  name: "Zelda: Close Door",
  description: "Closes a door by id. / Закрывает дверь.",
  parameterDefs: { id: str("ID", "Door id.", "") },
  execute(params, ctx) {
    run("Zelda: Close Door", ctx, params, (s) => objectById(s, params.id, "Close Door")?.close());
  },
});

const setObjectState = defineEvent({
  name: "Zelda: Set Object State",
  description: "Sets an object's state: on, off, opened, closed, locked, unlocked, lit, destroyed, revealed, hidden. / Меняет состояние объекта.",
  parameterDefs: { id: str("ID", "Object id.", ""), state: str("State", "New state.", "on") },
  execute(params, ctx) {
    run("Zelda: Set Object State", ctx, params, (s) => objectById(s, params.id, "Set Object State")?.setState(params.state as ObjectState));
  },
});

const revealObject = defineEvent({
  name: "Zelda: Reveal Object",
  description: "Makes a hidden object (chest, passage...) appear. / Показывает скрытый объект.",
  parameterDefs: { id: str("ID", "Object id.", "") },
  execute(params, ctx) {
    run("Zelda: Reveal Object", ctx, params, (s) => objectById(s, params.id, "Reveal Object")?.reveal());
  },
});

const resetObject = defineEvent({
  name: "Zelda: Reset Object",
  description: "Restores an object to its initial state and forgets its saved progress. / Сбрасывает объект.",
  parameterDefs: { id: str("ID", "Object id.", "") },
  execute(params, ctx) {
    run("Zelda: Reset Object", ctx, params, (s) => objectById(s, params.id, "Reset Object")?.reset());
  },
});

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

const changePlayerHealth = defineEvent({
  name: "Zelda: Change Player Health",
  description: "mode add (+/-), set (exact value) or max (change maximum and refill). 1 heart = 2 points by default. / Здоровье игрока.",
  parameterDefs: { mode: str("Mode", "add | set | max", "add"), amount: num("Amount", "Health points.", 2) },
  execute(params, ctx) {
    run("Zelda: Change Player Health", ctx, params, (_s, tk) => {
      if (params.mode === "set") setHealth(tk, params.amount);
      else if (params.mode === "max") setMaxHealth(tk, params.amount, true);
      else changeHealth(tk, params.amount);
    });
  },
});

const changeMagicAction = defineEvent({
  name: "Zelda: Change Magic",
  description: "Adds or removes magic points. / Изменяет магию.",
  parameterDefs: { amount: num("Amount", "Magic points (+/-).", 8) },
  execute(params, ctx) {
    run("Zelda: Change Magic", ctx, params, (_s, tk) => {
      changeMagic(tk, params.amount);
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
  description:
    'Adds a custom item without code. JSON: {"id":"ice_rod","name":{"en":"Ice Rod","ru":"Ледяной жезл"},"resource":"magic","cost":4,"effect":"projectile","projectile":{"damageType":"ice","damage":3,"stunMs":1000}}',
  parameterDefs: {
    json: str("Item JSON", "Item definition (see description and docs/ITEMS.md).", ""),
    give: bool("Give now", "Also give the item to the player.", false),
  },
  execute(params, ctx) {
    run("Zelda: Define Item", ctx, params, (s, tk) => {
      const spec = json<DataItemSpec>(s, params.json, "Define Item");
      if (!spec) return;
      tk.items.register(createDataItem(spec));
      if (params.give) tk.inventory.give(spec.id, 1, { silent: true });
    });
  },
});

const defineEnemy = defineEvent({
  name: "Zelda: Define Enemy",
  description: 'Adds an enemy template. JSON: {"extends":"soldier","hp":8,"tint":16729156,"resistances":{"fire":0}}',
  parameterDefs: {
    name: str("Template name", "New template name.", "red_soldier"),
    json: str("Template JSON", "Fields of the enemy config (see docs/ENEMIES.md).", ""),
  },
  execute(params, ctx) {
    run("Zelda: Define Enemy", ctx, params, (s, tk) => {
      const t = json<Partial<EnemyConfig> & { extends?: string }>(s, params.json, "Define Enemy");
      if (t) tk.enemyTemplates.define(params.name, t);
    });
  },
});

const killEnemy = defineEvent({
  name: "Zelda: Defeat Enemy",
  description: "Defeats an enemy (or every enemy of a group) as if killed in battle. / Побеждает врага или группу.",
  parameterDefs: { id: str("ID", "Enemy id (leave empty to use Group).", ""), group: str("Group", "Enemy group.", "") },
  execute(params, ctx) {
    run("Zelda: Defeat Enemy", ctx, params, (s) => {
      for (const e of s.world.list("enemy")) {
        if (!(e instanceof Enemy)) continue;
        if ((params.id && e.id === params.id) || (!params.id && params.group && e.group === params.group)) e.die();
      }
    });
  },
});

/** Every action shown in the PS Maker event editor. */
export const ZELDA_ACTIONS: PluginEvent<any>[] = [
  startToolkit,
  configure,
  stopToolkit,
  pauseCombat,
  toggleDebug,
  diagnosticsAction,
  createEnemy,
  createObjectAction,
  createChest,
  createDoor,
  placeItem,
  removeTarget,
  damageTarget,
  killEnemy,
  addRule,
  ifAction,
  runActions,
  switchSequence,
  placeMarker,
  defineSheet,
  defineAnimation,
  setPlayerSprites,
  previewSheet,
  waveRoom,
  addWaveEnemy,
  startWaves,
  enterDungeon,
  leaveDungeon,
  activateSwitch,
  openDoor,
  closeDoor,
  setObjectState,
  revealObject,
  resetObject,
  giveItem,
  spendResource,
  removeItem,
  equipItem,
  changePlayerHealth,
  changeMagicAction,
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
];
