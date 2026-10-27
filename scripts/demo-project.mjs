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

const TILE = 16;
const PACK = "Tiles 'N Such Assets";

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
  const mapIds = Object.fromEntries(Object.keys(maps).map((key) => [key, `zelda-demo-${key}`]));
  /** A "Player touch" event trigger on an area (top-left rect) that changes the map. */
  const transferTrigger = (rect, to) => {
    const actionId = makeId();
    const eventId = makeId();
    ownedStoryEvents.push({
      name: "Trigger event",
      id: eventId,
      actions: [
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
      ],
      hidden: true,
      owner: { type: "action", actionId, actionType: "addStoryEventAction", relation: "local-trigger" },
    });
    return {
      id: actionId,
      type: "addStoryEventAction",
      name: "Add event trigger",
      triggerType: "touch",
      positionType: "static",
      // PS Maker areas are saved by their centre (AreaEditor/areaGeometry.ts).
      staticArea: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, width: rect.w, height: rect.h },
      removeConditionType: "none",
      removeConditionCount: 1,
      triggerLabelUi: "default",
      overrideTriggerLabel: false,
      triggerLabelText: "",
      waitForCompletion: true,
      instanceName: `To ${to.map}`,
      instanceId: makeId(),
      localStoryEventId: eventId,
      storyEventId: eventId,
    };
  };

  // Player attack/hurt sheets, if the project's player has the Tiles 'N Such sword sheets.
  const playerSheet = (sheetName) =>
    (source.spritesheetAnimations ?? []).find((s) => s.ownerRef?.type === "player" && s.name === sheetName)?.animations?.[0]?.id;
  const sprites = { attack: playerSheet("Sword Attack"), hurt: playerSheet("Sword Hurt") };

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
      place(object.bush, 24, 24);
      place(object.mushroom, 176, 214);
      place(object.rock, 370, 214);
    } else {
      place(object.barrel, 176, 30);
      place(object.crates, 172, 150);
      place(object.crate, 24, 136);
    }

    // Map setup: player start and the NPCs placed in the editor.
    const npcIds = {};
    const setupActions = [];
    if (key === Object.keys(maps)[0])
      setupActions.push({ id: makeId(), name: "Move player", type: "movePlayerAction", moveType: "absolute-position", position: { ...m.spawn }, instant: true, waitForCompletion: true, speedMultiplier: 1, faceDirection: "down" });
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
      if (actionName === "Zelda: Create Wave Room" && slotOf[p.spawnEnemy]) p.spawnEnemy = slotOf[p.spawnEnemy];
      zelda.push(pluginAction(actionName, p));
      if (actionName === "Zelda: Start Toolkit") {
        if (sprites.attack) zelda.push(pluginAction("Zelda: Set Player Sprites", { attack: sprites.attack, ...(sprites.hurt ? { hurt: sprites.hurt } : {}) }));
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
      initialActions: [...zelda, ...(m.triggers ?? []).map((t) => transferTrigger(t.rect, t.transfer))],
      enterActions: [],
      leaveActions: [],
      storyEvents: [],
      tileSize: TILE,
    };
  });

  const story = {
    controls: structuredClone(source.controls),
    metadata: {
      psMakerVersion: source.metadata?.psMakerVersion,
      schemaVersion: source.metadata?.schemaVersion,
      storyId: makeId(12),
      lastUpdated: now,
    },
    gameUI: structuredClone(source.gameUI),
    storyName: name,
    storyDescription: "Zelda Maker Toolkit demo: field and dungeon with the built-in Tiles 'N Such assets.",
    exportConfig: { customIconEnabled: false },
    thumbnails: [],
    // The whole asset library of the source project, unchanged (ids stay the same).
    characters: structuredClone(source.characters ?? []),
    animationStrips: structuredClone(source.animationStrips ?? []),
    spritesheetAnimations: structuredClone(source.spritesheetAnimations ?? []),
    variables: [],
    videos: [],
    globalStoryEvents: [],
    ownedStoryEvents,
    maps: builtMaps,
    player: { ...structuredClone(source.player), startingMap: mapIds[Object.keys(maps)[0]] },
    gameConfig: structuredClone(source.gameConfig),
    terrainTilesets: structuredClone(source.terrainTilesets ?? []),
    terrains: structuredClone(source.terrains ?? []),
    mapObjects: structuredClone(source.mapObjects ?? []),
    ...(source.audio ? { audio: structuredClone(source.audio) } : {}),
    ...(source.images ? { images: structuredClone(source.images) } : {}),
  };
  for (const k of Object.keys(story.metadata)) if (story.metadata[k] === undefined) delete story.metadata[k];
  return { story, warnings };
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
