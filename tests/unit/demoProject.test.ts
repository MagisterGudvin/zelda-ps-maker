import { test } from "node:test";
import assert from "node:assert/strict";
import { assetKeysOf, buildDemoStory, DEMO_ASSETS, DEMO_FONT, sanitizeName } from "../../scripts/demo-project.mjs";
import { MAPS } from "../../examples/harness/demo-maps.js";

type Any = any;

/** A project that has the Tiles 'N Such entries the demo uses (names as in the pack). */
function sourceStory(): Any {
  const named = (names: Record<string, string>, extra: (id: string) => object = () => ({})) =>
    Object.values(names).map((name, i) => ({ id: `${name.replace(/\W/g, "")}${i}`, name, ...extra(`${i}`), metadata: { packName: "Tiles 'N Such Assets" } }));
  return {
    controls: { clickToMove: false, bindings: {}, custom: [] },
    metadata: { psMakerVersion: "1.2.1", schemaVersion: 32, storyId: "SOURCEID", lastUpdated: 1 },
    // As a new PS Maker 1.2.1 project saves it (shortened).
    gameUI: {
      fonts: [{ id: "font-pixel-operator", name: "PixelOperator", key: "PixelOperator.ttf" }],
      dialogLayouts: [{ id: "dialogue-layout-1", key: "dialogue_layout", name: "Dialogue layout", zIndex: 100, bottomGap: 14, textBox: { width: 896, height: 252, padding: { top: 27, right: 27, bottom: 27, left: 27 }, background: { type: "plain", backgroundOpacity: 100, backgroundColor: "#000000", borderColor: "#FFFFFF", borderWidth: 3, borderRadius: 18 }, textStyles: { fontFamily: "PixelOperator", fontAssetId: "font-pixel-operator", fontSize: 53, color: "#FFFFFF" } }, nameBox: { enabled: true, background: { type: "plain" } }, typingSpeed: 42 }],
      defaultDialogLayoutId: "dialogue-layout-1",
      choiceLayouts: [{ id: "choice-layout-1", name: "Choices layout", background: { type: "plain" } }],
      buttonStyles: [{ id: "button-style-1", name: "Button style", backgroundEnabled: true, background: { type: "plain" }, textStyles: { fontFamily: "PixelOperator", fontAssetId: "font-pixel-operator", fontSize: 59, color: "#FFFFFF" } }],
      optionsMenu: { id: "options-menu", name: "Options menu", background: { type: "plain" } },
      loadGameMenu: { id: "load-game-menu", name: "Load game menu", background: { type: "plain" } },
    },
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
  const spawn = field.setupActions.find((a: Any) => a.type === "spawnNPCAction" && a.instanceName === "Guard");
  const adopt = field.initialActions.find((a: Any) => a.actionName === "Zelda: Enemy From NPC");
  assert.equal(adopt.pluginParams.npc, spawn.inGameCharacterId);
  assert.deepEqual(spawn.position, { x: 120, y: 184 });
  assert.equal(story.player.startingMap, "zelda-demo-title", "the game starts on the main menu");
  assert.deepEqual(field.setupActions[0].position, MAPS.field.spawn);
  // Transfer: a touch trigger whose area is saved by its centre, running a Change map event.
  const trigger = field.initialActions.find((a: Any) => a.type === "addStoryEventAction" && a.triggerType === "touch");
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
  for (const f of ["PixelifySans.ttf", "animation-a-Sword_attack_full.png", "autotile-gen-0", "map-object-0.png"]) assert.ok(keys.includes(f), f);
  // The source is not changed.
  assert.deepEqual(source, sourceStory());
});

