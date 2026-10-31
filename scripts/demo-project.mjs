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
      // The second item button (B), under the panel.
      { id: "item2", type: "item", x: 18, y: 36, w: 22, h: 22, anchor: "tl", show: always, frame: "zelda-ui-item-box", slot: 2 },
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
  // Screens made in the UI Designer on the same pictures (Zelda: UI Layout with a screen name and
  // a role). The pause menu (Escape): its buttons close it or run project events (PS Maker's
  // options menu with saving, the main menu).
  const globalStoryEvents = [
    { name: "Pause: settings", id: "zelda-pause-settings", actions: [{ id: makeId(), name: "Open game options menu", type: "openOptionsMenuAction", showExitGameButton: false, showSaveGameButton: true }], hidden: false },
    {
      name: "Pause: main menu",
      id: "zelda-pause-title",
      actions: [{ id: makeId(), name: "Change map", type: "changeActiveMapAction", destination: { mapId: TITLE_MAP_ID, position: { x: 160, y: 96 } }, faceDirection: "down", fadeOutDuration: 500, fadeInDuration: 500, fadeInTiming: "beforeMapStart", skipFadeIn: false }],
      hidden: false,
    },
  ];
  const screen = (role, more = {}) => ({ role, input: true, pause: true, dim: "#1f1a24a0", kinds: ["sign", "item"], typing: 40, soundMove: "", soundPress: "", soundOpen: "", soundClose: "", ...more });
  const button = (id, text, y, action) => ({ id, type: "button", x: -48, y, w: 96, h: 18, anchor: "c", show: always, image: "zelda-ui-button", hover: "", slice: 6, color: "", hoverColor: "", text, font: "", size: 8, textColor: "", action: { value: "", ...action } });
  const pauseLayout = {
    v: 1,
    scale: 0,
    theme: hudLayout.theme,
    screen: screen("menu"),
    elements: [
      { id: "panel", type: "image", x: -60, y: -72, w: 120, h: 144, anchor: "c", show: always, image: "zelda-ui-panel", mode: "nine", slice: 7, color: "" },
      { id: "title", type: "text", x: -60, y: -65, w: 120, h: 10, anchor: "c", show: always, text: "Paused", font: "", size: 10, color: "", align: "center" },
      button("continue", "Continue", -48, { kind: "close", id: "" }),
      // Saving and loading are PS Maker's own (its Save game action, its load menu).
      button("save", "Save game", -26, { kind: "save", id: "" }),
      button("load", "Load game", -4, { kind: "load", id: "" }),
      // PS Maker's "Open game options menu" in an event: the toolkit opens the settings screen instead.
      button("settings", "Settings", 18, { kind: "event", id: "zelda-pause-settings" }),
      button("mainMenu", "Main menu", 40, { kind: "event", id: "zelda-pause-title" }),
    ],
  };
  // The settings (role Settings), in place of PS Maker's options menu: volumes (left and right change
  // them), fullscreen, the language of the translation sheet, the controls (saving is in the pause menu).
  const row = (id, text, y, action) => ({ ...button(id, text, y, action), x: -70, w: 140 });
  const volumeBar = (id, value, y) => ({ id, type: "bar", x: 20, y, w: 50, h: 6, anchor: "c", show: always, value, max: "100", dir: "right", fillColor: "#ffd23a", backColor: "#1f1a24", shape: "rect", border: "#f2e4bb", borderWidth: 1, text: "" });
  const settingsLayout = {
    v: 1,
    scale: 0,
    theme: hudLayout.theme,
    screen: screen("settings"),
    elements: [
      { id: "panel", type: "image", x: -80, y: -74, w: 160, h: 148, anchor: "c", show: always, image: "zelda-ui-panel", mode: "nine", slice: 7, color: "" },
      { id: "title", type: "text", x: -80, y: -67, w: 160, h: 10, anchor: "c", show: always, text: "Settings", font: "", size: 10, color: "", align: "center" },
      { ...row("music", "Music", -52, { kind: "music", id: "", value: "10" }), w: 84 },
      volumeBar("musicBar", "musicVolume", -46),
      { ...row("sound", "Sounds", -32, { kind: "sound", id: "", value: "10" }), w: 84 },
      volumeBar("soundBar", "soundVolume", -26),
      row("fullscreen", "Fullscreen: {fullscreen.text}", -12, { kind: "fullscreen", id: "" }),
      row("language", "Language: {language}", 8, { kind: "language", id: "" }),
      row("controls", "Controls", 28, { kind: "open", id: "controls" }),
      row("back", "Back", 48, { kind: "close", id: "" }),
    ],
  };
  // The player's own keys and gamepad buttons (opened from the pause menu).
  const controlsLayout = {
    v: 1,
    scale: 0,
    theme: hudLayout.theme,
    screen: screen("none"),
    elements: [
      { id: "panel", type: "image", x: -95, y: -80, w: 190, h: 160, anchor: "c", show: always, image: "zelda-ui-panel", mode: "nine", slice: 7, color: "" },
      { id: "title", type: "text", x: -95, y: -73, w: 190, h: 10, anchor: "c", show: always, text: "{t:controls.title}", font: "", size: 9, color: "", align: "center" },
      { id: "keyboard", type: "text", x: -2, y: -60, w: 40, h: 8, anchor: "c", show: always, text: "{t:controls.keyboard}", font: "", size: 6, color: "#c8b88a", align: "left" },
      { id: "gamepad", type: "text", x: 45, y: -60, w: 40, h: 8, anchor: "c", show: always, text: "{t:controls.gamepad}", font: "", size: 6, color: "#c8b88a", align: "left" },
      { id: "keys", type: "keybinds", x: -85, y: -51, w: 170, h: 99, anchor: "c", show: always, font: "", size: 7, color: "", selectedColor: "", rowHeight: 11, keyColumn: 49, padColumn: 77 },
      { ...button("reset", "Reset", 54, { kind: "resetControls", id: "" }), x: -88, w: 84 },
      { ...button("back", "Back", 54, { kind: "close", id: "" }), x: 4, w: 84 },
    ],
  };
  // The message box: signs and items received, typed out on the panel at the bottom; a blinking
  // "Z" while the page waits for the key.
  const messageLayout = {
    v: 1,
    scale: 0,
    theme: hudLayout.theme,
    screen: screen("message", { dim: "" }),
    elements: [
      { id: "panel", type: "image", x: -140, y: -58, w: 280, h: 52, anchor: "b", show: always, image: "zelda-ui-panel", mode: "nine", slice: 7, color: "" },
      { id: "text", type: "text", x: -128, y: -50, w: 256, h: 36, anchor: "b", show: always, text: "{message}", font: "", size: 8, color: "", align: "left", wrap: true },
      { id: "next", type: "text", x: 120, y: -18, w: 8, h: 8, anchor: "b", show: { when: "compare", id: "message.ready", op: "==", value: 1 }, effect: "blink", text: "Z", font: "", size: 7, color: "#ffd23a", align: "center" },
    ],
  };
  // The dialogue box (Zelda: Dialogue): a name plate over the panel at the bottom.
  const dialogueLayout = {
    v: 1,
    scale: 0,
    theme: hudLayout.theme,
    screen: screen("dialogue", { dim: "" }),
    elements: [
      { id: "panel", type: "image", x: -140, y: -58, w: 280, h: 52, anchor: "b", show: always, image: "zelda-ui-panel", mode: "nine", slice: 7, color: "" },
      { id: "plate", type: "image", x: -136, y: -72, w: 76, h: 18, anchor: "b", show: always, image: "zelda-ui-button", mode: "nine", slice: 6, color: "" },
      { id: "speaker", type: "text", x: -136, y: -67, w: 76, h: 10, anchor: "b", show: always, text: "{speaker}", font: "", size: 8, color: "#ffd23a", align: "center" },
      { id: "text", type: "text", x: -128, y: -48, w: 256, h: 34, anchor: "b", show: always, text: "{message}", font: "", size: 8, color: "", align: "left", wrap: true },
      { id: "next", type: "text", x: 120, y: -18, w: 8, h: 8, anchor: "b", show: { when: "compare", id: "message.ready", op: "==", value: 1 }, effect: "blink", text: "Z", font: "", size: 7, color: "#ffd23a", align: "center" },
      // The answers, on button plates over the right end of the panel.
      { id: "answers", type: "choices", x: 52, y: -106, w: 88, h: 46, anchor: "b", show: always, font: "", size: 8, color: "", selectedColor: "", rowHeight: 14, gap: 2, image: "zelda-ui-button", selected: "", slice: 6, marker: "" },
    ],
  };
  // The villager's advice: a project event run by his answer "Any advice?".
  // ... and he gives his shovel: the Magic Powder is buried below the start (Create Chest: Buried on the field).
  globalStoryEvents.push({
    name: "Villager: advice",
    id: VILLAGER_HINT_EVENT,
    actions: [pluginAction("Zelda: Dialogue", { name: "Villager", text: VILLAGER_HINT }), pluginAction("Zelda: Give Item", { item: "shovel", count: 1 }), pluginAction("Zelda: Dialogue", { name: "Villager", text: VILLAGER_DIG })],
    hidden: false,
  });
  // ... and says goodbye in PS Maker's own dialogue box (translated by the sheet as it runs).
  globalStoryEvents.push({
    name: "Villager: bye",
    id: VILLAGER_BYE_EVENT,
    actions: [{ id: makeId(), name: "Dialogue", type: "dialogueAction", dialogueSource: VILLAGER_BYE }],
    hidden: false,
  });
  // Short notes ("You got 5 bombs!", "Saved"): a small plate under the HUD, one per note.
  const notificationLayout = {
    v: 1,
    scale: 0,
    theme: hudLayout.theme,
    screen: screen("notification", { dim: "", pause: false, input: false }),
    elements: [
      { id: "plate", type: "image", x: -70, y: 40, w: 140, h: 16, anchor: "t", show: always, image: "zelda-ui-hud-bar", mode: "nine", slice: 4, color: "" },
      { id: "note", type: "text", x: -66, y: 44, w: 132, h: 8, anchor: "t", show: always, text: "{note}", font: "", size: 7, color: "", align: "center" },
    ],
  };
  // The inventory (I): the items in a grid, the name and description of the one under the cursor.
  const inventoryLayout = {
    v: 1,
    scale: 0,
    theme: hudLayout.theme,
    screen: screen("inventory"),
    elements: [
      { id: "panel", type: "image", x: -84, y: -60, w: 168, h: 120, anchor: "c", show: always, image: "zelda-ui-panel", mode: "nine", slice: 7, color: "" },
      { id: "title", type: "text", x: -84, y: -53, w: 168, h: 10, anchor: "c", show: always, text: "{t:hud.inventory}", font: "", size: 9, color: "", align: "center" },
      { id: "items", type: "inventory", x: -71, y: -38, w: 142, h: 46, anchor: "c", show: always, cols: 6, cell: 22, gap: 2, frame: "zelda-ui-item-box", cursor: "zelda-ui-cursor", counts: true },
      { id: "name", type: "text", x: -72, y: 14, w: 144, h: 10, anchor: "c", show: always, text: "{inv.name}", font: "", size: 8, color: "#ffd23a", align: "left" },
      { id: "description", type: "text", x: -72, y: 26, w: 144, h: 26, anchor: "c", show: always, text: "{inv.description}", font: "", size: 7, color: "", align: "left", wrap: true },
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
      // A villager who talks in the toolkit's dialogue box (an "interact" trigger around him runs Zelda: Dialogue).
      setupActions.push({ id: makeId(), name: "Spawn NPC", type: "spawnNPCAction", characterId: character.guard, inGameCharacterId: `in-game-character-${makeId()}`, position: { ...VILLAGER }, faceDirection: "down", fadeInEnabled: false, fadeInDurationMs: 750, waitForCompletion: true, instanceName: "Villager" });
      extra.push(eventTrigger({ x: VILLAGER.x - 24, y: VILLAGER.y - 24, w: 48, h: 48 }, "interact", "Talk to the villager", [pluginAction("Zelda: Dialogue", { name: "Villager", text: VILLAGER_TEXT, choice1: "Any advice?", event1: VILLAGER_HINT_EVENT, choice2: "Bye!", event2: VILLAGER_BYE_EVENT })]));
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
        // Once for the project, like Start Toolkit itself.
        if (sprites.attack) zelda.push(pluginAction("Zelda: Set Player Sprites", Object.fromEntries(Object.entries(sprites).filter(([, id]) => id))));
        // The HUD and the screens are made once, on the first map: the other maps use them from the project.
        if (key === Object.keys(maps)[0]) {
          zelda.push(pluginAction("Zelda: UI Layout", { layout: JSON.stringify(hudLayout) }));
          zelda.push(pluginAction("Zelda: UI Layout", { name: "pause", layout: JSON.stringify(pauseLayout) }));
          zelda.push(pluginAction("Zelda: UI Layout", { name: "controls", layout: JSON.stringify(controlsLayout) }));
          zelda.push(pluginAction("Zelda: UI Layout", { name: "settings", layout: JSON.stringify(settingsLayout) }));
          zelda.push(pluginAction("Zelda: UI Layout", { name: "message", layout: JSON.stringify(messageLayout) }));
          zelda.push(pluginAction("Zelda: UI Layout", { name: "inventory", layout: JSON.stringify(inventoryLayout) }));
          zelda.push(pluginAction("Zelda: UI Layout", { name: "dialogue", layout: JSON.stringify(dialogueLayout) }));
          zelda.push(pluginAction("Zelda: UI Layout", { name: "notification", layout: JSON.stringify(notificationLayout) }));
          zelda.push(pluginAction("Zelda: Translations", { data: JSON.stringify(demoTranslations()) }));
        }
      }
    }
    // The wave enemies' looks (Define Enemy), first on the map that has waves.
    if (needsSlots) zelda.unshift(...WAVE_LOOKS.map(([template, slot, look]) => pluginAction("Zelda: Define Enemy", { slot, basedOn: template, look: character[look] })));
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

  // ---- title map: the title screen, made in the UI Designer ----------------------------------
  // PS Maker has no title screen: the starting map is one. The toolkit starts on it and opens the
  // "title" screen (role Title: the HUD hidden, no key closes it); its buttons run project events.
  const first = Object.keys(maps)[0];
  const titleEvent = (id, name, actions) => (globalStoryEvents.push({ name, id, actions, hidden: false }), id);
  const titleLayout = {
    v: 1,
    scale: 0,
    theme: hudLayout.theme,
    screen: screen("title", { dim: "" }),
    elements: [
      { id: "name", type: "text", x: -150, y: -70, w: 300, h: 24, anchor: "c", show: always, text: name, font: "", size: 20, color: "#f8e0a0", align: "center", stroke: "#1f1a24", strokeWidth: 2 },
      { id: "subtitle", type: "text", x: -150, y: -46, w: 300, h: 10, anchor: "c", show: always, text: "Zelda Maker Toolkit · PS Maker", font: "", size: 8, color: "#f2e4bb", align: "center", stroke: "#1f1a24", strokeWidth: 1 },
      button("newGame", "New game", -20, { kind: "event", id: titleEvent("zelda-title-new", "Title: new game", [{ id: makeId(), name: "Change map", type: "changeActiveMapAction", destination: { mapId: mapIds[first], position: { ...maps[first].spawn } }, faceDirection: "down", fadeOutDuration: 500, fadeInDuration: 500, fadeInTiming: "beforeMapStart", skipFadeIn: false }]) }),
      button("continue", "Continue", 2, { kind: "event", id: titleEvent("zelda-title-continue", "Title: continue", [{ id: makeId(), name: "Open load game menu", type: "openLoadGameMenuAction" }]) }),
      button("settings", "Settings", 24, { kind: "event", id: titleEvent("zelda-title-settings", "Title: settings", [{ id: makeId(), name: "Open game options menu", type: "openOptionsMenuAction", showExitGameButton: false, showSaveGameButton: false }]) }),
      button("exit", "Exit", 46, { kind: "event", id: titleEvent("zelda-title-exit", "Title: exit", [{ id: makeId(), name: "Exit game", type: "exitGameAction" }]) }),
    ],
  };
  // No Start Toolkit on the title map either: the field's counts for the whole project.
  const titleActions = [
    pluginAction("Zelda: UI Layout", { name: "title", layout: JSON.stringify(titleLayout) }),
    pluginAction("Zelda: Open UI Screen", { name: "title" }),
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
    initialActions: titleActions,
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
  // No PS Maker gear over the game: the settings screen made in the UI Designer replaces its menu
  // (Game UI → Options menu → "Options button in game" unticked).
  if (g.optionsMenu) g.optionsMenu.showOpenOptionsButton = false;
  return g;
}

