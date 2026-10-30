/**
 * Builds the Zelda Maker Toolkit demo as a PS Maker project (story.json) from the demo maps in
 * examples/harness/demo-maps.js and the built-in "Tiles 'N Such Assets" pack of an existing
 * project. Pure: no file access (see make-demo-project.mjs for the command line tool).
 *
 * The story format follows the PS Maker 1.2.1 source (docs/ENGINE_AUDIT.md, section 13):
 * terrainGrid[x][y] = terrain id per 16 px cell, map objects and NPCs by their centre, map
 * collisions as top-left rectangles, trigger areas by their centre, plugin actions as
 * { type: "plugin:<plugin>:<action>", pluginName, actionName, pluginParams }.
 */

import { UI_ASSETS } from "./ui-assets.mjs";

const TILE = 16;
const PACK = "Tiles 'N Such Assets";

/** UI pictures of the demo (scripts/ui-assets.mjs) in the project's Images: id = file name without .png. */
export const UI_IMAGES = UI_ASSETS.map((a) => ({ id: a.key.replace(/\.png$/, ""), name: a.name, url: a.key }));

/** PS Maker UI backgrounds: a picture as a 9-slice, its border drawn at 4× (the game's zoom). */
const nineSlice = (imageId, slice, opacity = 100) => ({ type: "image", imageId, backgroundOpacity: opacity, scalingMode: "nine-slice", borderWidth: slice * 4, slice: { top: slice, right: slice, bottom: slice, left: slice }, repeat: "stretch" });
const CREAM = "#F2E4BB";
export const DIALOG_LAYOUT_ID = "zelda-dialogue-layout";
export const BUTTON_STYLE_ID = "zelda-button-style";

/** The main menu map (the game starts on it). */
export const TITLE_MAP_ID = "zelda-demo-title";

/**
 * The demo's font (Game UI → Fonts): Pixelify Sans (SIL OFL 1.1, scripts/demo-assets), a pixel font
 * with Cyrillic. PixelOperator, the font of a new PS Maker project, has no Cyrillic letters, so
 * Russian text in it falls back to the browser's serif font.
 */
export const DEMO_FONT = { id: "zelda-font-pixelify-sans", name: "Pixelify Sans", key: "PixelifySans.ttf" };

/** Text variable that carries the toolkit's progress in PS Maker saves (Start Toolkit → Progress variable). */
export const PROGRESS_VARIABLE = { id: "zelda-progress", name: "Zelda progress", type: "string", defaultValue: "" };

/** Library assets the demo uses, by their names in the pack. */
export const DEMO_ASSETS = {
  terrains: { grass: "Flat Grass", dirt: "Flat Dirt", fence: "Fence", stone: "Path", floor: "Patio Tiles", wall: "Interior Border" },
  characters: { slime: "Slime", sentry: "Bone Slime", spitter: "Magma Slime", soldier: "New Male", guard: "New Female", ogre: "Bull" },
  objects: { tree: "Big Oak", oak: "Medium Oak", bush: "Small Bush", rock: "Rock", mushroom: "small mushroom", barrel: "Barrel", crates: "Crates", crate: "Crate" },
};

/** Enemy types for wave enemies and the arena guardian: Define Enemy slots with a pack character as look. */
const WAVE_LOOKS = [
  ["slime", "custom_enemy_1", "slime"],
  ["soldier", "custom_enemy_2", "soldier"],
  ["spitter", "custom_enemy_3", "spitter"],
  ["ogre", "custom_enemy_4", "ogre"],
];