test("demo story: the main menu (PS Maker Add UI buttons) and the progress variable", async () => {
  const { story } = buildDemoStory({ source: sourceStory(), plugin: await plugin(), maps: MAPS, seed: 7 });
  const title = story.maps.find((m: Any) => m.id === story.player.startingMap);
  const field = story.maps[0];
  assert.deepEqual(title.setupActions.map((a: Any) => [a.type, a.mode ?? ""]), [["movePlayerAction", ""], ["setPlayerVisibilityAction", "hide"], ["togglePlayerMovementAction", "disable"]]);
  const menu = title.initialActions.find((a: Any) => a.type === "addUiComponentsAction");
  const buttons = menu.components.filter((c: Any) => c.type === "button");
  assert.deepEqual(buttons.map((b: Any) => b.label), ["New game", "Continue", "Settings", "Exit"]);
  // Each button runs a hidden event owned by it, as the editor saves "Add UI" button events.
  const run = (label: string) => {
    const b = buttons.find((x: Any) => x.label === label);
    const ev = story.ownedStoryEvents.find((e: Any) => e.id === b.storyEventId);
    assert.deepEqual(ev.owner, { type: "action", actionId: menu.id, actionType: "addUiComponentsAction", relation: "button-click", componentId: b.componentId });
    assert.equal(ev.hidden, true);
    return ev.actions.map((a: Any) => a.type);
  };
  assert.deepEqual(run("New game"), ["changeActiveMapAction"]);
  assert.deepEqual(run("Continue"), ["openLoadGameMenuAction"]);
  assert.deepEqual(run("Settings"), ["openOptionsMenuAction"]);
  assert.deepEqual(run("Exit"), ["exitGameAction"]);
  const newGame = story.ownedStoryEvents.find((e: Any) => e.id === buttons[0].storyEventId).actions[0];
  assert.deepEqual(newGame.destination, { mapId: field.id, position: MAPS.field.spawn });
  assert.ok(title.initialActions.every((a: Any) => !a.pluginName), "no Toolkit (and no HUD) on the menu");
  // Toolkit progress in PS Maker saves.
  assert.deepEqual(story.variables[0], { id: "zelda-progress", name: "Zelda progress", type: "string", defaultValue: "" });
  for (const m of story.maps.filter((x: Any) => x !== title)) assert.equal(m.initialActions.find((a: Any) => a.actionName === "Zelda: Start Toolkit").pluginParams.progressVariable, "zelda-progress");
});

test("demo story: own UI pictures in Images; dialogue layout, button style and menus on them; HUD and Message Style; a talking villager", async () => {
  const { story } = buildDemoStory({ source: sourceStory(), plugin: await plugin(), maps: MAPS, seed: 7 });
  const ids = new Set(story.images.map((i: Any) => i.id));
  for (const id of ["zelda-ui-panel", "zelda-ui-button", "zelda-ui-hud-bar", "zelda-ui-heart-full", "zelda-ui-digits"]) assert.ok(ids.has(id), id);
  assert.equal(story.images.find((i: Any) => i.id === "zelda-ui-panel").url, "zelda-ui-panel.png");
  const ui = story.gameUI;
  const layout = ui.dialogLayouts.find((l: Any) => l.id === ui.defaultDialogLayoutId);
  assert.equal(layout.id, "zelda-dialogue-layout");
  assert.deepEqual(layout.textBox.background, { type: "image", imageId: "zelda-ui-panel", backgroundOpacity: 100, scalingMode: "nine-slice", borderWidth: 28, slice: { top: 7, right: 7, bottom: 7, left: 7 }, repeat: "stretch" });
  assert.ok(ui.dialogLayouts.length >= 2, "the project's own layout stays");
  const title = story.maps.find((m: Any) => m.id === story.player.startingMap);
  const buttons = title.initialActions[0].components.filter((c: Any) => c.type === "button");
  const style = ui.buttonStyles.find((b: Any) => b.id === buttons[0].styleId);
  assert.equal(style.background.imageId, "zelda-ui-button");
  assert.equal(ui.optionsMenu.background.imageId, "zelda-ui-panel");
  assert.equal(ui.loadGameMenu.background.imageId, "zelda-ui-panel");
  for (const m of story.maps.filter((x: Any) => x !== title)) {
    const names = m.initialActions.map((a: Any) => a.actionName).filter(Boolean);
    assert.ok(names.indexOf("Zelda: HUD Style") > names.indexOf("Zelda: Start Toolkit"), `${m.name}: HUD Style after Start Toolkit`);
    const hud = m.initialActions.find((a: Any) => a.actionName === "Zelda: HUD Style").pluginParams;
    for (const k of ["heartFull", "rupees", "digits", "itemBox", "bar", "inventoryPanel", "inventoryCursor"]) assert.ok(ids.has(hud[k]), `${k} = ${hud[k]}`);
    assert.equal(m.initialActions.find((a: Any) => a.actionName === "Zelda: Message Style").pluginParams.layout, "zelda-dialogue-layout");
  }
  const field = story.maps[0];
  const villager = field.setupActions.find((a: Any) => a.instanceName === "Villager");
  const talk = field.initialActions.find((a: Any) => a.triggerType === "interact");
  assert.deepEqual(talk.staticArea, { x: villager.position.x, y: villager.position.y, width: 48, height: 48 }, "the trigger is around him (saved by its centre)");
  const ev = story.ownedStoryEvents.find((e: Any) => e.id === talk.storyEventId);
  assert.equal(ev.actions[0].type, "dialogueAction");
  assert.match(ev.actions[0].dialogueSource, /^@name "Villager"\n/);
  assert.ok(!/^[^@\n]*: /m.test(ev.actions[0].dialogueSource), "no text line reads as \"Name: text\"");
});