/**
 * The villager by the start, and what he says. PS Maker dialogue source: a blank line starts a new
 * page, and a line "Name: text" sets the speaker, so the text itself has no ": ".
 */
const VILLAGER = { x: 80, y: 118 };
/** The villager's answer "Any advice?" runs this project event. */
const VILLAGER_HINT_EVENT = "zelda-villager-advice";
const VILLAGER_HINT = "Hold V to raise the shield: it stops the shots of the fiery slime in the lower right. The shield is in the chest under the sign.";
const VILLAGER_DIG = "Take my old shovel. I buried a bag of Magic Powder two steps below where you started. Dig there!\\n\\nShoot an arrow with a bomb: put the bow and the bombs on C and B and press both.";

/** What the villager says (Zelda: Dialogue: "\\n" typed in the field is a new line, two of them a new page). */
const VILLAGER_TEXT = "It's dangerous out there. Slimes in the grass, and a knight by the gate.\\n\\nRead the sign for the controls. The chests hold what you need.";
const VILLAGER_BYE_EVENT = "zelda-villager-bye";
/** PS Maker's Dialogue: "Name: text", one newline a new line. */
export const VILLAGER_BYE = "Villager: Take care out there!\nCome back if you need advice.";
export const SIGN_TEXT = "Arrows: move. X: sword, hold it to spin. Z: open, lift, talk.\n\nC and B: the two item buttons. Q/E: switch the C item. I: all items (C or B puts one on that button). V: hold up the shield (in the chest below). Esc: pause.";