/** PS Maker's sanitizeName (pluginActionTypeHelpers.ts). */
export function sanitizeName(name) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/:/g, "-").replace(/[^a-z0-9\-_]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/** A small deterministic random generator, so the same seed gives the same ids. */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * @param {{
 *   source: any,                 // story.json of a project that has the Tiles 'N Such pack
 *   plugin: { name: string, actions: Array<{ name: string, parameterDefs: Record<string, { defaultValue?: unknown }> }> },
 *   maps: Record<string, any>,   // MAPS from examples/harness/demo-maps.js
 *   name?: string,
 *   seed?: number,
 *   now?: number,
 * }} options
 * @returns {{ story: any, warnings: string[] }}
 */
export function buildDemoStory({ source, plugin, maps, name = "Zelda Toolkit Demo", seed = Date.now(), now = Date.now() }) {
  const rnd = seeded(seed);
  const used = new Set();
  const makeId = (len = 8) => {
    for (;;) {
      const id = Array.from({ length: len }, () => ID_CHARS[Math.floor(rnd() * ID_CHARS.length)]).join("");
      if (!used.has(id)) return used.add(id), id;
    }
  };
  const warnings = [];
  const missing = [];
  const byName = (list, wanted, what) => {
    const norm = (s) => String(s ?? "").trim().toLowerCase();
    const hit = (list ?? []).find((e) => norm(e.name) === norm(wanted));
    if (!hit) missing.push(`${what} "${wanted}"`);
    return hit;
  };
  const terrain = Object.fromEntries(Object.entries(DEMO_ASSETS.terrains).map(([k, n]) => [k, byName(source.terrains, n, "terrain")?.id]));
  const character = Object.fromEntries(Object.entries(DEMO_ASSETS.characters).map(([k, n]) => [k, byName(source.characters, n, "character")?.id]));
  const object = Object.fromEntries(Object.entries(DEMO_ASSETS.objects).map(([k, n]) => [k, byName(source.mapObjects, n, "map object")?.id]));
  if (missing.length) {
    throw new Error(
      `The source project lacks ${missing.join(", ")}. Open it in PS Maker, add the built-in "${PACK}" asset pack (terrains, map objects and characters), save, and run again.`,
    );
  }

  // ---- actions ------------------------------------------------------------------------------
  const pluginType = sanitizeName(plugin.name);
  const pluginAction = (actionName, params) => {
    const def = plugin.actions.find((a) => a.name === actionName);
    if (!def) throw new Error(`The plugin has no action "${actionName}".`);
    for (const key of Object.keys(params)) if (!(key in def.parameterDefs)) throw new Error(`${actionName} has no parameter "${key}".`);
    // The editor saves only parameters that have a default, then whatever the author set.
    const defaults = Object.fromEntries(
      Object.entries(def.parameterDefs)
        .filter(([, d]) => d.defaultValue !== undefined)
        .map(([k, d]) => [k, structuredClone(d.defaultValue)]),
    );
    return { type: `plugin:${pluginType}:${sanitizeName(actionName)}`, name: actionName, id: makeId(), pluginName: plugin.name, actionName, pluginParams: { ...defaults, ...structuredClone(params) } };
  };
  const ownedStoryEvents = [];
  const uiFont = DEMO_FONT;
  const ui = { w: source.gameConfig?.width ?? 1280, h: source.gameConfig?.height ?? 720 };
  const textStyles = (size, color, align = "center", stroke = 0) => ({
    fontFamily: uiFont.name,
    fontAssetId: uiFont.id,
    fontSize: size,
    fontWeight: 400,
    lineHeightPercent: 120,
    letterSpacingPercent: 0,
    color,
    strokeWidth: stroke,
    strokeColor: "#1F1A24",
    outlineOrder: "below-text",
    textAlign: align,
  });
  // The toolkit HUD (Zelda: UI Layout, as the designer saves it) on the demo's own UI pictures:
  // two 9-slice panels, the magic meter, the item box and the counters on the left, "- LIFE -" and
  // the hearts on the right (clear of PS Maker's settings gear). Scale 0: like the map.
  const always = { when: "always" };
  const hudLayout = {
    v: 1,
    scale: 0,
    // The inventory panel (I) on the dialogue panel picture, with a gold cursor.
    theme: { font: uiFont.id, textColor: "#f8e0a0", icons: {}, panel: "zelda-ui-panel", panelSlice: 7, cursor: "zelda-ui-cursor" },
    elements: [
      { id: "leftPanel", type: "image", x: 2, y: 2, w: 122, h: 32, anchor: "tl", show: always, image: "zelda-ui-hud-bar", mode: "nine", slice: 4, color: "" },
      { id: "magic", type: "bar", x: 6, y: 3, w: 8, h: 30, anchor: "tl", show: always, value: "magic", max: "maxMagic", fill: "zelda-ui-magic-fill", back: "zelda-ui-magic-frame", dir: "up", fillColor: "#3ad16b", backColor: "#000000d9" },
      { id: "item", type: "item", x: 18, y: 7, w: 22, h: 22, anchor: "tl", show: always, frame: "zelda-ui-item-box" },
      ...[
        ["rupees", "zelda-ui-rupee", 3, 46],
        ["bombs", "zelda-ui-bomb", 2, 70],
        ["arrows", "zelda-ui-arrow", 2, 88],
        ["key", "zelda-ui-key", 1, 106],
      ].map(([id, icon, places, x]) => ({ id, type: "counter", x, y: 8, w: Math.max(10, places * 6), h: 19, anchor: "tl", show: always, value: id, icon, digits: "zelda-ui-digits", places })),
      { id: "rightPanel", type: "image", x: -116, y: 2, w: 92, h: 32, anchor: "tr", show: always, image: "zelda-ui-hud-bar", mode: "nine", slice: 4, color: "" },
      { id: "life", type: "text", x: -112, y: 4, w: 84, h: 8, anchor: "tr", show: always, text: "{t:hud.life}", font: "", size: 7, color: "", align: "center" },
      { id: "hearts", type: "hearts", x: -112, y: 13, w: 84, h: 17, anchor: "tr", show: always, full: "zelda-ui-heart-full", half: "zelda-ui-heart-half", empty: "zelda-ui-heart-empty", perRow: 8, gap: 1 },
      // A warning that blinks while the player is down to one heart (health 2 or less).
      { id: "lowHealth", type: "text", x: -112, y: 36, w: 84, h: 8, anchor: "tr", show: { when: "compare", id: "health", op: "<=", value: 2 }, effect: "blink", text: "LOW HEALTH", font: "", size: 7, color: "#ff5060", align: "center", stroke: "#1f1a24", strokeWidth: 1 },
    ],
  };
  // A pause screen (Enter) made of the same pictures: its buttons close it or run project events
  // (PS Maker's options menu with saving, the main menu).
  const globalStoryEvents = [
    { name: "Pause: settings", id: "zelda-pause-settings", actions: [{ id: makeId(), name: "Open game options menu", type: "openOptionsMenuAction", showExitGameButton: false, showSaveGameButton: true }], hidden: false },
    {
      name: "Pause: main menu",
      id: "zelda-pause-title",
      actions: [{ id: makeId(), name: "Change map", type: "changeActiveMapAction", destination: { mapId: TITLE_MAP_ID, position: { x: 160, y: 96 } }, faceDirection: "down", fadeOutDuration: 500, fadeInDuration: 500, fadeInTiming: "beforeMapStart", skipFadeIn: false }],
      hidden: false,
    },
  ];
  const pauseButton = (id, text, y, action) => ({ id, type: "button", x: -48, y, w: 96, h: 18, anchor: "c", show: always, image: "zelda-ui-button", hover: "", slice: 6, color: "", hoverColor: "", text, font: "", size: 8, textColor: "", action: { value: "", ...action } });
  const pauseLayout = {
    v: 1,
    scale: 0,
    theme: hudLayout.theme,
    screen: { pause: true, dim: "#1f1a24a0", menuKey: true },
    elements: [
      { id: "panel", type: "image", x: -60, y: -50, w: 120, h: 100, anchor: "c", show: always, image: "zelda-ui-panel", mode: "nine", slice: 7, color: "" },
      { id: "title", type: "text", x: -60, y: -43, w: 120, h: 10, anchor: "c", show: always, text: "Paused", font: "", size: 10, color: "", align: "center" },
      pauseButton("continue", "Continue", -26, { kind: "close", id: "" }),
      pauseButton("settings", "Settings", -4, { kind: "event", id: "zelda-pause-settings" }),
      pauseButton("title", "Main menu", 18, { kind: "event", id: "zelda-pause-title" }),
    ],
  };
  const mapIds = Object.fromEntries(Object.keys(maps).map((key) => [key, `zelda-demo-${key}`]));
  /** A "Player touch" event trigger on an area (top-left rect) that changes the map. */
  const transferTrigger = (rect, to) =>
    eventTrigger(rect, "touch", `To ${to.map}`, [
      {
        id: makeId(),
        name: "Change map",
        type: "changeActiveMapAction",
        destination: { mapId: mapIds[to.map], position: { x: to.x, y: to.y } },
        faceDirection: "none",
        fadeOutDuration: 350,
        fadeInDuration: 350,
        fadeInTiming: "beforeMapStart",
        skipFadeIn: false,
      },
    ]);
  /** An event trigger ("touch" or "interact") on an area (top-left rect) running its own event. */
  const eventTrigger = (rect, triggerType, instanceName, actions) => {
    const actionId = makeId();
    const eventId = makeId();
    ownedStoryEvents.push({
      name: "Trigger event",
      id: eventId,
      actions,
      hidden: true,
      owner: { type: "action", actionId, actionType: "addStoryEventAction", relation: "local-trigger" },
    });
    return {
      id: actionId,
      type: "addStoryEventAction",
      name: "Add event trigger",
      triggerType,
      positionType: "static",
      // PS Maker areas are saved by their centre (AreaEditor/areaGeometry.ts).
      staticArea: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, width: rect.w, height: rect.h },
      removeConditionType: "none",
      removeConditionCount: 1,
      triggerLabelUi: "default",
      overrideTriggerLabel: false,
      triggerLabelText: "",
      waitForCompletion: true,
      instanceName,
      instanceId: makeId(),
      localStoryEventId: eventId,
      storyEventId: eventId,
    };
  };

  // Player attack/hurt sheets, if the project's player has the Tiles 'N Such sword sheets.
  const playerSheet = (sheetName) =>
    (source.spritesheetAnimations ?? []).find((s) => s.ownerRef?.type === "player" && s.name === sheetName)?.animations?.[0]?.id;
  const sprites = { attack: playerSheet("Sword Attack"), hurt: playerSheet("Sword Hurt"), chargeWalk: playerSheet("Sword Walk"), death: playerSheet("Sword Death") };

  // ---- maps ---------------------------------------------------------------------------------
  const builtMaps = Object.entries(maps).map(([key, m]) => {
    const W = m.size.w;
    const H = m.size.h;
    const dungeon = key !== "field";
    const ground = {};
    const details = {};
    const put = (grid, x, y, id) => ((grid[x] ??= {})[y] = id);
    const cellsOf = (r) => {
      const cells = [];
      for (let x = Math.floor(r.x / TILE); x * TILE < r.x + r.w; x++)
        for (let y = Math.floor(r.y / TILE); y * TILE < r.y + r.h; y++) {
          const cx = x * TILE + TILE / 2;
          const cy = y * TILE + TILE / 2;
          if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) cells.push([x, y]);
        }
      return cells;
    };
    // Ground: grass beyond the edges on the field (the camera shows past them), floor inside in the dungeon.
    const pad = dungeon ? 0 : 12;
    for (let x = -pad; x < W / TILE + pad; x++) for (let y = -pad; y < H / TILE + pad; y++) put(ground, x, y, dungeon ? terrain.floor : terrain.grass);
    if (!dungeon) for (let x = 1; x < W / TILE - 1; x++) for (const y of [7, 8]) put(details, x, y, terrain.dirt);
    for (const w of m.walls) {
      // Fence on the top and bottom edges; its autotile has no one-tile vertical piece, so the
      // side edges and inner walls are stone.
      const horizontalEdge = w.w > w.h && (w.y <= 0 || w.y + w.h >= H);
      const id = dungeon ? terrain.wall : horizontalEdge ? terrain.fence : terrain.stone;
      for (const [x, y] of cellsOf(w)) put(details, x, y, id);
    }
    const mapCollisions = m.walls.map((w) => ({ inGameId: makeId(), x: w.x, y: w.y, width: w.w, height: w.h }));

    const mapObjects = [];
    const place = (id, x, y) => id && mapObjects.push({ id: makeId(), mapObjectId: id, position: { x, y } });
    if (!dungeon) {
      for (let x = 8; x < W; x += 56) place(object.tree, x, -36);
      for (let x = 36; x < W; x += 56) place(object.oak, x, H + 28);
      for (let y = 24; y < H; y += 56) place(object.tree, -36, y);
      for (const y of [24, 200]) place(object.tree, W + 40, y);
      place(object.bush, 24, 216);
      place(object.mushroom, 176, 214);
      place(object.rock, 370, 214);
    } else {
      place(object.barrel, 176, 30);
      place(object.crates, 172, 204);
      place(object.crate, 24, 136);
    }

    // Map setup: player start and the NPCs placed in the editor.
    const npcIds = {};
    const setupActions = [];
    if (key === Object.keys(maps)[0])
      setupActions.push({ id: makeId(), name: "Move player", type: "movePlayerAction", moveType: "absolute-position", position: { ...m.spawn }, instant: true, waitForCompletion: true, speedMultiplier: 1, faceDirection: "down" });
    const extra = [];
    if (key === Object.keys(maps)[0]) {
      // A villager who talks with PS Maker's own Dialogue (an "interact" trigger around him).
      setupActions.push({ id: makeId(), name: "Spawn NPC", type: "spawnNPCAction", characterId: character.guard, inGameCharacterId: `in-game-character-${makeId()}`, position: { ...VILLAGER }, faceDirection: "down", fadeInEnabled: false, fadeInDurationMs: 750, waitForCompletion: true, instanceName: "Villager" });
      extra.push(eventTrigger({ x: VILLAGER.x - 24, y: VILLAGER.y - 24, w: 48, h: 48 }, "interact", "Talk to the villager", [{ id: makeId(), name: "Dialogue", type: "dialogueAction", dialogueSource: VILLAGER_TEXT }]));
    }
    for (const n of m.npcs ?? []) {
      npcIds[n.name] = `in-game-character-${makeId()}`;
      setupActions.push({ id: makeId(), name: "Spawn NPC", type: "spawnNPCAction", characterId: character.guard, inGameCharacterId: npcIds[n.name], position: { x: n.x, y: n.y }, faceDirection: "down", fadeInEnabled: false, fadeInDurationMs: 750, waitForCompletion: true, instanceName: "Guard" });
    }

    // Zelda actions, with PS Maker looks: Create Enemy gets the character directly; wave enemies
    // and the arena guardian use Define Enemy types that carry the look.
    const slotOf = Object.fromEntries(WAVE_LOOKS.map(([t, slot]) => [t, slot]));
    const needsSlots = m.onLoad.some(([n, p]) => n === "Zelda: Add Wave Enemy" || (n === "Zelda: Create Wave Room" && p.spawnEnemy));
    const zelda = [];
    for (const [actionName, raw] of m.onLoad) {
      const p = structuredClone(raw);
      if (actionName === "Zelda: Create Enemy" && character[p.template]) p.character = character[p.template];
      if (actionName === "Zelda: Enemy From NPC") p.npc = npcIds[p.npc] ?? p.npc;
      if (actionName === "Zelda: Add Wave Enemy" && slotOf[p.template]) p.template = slotOf[p.template];
      if (actionName === "Zelda: Start Toolkit") p.progressVariable = PROGRESS_VARIABLE.id;
      if (actionName === "Zelda: Create Wave Room" && slotOf[p.spawnEnemy]) p.spawnEnemy = slotOf[p.spawnEnemy];
      zelda.push(pluginAction(actionName, p));
      if (actionName === "Zelda: Start Toolkit") {
        if (sprites.attack) zelda.push(pluginAction("Zelda: Set Player Sprites", Object.fromEntries(Object.entries(sprites).filter(([, id]) => id))));
        zelda.push(pluginAction("Zelda: UI Layout", { layout: JSON.stringify(hudLayout) }));
        zelda.push(pluginAction("Zelda: UI Layout", { name: "pause", layout: JSON.stringify(pauseLayout) }));
        zelda.push(pluginAction("Zelda: Message Style", { layout: DIALOG_LAYOUT_ID, kinds: ["sign", "item"] }));
        if (needsSlots)
          for (const [template, slot, look] of WAVE_LOOKS) zelda.push(pluginAction("Zelda: Define Enemy", { slot, basedOn: template, look: character[look] }));
      }
    }
    if (!sprites.attack && key === "field") warnings.push('The player has no "Sword Attack" sheet: the sword is drawn by the Toolkit.');

    return {
      name: m.title.split(" / ")[0],
      id: mapIds[key],
      mapObjects,
      terrainLayers: [
        { id: "default-terrain-layer-1", name: "Details layer", terrainGrid: details },
        { id: "default-terrain-layer-2", name: "Ground layer", terrainGrid: ground },
      ],
      mapCollisions,
      setupActions,
      // "When map first starts": the Toolkit, objects and enemies, and the transfer triggers.
      initialActions: [...zelda, ...extra, ...(m.triggers ?? []).map((t) => transferTrigger(t.rect, t.transfer))],
      enterActions: [],
      leaveActions: [],
      storyEvents: [],
      tileSize: TILE,
    };
  });

  // ---- title map: the main menu, built with PS Maker's own UI ---------------------------------
  // PS Maker has no title screen: the starting map is one. "Add UI" buttons run hidden events owned
  // by the button (relation "button-click"), like the editor saves them.
  const first = Object.keys(maps)[0];
  const menuActionId = makeId();
  const buttonEvent = (label, actions) => {
    const componentId = `ui-component-${makeId()}`;
    const eventId = makeId();
    ownedStoryEvents.push({ name: `${label} button`, id: eventId, actions, hidden: true, owner: { type: "action", actionId: menuActionId, actionType: "addUiComponentsAction", relation: "button-click", componentId } });
    return { componentId, eventId };
  };
  const MENU = [
    ["New game", [{ id: makeId(), name: "Change map", type: "changeActiveMapAction", destination: { mapId: mapIds[first], position: { ...maps[first].spawn } }, faceDirection: "down", fadeOutDuration: 500, fadeInDuration: 500, fadeInTiming: "beforeMapStart", skipFadeIn: false }]],
    ["Continue", [{ id: makeId(), name: "Open load game menu", type: "openLoadGameMenuAction" }]],
    ["Settings", [{ id: makeId(), name: "Open game options menu", type: "openOptionsMenuAction", showExitGameButton: false, showSaveGameButton: false }]],
    ["Exit", [{ id: makeId(), name: "Exit game", type: "exitGameAction" }]],
  ];
  const text = (label, y, size, color, height, stroke) => ({ type: "text", componentId: `ui-component-${makeId()}`, label, opacity: 100, backgroundEnabled: false, background: { type: "plain", backgroundOpacity: 100, backgroundColor: "#000000", borderColor: "#FFFFFF", borderWidth: 4, borderRadius: 26 }, textStyles: textStyles(size, color, "center", stroke), position: { x: ui.w / 2, y }, size: { width: ui.w - 160, height }, rotation: 0, zIndex: 0, sizeAnchor: "center" });
  const components = [
    text(name, ui.h * 0.2, 96, "#F8E0A0", 130, 8),
    text("Zelda Maker Toolkit · PS Maker", ui.h * 0.2 + 90, 36, CREAM, 50, 5),
    ...MENU.map(([label, actions], i) => {
      const { componentId, eventId } = buttonEvent(label, actions);
      return { type: "button", componentId, styleId: BUTTON_STYLE_ID, label, opacity: 100, disabled: false, storyEventId: eventId, position: { x: ui.w / 2, y: ui.h * 0.47 + i * 90 }, size: { width: 400, height: 76 }, rotation: 0, zIndex: 0, sizeAnchor: "center" };
    }),
  ];
  const TW = 20;
  const TH = 12;
  const titleGround = {};
  const titleDetails = {};
  const put = (grid, x, y, id) => ((grid[x] ??= {})[y] = id);
  for (let x = -12; x < TW + 12; x++) for (let y = -12; y < TH + 12; y++) put(titleGround, x, y, terrain.grass);
  for (let x = 0; x < TW; x++) for (const y of [TH - 3, TH - 2]) put(titleDetails, x, y, terrain.dirt);
  const titleObjects = [];
  for (let x = -8; x < TW * TILE + 40; x += 48) titleObjects.push({ id: makeId(), mapObjectId: object.tree, position: { x, y: 10 } });
  for (const [x, y] of [[40, 120], [280, 120], [24, 150], [300, 150]]) titleObjects.push({ id: makeId(), mapObjectId: object.bush, position: { x, y } });
  builtMaps.push({
    name: "Title",
    id: TITLE_MAP_ID,
    mapObjects: titleObjects,
    terrainLayers: [
      { id: "default-terrain-layer-1", name: "Details layer", terrainGrid: titleDetails },
      { id: "default-terrain-layer-2", name: "Ground layer", terrainGrid: titleGround },
    ],
    mapCollisions: [],
    // The menu is not played: no player, no walking.
    setupActions: [
      { id: makeId(), name: "Move player", type: "movePlayerAction", moveType: "absolute-position", position: { x: (TW * TILE) / 2, y: (TH * TILE) / 2 }, instant: true, waitForCompletion: true, speedMultiplier: 1, faceDirection: "down" },
      { id: makeId(), name: "Set player visibility", type: "setPlayerVisibilityAction", mode: "hide", opacity: 1, fadeEnabled: false, fadeDurationMs: 750, waitForCompletion: true },
      { id: makeId(), name: "Toggle player movement", type: "togglePlayerMovementAction", mode: "disable", applyToSpecificDirections: false, up: true, down: true, left: true, right: true },
    ],
    initialActions: [{ id: menuActionId, name: "Add UI", type: "addUiComponentsAction", uiName: "Main menu", inGameUiId: `in-game-ui-${makeId()}`, fadeEnabled: true, fadeDurationMs: 400, waitForCompletion: false, components }],
    enterActions: [],
    leaveActions: [],
    storyEvents: [],
    tileSize: TILE,
  });

  const story = {
    controls: structuredClone(source.controls),
    metadata: {
      psMakerVersion: source.metadata?.psMakerVersion,
      schemaVersion: source.metadata?.schemaVersion,
      storyId: makeId(12),
      lastUpdated: now,
    },
    gameUI: demoGameUi(source.gameUI),
    storyName: name,
    storyDescription: "Zelda Maker Toolkit demo: field and dungeon with the built-in Tiles 'N Such assets.",
    exportConfig: { customIconEnabled: false },
    thumbnails: [],
    // The whole asset library of the source project, unchanged (ids stay the same).
    characters: structuredClone(source.characters ?? []),
    animationStrips: structuredClone(source.animationStrips ?? []),
    spritesheetAnimations: structuredClone(source.spritesheetAnimations ?? []),
    variables: [structuredClone(PROGRESS_VARIABLE)],
    videos: [],
    globalStoryEvents,
    ownedStoryEvents,
    maps: builtMaps,
    player: { ...structuredClone(source.player), startingMap: TITLE_MAP_ID },
    gameConfig: structuredClone(source.gameConfig),
    terrainTilesets: structuredClone(source.terrainTilesets ?? []),
    terrains: structuredClone(source.terrains ?? []),
    mapObjects: structuredClone(source.mapObjects ?? []),
    ...(source.audio ? { audio: structuredClone(source.audio) } : {}),
    images: [...structuredClone(source.images ?? []).filter((i) => !UI_IMAGES.some((u) => u.id === i.id)), ...structuredClone(UI_IMAGES)],
  };
  for (const k of Object.keys(story.metadata)) if (story.metadata[k] === undefined) delete story.metadata[k];
  return { story, warnings };
}

