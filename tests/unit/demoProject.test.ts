import { test } from "node:test";
import assert from "node:assert/strict";
import { assetKeysOf, buildDemoStory, DEMO_ASSETS, sanitizeName } from "../../scripts/demo-project.mjs";
import { MAPS } from "../../examples/harness/demo-maps.js";

type Any = any;

/** A project that has the Tiles 'N Such entries the demo uses (names as in the pack). */
function sourceStory(): Any {
  const named = (names: Record<string, string>, extra: (id: string) => object = () => ({})) =>
    Object.values(names).map((name, i) => ({ id: `${name.replace(/\W/g, "")}${i}`, name, ...extra(`${i}`), metadata: { packName: "Tiles 'N Such Assets" } }));
  return {
    controls: { clickToMove: false, bindings: {}, custom: [] },
    metadata: { psMakerVersion: "1.2.1", schemaVersion: 32, storyId: "SOURCEID", lastUpdated: 1 },
    gameUI: { fonts: [{ id: "font-pixel-operator", name: "PixelOperator", key: "PixelOperator.ttf" }] },
    storyName: "Source",
    characters: named(DEMO_ASSETS.characters),
    spritesheetAnimations: [
      { id: "S1", name: "Sword Attack", src: "animation-a-Sword_attack_full.png", ownerRef: { type: "player" }, animations: [{ id: "ATK0" }, { id: "ATK1" }] },
      { id: "S2", name: "Sword Hurt", src: "animation-b-Sword_Hurt_full.png", ownerRef: { type: "player" }, animations: [{ id: "HRT0" }] },
    ],
    terrains: named(DEMO_ASSETS.terrains, (i) => ({ terrainSrc: `autotile-${i}.png`, autoTilesetSrc: `autotile-gen-${i}` })),
    terrainTilesets: [],
    mapObjects: named(DEMO_ASSETS.objects, (i) => ({ src: `map-object-${i}.png`, type: "static" })),
    player: { animationSets: [], movementSpeed: 80 },
    gameConfig: { width: 1280, height: 720, zoom: 4 },
    maps: [{ id: "old-map", name: "Old" }],
    ownedStoryEvents: [{ id: "old-event" }],
  };
}

async function plugin(): Promise<Any> {
  return (await import("../../src/index.ts")).default;
}

test("demo story: plugin actions in the PS Maker format, with editor defaults", async () => {
  const p = await plugin();
  const { story } = buildDemoStory({ source: sourceStory(), plugin: p, maps: MAPS, seed: 7, now: 5 });
  assert.equal(sanitizeName("Zelda: Create Enemy"), "zelda-create-enemy");
  const field = story.maps.find((m: Any) => m.id === "zelda-demo-field");
  const start = field.initialActions[0];
  assert.equal(start.type, "plugin:zelda-maker-toolkit:zelda-start-toolkit");
  assert.equal(start.pluginName, "Zelda Maker Toolkit");
  assert.equal(start.actionName, "Zelda: Start Toolkit");
  assert.equal(start.pluginParams.hearts, 3);
  assert.equal(start.pluginParams.hud, true, "fields left untouched get their default, as the editor saves them");
  const enemy = field.initialActions.find((a: Any) => a.actionName === "Zelda: Create Enemy" && a.pluginParams.template === "slime");
  assert.equal(enemy.pluginParams.character, story.characters.find((c: Any) => c.name === "Slime").id, "slimes look like the pack's Slime");
  // Every action and parameter exists in the plugin.
  for (const m of story.maps)
    for (const a of m.initialActions.filter((x: Any) => x.pluginName)) {
      const def = p.actions.find((d: Any) => d.name === a.actionName);
      assert.ok(def, a.actionName);
      for (const k of Object.keys(a.pluginParams)) assert.ok(k in def.parameterDefs, `${a.actionName}.${k}`);
    }
});