/** The demo in Russian (Zelda: Translations): what each text of the demo reads in it. */
const DEMO_RU = [
  ["text", "LOW HEALTH", "МАЛО ЗДОРОВЬЯ"],
  ["text", "Paused", "Пауза"],
  ["text", "Continue", "Продолжить"],
  ["text", "Settings", "Настройки"],
  ["text", "Main menu", "Главное меню"],
  ["text", "Controls", "Управление"],
  ["text", "Language: {language}", "Язык: {language}"],
  ["text", "Music", "Музыка"],
  ["text", "Sounds", "Звуки"],
  ["text", "Fullscreen: {fullscreen.text}", "Полный экран: {fullscreen.text}"],
  ["text", "Save game", "Сохранить игру"],
  ["text", "Load game", "Загрузить игру"],
  ["text", "Reset", "Сбросить"],
  ["text", "Back", "Назад"],
  ["text", SIGN_TEXT, "Стрелки: ходьба. X: меч, удерживайте для кругового удара. Z: открыть, поднять, говорить.\n\nC и B: две кнопки предметов. Q/E: сменить предмет на C. I: все предметы (C или B ставит предмет на эту кнопку). V: поднять щит (он в сундуке ниже). Esc: пауза."],
  ["text", "The gate opened!", "Ворота открылись!"],
  ["text", "Field cleared!", "Поле зачищено!"],
  ["text", "Zelda Toolkit Demo", "Демо Zelda Toolkit"],
  ["text", "New game", "Новая игра"],
  ["text", "Exit", "Выход"],
  ["name", "Villager", "Житель"],
  ["text", VILLAGER_TEXT, "Снаружи опасно. В траве слаймы, а у ворот рыцарь.\\n\\nПрочитай табличку про управление. В сундуках есть всё, что нужно."],
  ["text", "Any advice?", "Есть совет?"],
  ["text", "Bye!", "Пока!"],
  ["text", VILLAGER_HINT, "Держи V, чтобы поднять щит: он остановит выстрелы огненного слайма справа внизу. Щит — в сундуке под табличкой."],
  ["text", VILLAGER_DIG, "Возьми мою старую лопату. Я закопал мешочек волшебного порошка в двух шагах ниже места, откуда ты пришёл. Копай там!\\n\\nВыстрели стрелой с бомбой: поставь лук и бомбы на C и B и нажми обе."],
  ["text", "Take care out there!\nCome back if you need advice.", "Береги себя!\nВозвращайся, если нужен совет."],
];

/** The translation sheet of the demo: English as written, Russian. */
export function demoTranslations() {
  const lang = (code, name) => ({ code, name, dialogueLayout: "", choiceLayout: "", font: "" });
  return { v: 1, languages: [lang("en", "English"), lang("ru", "Русский")], rows: DEMO_RU.map(([type, source, ru]) => ({ type, source, where: "demo", tr: { ru } })) };
}

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