test("demo HUD: the toolkit draws all of it, like the map (scale 0), no Add UI HUD; one font with Cyrillic everywhere", async () => {
  const { story } = buildDemoStory({ source: sourceStory(), plugin: await plugin(), maps: MAPS, seed: 7 });
  for (const m of story.maps.filter((x: Any) => x.id !== story.player.startingMap)) {
    assert.ok(!m.initialActions.some((a: Any) => a.type === "addUiComponentsAction"), `${m.name}: no Add UI HUD`);
    assert.ok(!m.initialActions.some((a: Any) => a.actionName === "Zelda: HUD Variables"), `${m.name}: no HUD Variables`);
    const style = m.initialActions.find((a: Any) => a.actionName === "Zelda: HUD Style").pluginParams;
    assert.deepEqual(style.parts, ["hearts", "counters", "item", "magic"]);
    assert.equal(style.scale, 0);
    assert.equal(style.font, DEMO_FONT.id);
    assert.deepEqual(m.initialActions.find((a: Any) => a.actionName === "Zelda: Message Style").pluginParams.kinds, ["sign", "item"]);
  }
  assert.deepEqual(story.variables.map((v: Any) => v.id), ["zelda-progress"]);
  const ui = story.gameUI;
  assert.ok(ui.fonts.some((f: Any) => f.id === DEMO_FONT.id && f.key === "PixelifySans.ttf"));
  assert.ok(ui.fonts.some((f: Any) => f.id === "font-pixel-operator"), "the project's own font stays in the list");
  const styles: Any[] = [];
  const walk = (v: Any) => {
    if (!v || typeof v !== "object") return;
    if ("fontAssetId" in v) styles.push(v);
    Object.values(v).forEach(walk);
  };
  walk(ui);
  walk(story.maps.find((m: Any) => m.id === story.player.startingMap).initialActions);
  assert.ok(styles.length >= 6);
  for (const st of styles) assert.deepEqual([st.fontAssetId, st.fontFamily], [DEMO_FONT.id, "Pixelify Sans"]);
});

test("demo font: the TTF and its OFL license are in scripts/demo-assets", async () => {
  const { readFileSync } = await import("node:fs");
  const ttf = readFileSync(new URL("../../scripts/demo-assets/PixelifySans.ttf", import.meta.url));
  assert.equal(ttf.readUInt32BE(0), 0x00010000, "a TrueType font");
  assert.match(readFileSync(new URL("../../scripts/demo-assets/PixelifySans-OFL.txt", import.meta.url), "utf8"), /SIL Open Font License, Version 1\.1/);
});

test("demo UI pictures: valid PNGs of the drawn size", async () => {
  const { UI_ASSETS, pngOf } = await import("../../scripts/ui-assets.mjs");
  for (const a of UI_ASSETS) {
    const png = pngOf(a.grid);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], a.key);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [a.grid[0].length, a.grid.length], a.key);
  }
  assert.equal(UI_ASSETS.find((a: Any) => a.key === "zelda-ui-digits.png")!.grid[0].length, 50, "ten 5 px digits");
  assert.throws(() => pngOf(["kk", "k"]), /row 1/);
  assert.throws(() => pngOf(["kZ"]), /unknown colour "Z"/);
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