test("demo story: NPC, triggers, collisions and terrain follow the PS Maker 1.2.1 format", async () => {
  const { story } = buildDemoStory({ source: sourceStory(), plugin: await plugin(), maps: MAPS, seed: 7 });
  const [field, dungeon] = story.maps;
  // The guard is spawned in "Map setup" and the same in-map id is picked in Enemy From NPC.
  const spawn = field.setupActions.find((a: Any) => a.type === "spawnNPCAction");
  const adopt = field.initialActions.find((a: Any) => a.actionName === "Zelda: Enemy From NPC");
  assert.equal(adopt.pluginParams.npc, spawn.inGameCharacterId);
  assert.deepEqual(spawn.position, { x: 120, y: 184 });
  assert.equal(story.player.startingMap, field.id);
  assert.deepEqual(field.setupActions[0].position, MAPS.field.spawn);
  // Transfer: a touch trigger whose area is saved by its centre, running a Change map event.
  const trigger = field.initialActions.find((a: Any) => a.type === "addStoryEventAction");
  const r = MAPS.field.triggers[0].rect;
  assert.deepEqual(trigger.staticArea, { x: r.x + r.w / 2, y: r.y + r.h / 2, width: r.w, height: r.h });
  assert.equal(trigger.triggerType, "touch");
  const ev = story.ownedStoryEvents.find((e: Any) => e.id === trigger.storyEventId);
  assert.equal(ev.owner.actionId, trigger.id);
  assert.deepEqual(ev.actions[0].destination, { mapId: dungeon.id, position: { x: 40, y: 200 } });
  // Collisions are the walls; wall terrain covers exactly the wall cells.
  assert.equal(field.mapCollisions.length, MAPS.field.walls.length);
  const details = field.terrainLayers.find((l: Any) => l.name === "Details layer").terrainGrid;
  const fence = story.terrains.find((t: Any) => t.name === "Fence").id;
  const stone = story.terrains.find((t: Any) => t.name === "Path").id;
  assert.equal(details[3][0], fence, "top edge: fence");
  assert.equal(details[0][3], stone, "side edge: stone (the fence has no vertical piece)");
  assert.equal(details[24][6], undefined, "the gate gap stays open");
  assert.equal(dungeon.terrainLayers[1].terrainGrid[5][5], story.terrains.find((t: Any) => t.name === "Patio Tiles").id);
  // Waves and the guardian use Define Enemy types with pack looks.
  const define = dungeon.initialActions.filter((a: Any) => a.actionName === "Zelda: Define Enemy");
  assert.equal(define.find((a: Any) => a.pluginParams.basedOn === "ogre").pluginParams.look, story.characters.find((c: Any) => c.name === "Bull").id);
  const room = dungeon.initialActions.find((a: Any) => a.actionName === "Zelda: Create Wave Room");
  assert.equal(room.pluginParams.spawnEnemy, define.find((a: Any) => a.pluginParams.basedOn === "ogre").pluginParams.slot);
});

test("demo story: a new project id, library kept, old maps and events dropped, unique ids", async () => {
  const source = sourceStory();
  const { story } = buildDemoStory({ source, plugin: await plugin(), maps: MAPS, seed: 3, name: "My Demo" });
  assert.notEqual(story.metadata.storyId, "SOURCEID");
  assert.equal(story.metadata.schemaVersion, 32);
  assert.equal(story.storyName, "My Demo");
  assert.deepEqual(story.terrains, source.terrains);
  assert.ok(!story.maps.some((m: Any) => m.id === "old-map"));
  assert.ok(!story.ownedStoryEvents.some((e: Any) => e.id === "old-event"));
  const ids: string[] = [];
  for (const m of story.maps) for (const list of [m.setupActions, m.initialActions, m.mapObjects, m.mapCollisions]) for (const a of list) ids.push(a.id ?? a.inGameId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(JSON.stringify(buildDemoStory({ source, plugin: await plugin(), maps: MAPS, seed: 3, name: "My Demo", now: 1 }).story.maps), JSON.stringify(buildDemoStory({ source, plugin: await plugin(), maps: MAPS, seed: 3, name: "My Demo", now: 2 }).story.maps), "same seed, same project");
  const keys = assetKeysOf(story);
  for (const f of ["PixelOperator.ttf", "animation-a-Sword_attack_full.png", "autotile-gen-0", "map-object-0.png"]) assert.ok(keys.includes(f), f);
  // The source is not changed.
  assert.deepEqual(source, sourceStory());
});

test("demo story: decoration keeps clear of doors, chests, puzzles, the start and NPCs", async () => {
  const { story } = buildDemoStory({ source: sourceStory(), plugin: await plugin(), maps: MAPS, seed: 7 });
  const interactive = new Set(["chest", "block", "pressure_plate", "button", "bombable_wall", "sign"]);
  for (const m of story.maps) {
    const spots: { what: string; x: number; y: number; clear: number }[] = [];
    for (const a of m.initialActions) {
      const p = a.pluginParams?.position;
      if (!p) continue;
      if (a.actionName === "Zelda: Create Door") spots.push({ what: "door", ...p, clear: 40 });
      else if (a.actionName === "Zelda: Create Chest") spots.push({ what: "chest", ...p, clear: 28 });
      else if (a.actionName === "Zelda: Create Object" && interactive.has(a.pluginParams.type)) spots.push({ what: a.pluginParams.type, ...p, clear: 28 });
    }
    for (const a of m.setupActions) if (a.position) spots.push({ what: a.type, ...a.position, clear: 28 });
    for (const o of m.mapObjects)
      for (const s of spots) assert.ok(Math.hypot(o.position.x - s.x, o.position.y - s.y) >= s.clear, `${m.name}: decoration at ${o.position.x},${o.position.y} blocks the ${s.what} at ${s.x},${s.y}`);
  }
});

test("demo story: a project without the pack gets a clear message", async () => {
  const source = sourceStory();
  source.terrains = source.terrains.filter((t: Any) => t.name !== "Fence");
  source.characters = [];
  assert.throws(() => buildDemoStory({ source, plugin: {} as Any, maps: MAPS }), /terrain "Fence".*character "Slime".*Tiles 'N Such Assets/s);
});