/**
 * The project's Game UI in the demo's pictures: a dialogue layout (also the toolkit's message box
 * and the default for PS Maker's Dialogue), a button style for the main menu, and the options,
 * load and choice menus on the same panel. The source's own styles stay in the lists. Every text
 * style uses the demo's font (DEMO_FONT).
 */
export function demoGameUi(source) {
  const g = structuredClone(source ?? {});
  g.fonts = [...(g.fonts ?? []).filter((f) => f.id !== DEMO_FONT.id), { ...DEMO_FONT }];
  const useFont = (v) => {
    if (!v || typeof v !== "object") return;
    if ("fontAssetId" in v) Object.assign(v, { fontAssetId: DEMO_FONT.id, fontFamily: DEMO_FONT.name });
    Object.values(v).forEach(useFont);
  };
  useFont(g);
  const base = g.dialogLayouts?.find((l) => l.id === g.defaultDialogLayoutId) ?? g.dialogLayouts?.[0];
  if (base) {
    const layout = structuredClone(base);
    Object.assign(layout, { id: DIALOG_LAYOUT_ID, key: "zelda_dialogue_layout", name: "Zelda dialogue" });
    layout.textBox.background = nineSlice("zelda-ui-panel", 7);
    layout.textBox.padding = { top: 40, right: 44, bottom: 40, left: 44 };
    layout.textBox.textStyles = { ...layout.textBox.textStyles, fontFamily: DEMO_FONT.name, fontAssetId: DEMO_FONT.id, color: CREAM, fontSize: 48 };
    if (layout.nameBox) layout.nameBox.background = nineSlice("zelda-ui-panel", 7);
    g.dialogLayouts = [...g.dialogLayouts.filter((l) => l.id !== DIALOG_LAYOUT_ID), layout];
    g.defaultDialogLayoutId = DIALOG_LAYOUT_ID;
  }
  const button = structuredClone(g.buttonStyles?.[0] ?? {});
  Object.assign(button, { id: BUTTON_STYLE_ID, name: "Zelda button", backgroundEnabled: true, background: nineSlice("zelda-ui-button", 6) });
  button.textStyles = { ...(button.textStyles ?? {}), fontFamily: DEMO_FONT.name, fontAssetId: DEMO_FONT.id, color: CREAM, fontSize: 48 };
  g.buttonStyles = [...(g.buttonStyles ?? []).filter((b) => b.id !== BUTTON_STYLE_ID), button];
  for (const menu of [g.optionsMenu, g.loadGameMenu]) if (menu) menu.background = nineSlice("zelda-ui-panel", 7);
  for (const c of g.choiceLayouts ?? []) c.background = nineSlice("zelda-ui-panel", 7);
  return g;
}

/**
 * The villager by the start, and what he says. PS Maker dialogue source: a blank line starts a new
 * page, and a line "Name: text" sets the speaker, so the text itself has no ": ".
 */
const VILLAGER = { x: 80, y: 118 };
const VILLAGER_TEXT = `@name "Villager"
It's dangerous out there. Slimes in the grass, and a knight by the gate.

Read the sign for the controls. The chests hold what you need.`;

/** File names the story refers to (asset keys are plain file names in <project>/assets). */
export function assetKeysOf(story) {
  const keys = new Set();
  const walk = (v) => {
    if (typeof v === "string") {
      if (v && v.length < 260 && !/[\\/:]/.test(v) && /^[\w.\-' ()]+$/.test(v)) keys.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(story);
  return [...keys];
}
