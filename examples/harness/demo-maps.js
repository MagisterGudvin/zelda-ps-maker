/**
 * Demo project for Zelda Maker Toolkit.
 *
 * Each map lists exactly what an author enters in PS Maker:
 *  - `walls`: map collision rectangles (drawn with the PS Maker collision tool),
 *  - `npcs`: NPCs placed in the editor,
 *  - `onLoad`: the map's On-load events (plugin actions + their parameters),
 *  - `triggers`: event-group trigger areas with the events they run on touch.
 * The harness (host-emulator.js) replays them through the real plugin bundle.
 * All coordinates are pixels; tiles are 16x16 and walls, doors and triggers sit on the tile grid.
 */

const RIGHT_GATE = { x: 384, y: 96, w: 16, h: 32 };

export const MAPS = {
  field: {
    title: "Field / Поле",
    size: { w: 400, h: 240 },
    floor: "#5d9e4a",
    spawn: { x: 48, y: 140 },
    walls: [
      { x: 0, y: 0, w: 400, h: 16 },
      { x: 0, y: 224, w: 400, h: 16 },
      { x: 0, y: 0, w: 16, h: 240 },
      { x: 384, y: 0, w: 16, h: 96 },
      { x: 384, y: 128, w: 16, h: 112 },
      // Secret room (top-left), entered through a bombable wall.
      { x: 16, y: 80, w: 32, h: 16 },
      { x: 64, y: 80, w: 32, h: 16 },
      { x: 96, y: 16, w: 16, h: 80 },
      // Switch ledge (top-right), reachable only by boomerang.
      { x: 288, y: 16, w: 16, h: 64 },
    ],
    npcs: [{ name: "npc_guard", x: 120, y: 184, color: "#d9822b" }],
    onLoad: [
      ["Zelda: Start Toolkit", { difficulty: "alttp", hearts: 3, swordDamage: 2, magicBar: true, shieldButton: false, hudBottom: false, language: "auto", debugHitboxes: false, diagnostics: false }],
      ["Zelda: Enter Dungeon", { dungeonId: "", completeOnBoss: true }],
      ["Zelda: Set Respawn Point", { position: { x: 48, y: 140 } }],
      ["Zelda: Create Object", { type: "sign", position: { x: 32, y: 120 }, text: "Arrows: move. X: sword, hold it to spin. Z: open, lift, talk.\n\nC: use the item. Q/E: switch items. I: all items. Esc: menu and save." }],
      // 3. Sword targets and enemies (several types); group 1 = the field.
      ["Zelda: Create Enemy", { template: "slime", position: { x: 230, y: 120 }, group: "1" }],
      ["Zelda: Create Enemy", { template: "slime", position: { x: 260, y: 160 }, group: "1" }],
      ["Zelda: Create Enemy", { template: "soldier", position: { x: 300, y: 205 }, group: "1" }],
      // Patrol route clicked on the map.
      ["Zelda: Create Enemy", { template: "sentry", position: { x: 200, y: 84 }, patrol: [{ x: 150, y: 84 }, { x: 250, y: 84 }] }],
      // 6. Ranged enemy to test the shield.
      ["Zelda: Create Enemy", { template: "spitter", position: { x: 350, y: 180 }, group: "1" }],
      // NPC placed in the editor turned into a shielded knight.
      ["Zelda: Enemy From NPC", { npc: "npc_guard", template: "knight", group: "1", hp: 4 }],
      // World objects.
      ["Zelda: Create Object", { type: "bush", position: { x: 152, y: 128 } }],
      ["Zelda: Create Object", { type: "bush", position: { x: 168, y: 128 } }],
      ["Zelda: Create Object", { type: "bush", position: { x: 152, y: 144 } }],
      ["Zelda: Create Object", { type: "grass", position: { x: 232, y: 200 } }],
      ["Zelda: Create Object", { type: "grass", position: { x: 248, y: 200 } }],
      ["Zelda: Create Object", { type: "pot", position: { x: 56, y: 200 } }],
      ["Zelda: Create Object", { type: "pot", position: { x: 72, y: 200 } }],
      ["Zelda: Create Object", { type: "rock", position: { x: 120, y: 128 } }],
      // 9. Items in chests.
      ["Zelda: Create Chest", { position: { x: 200, y: 40 }, item: "boomerang", count: 1, requiresBigKey: false, hidden: false }],
      ["Zelda: Create Chest", { position: { x: 140, y: 200 }, item: "bombs", count: 5, requiresBigKey: false, hidden: false }],
      ["Zelda: Create Chest", { position: { x: 248, y: 40 }, item: "bow", count: 1, requiresBigKey: false, hidden: false }],
      ["Zelda: Give Item", { item: "arrows", count: 10, silent: true }],
      // 4. Bomb + destructible wall + passage to a secret room.
      ["Zelda: Create Object", { type: "bombable_wall", position: { x: 56, y: 88 } }],
      ["Zelda: Create Chest", { position: { x: 40, y: 40 }, item: "heart_container", count: 1, requiresBigKey: false, hidden: false }],
      ["Zelda: Create Object", { type: "pot", position: { x: 72, y: 40 } }],
      // 5. Boomerang + switch behind pits; the switch opens the gate (picked on the map).
      ["Zelda: Create Object", { type: "button", position: { x: 340, y: 40 }, staysOn: true }],
      ["Zelda: Create Object", { type: "pit", position: { x: 308, y: 80 } }],
      ["Zelda: Create Object", { type: "pit", position: { x: 324, y: 80 } }],
      ["Zelda: Create Object", { type: "pit", position: { x: 340, y: 80 } }],
      ["Zelda: Create Object", { type: "pit", position: { x: 356, y: 80 } }],
      ["Zelda: Create Object", { type: "pit", position: { x: 372, y: 80 } }],
      ["Zelda: Create Door", { position: { x: 392, y: 112 }, lock: "switch", startOpen: false, height: 32 }],
      ["Zelda: Add Rule", { whenObjectAt: { x: 340, y: 40 }, openDoorAt: { x: 392, y: 112 }, message: "The gate opened!", once: true }],
      ["Zelda: Add Rule", { whenGroup: "1", giveItem: "rupees", giveCount: 20, message: "Field cleared!", once: true }],
    ],
    triggers: [{ rect: { x: 396, y: RIGHT_GATE.y, w: 8, h: RIGHT_GATE.h }, transfer: { map: "dungeon", x: 40, y: 200 } }],
  },

  dungeon: {
    title: "Dungeon / Подземелье",
    size: { w: 400, h: 240 },
    floor: "#4a4560",
    spawn: { x: 40, y: 200 },
    walls: [
      { x: 0, y: 0, w: 400, h: 16 },
      { x: 0, y: 224, w: 400, h: 16 },
      { x: 0, y: 0, w: 16, h: 176 },
      { x: 384, y: 0, w: 16, h: 240 },
      // Left half split horizontally with a shutter in the middle (puzzle door). Doorways are two
      // tiles wide: PS Maker slides the player around a corner only when slightly off-centre.
      { x: 16, y: 104, w: 64, h: 16 },
      { x: 112, y: 104, w: 80, h: 16 },
      // Vertical wall between the left half and the arena with a locked door.
      { x: 192, y: 16, w: 16, h: 120 },
      { x: 192, y: 168, w: 16, h: 56 },
    ],
    npcs: [],
    onLoad: [
      ["Zelda: Start Toolkit", { difficulty: "alttp", hearts: 3, swordDamage: 2, magicBar: true, shieldButton: false, hudBottom: false, language: "auto", debugHitboxes: false, diagnostics: false }],
      ["Zelda: Enter Dungeon", { dungeonId: "dungeon_1", completeOnBoss: true }],
      ["Zelda: Set Respawn Point", { position: { x: 40, y: 200 } }],
      // 8. Block + pressure plate opens the puzzle shutter.
      ["Zelda: Create Object", { type: "block", position: { x: 88, y: 168 } }],
      ["Zelda: Create Object", { type: "pressure_plate", position: { x: 104, y: 168 }, staysOn: true }],
      ["Zelda: Create Door", { position: { x: 96, y: 112 }, lock: "switch", startOpen: false, width: 32 }],
      ["Zelda: Add Rule", { whenObjectAt: { x: 104, y: 168 }, openDoorAt: { x: 96, y: 112 }, once: true }],
      // 7. Chest with a small key + locked door.
      ["Zelda: Create Chest", { position: { x: 60, y: 48 }, item: "key", count: 1, requiresBigKey: false, hidden: false }],
      ["Zelda: Create Object", { type: "torch", position: { x: 150, y: 40 } }],
      ["Zelda: Create Door", { position: { x: 200, y: 152 }, lock: "small_key", startOpen: false, height: 32 }],
      // Arena: an area drawn on the map; two waves start when the player walks in, then the mini-boss.
      ["Zelda: Create Chest", { position: { x: 300, y: 60 }, item: "rupees", count: 50, requiresBigKey: false, hidden: true }],
      ["Zelda: Create Wave Room", { area: { x: 298, y: 120, width: 172, height: 208 }, startAtOnce: false, delayMs: 800, spawnEnemy: "ogre", spawnAt: { x: 300, y: 120 }, message: "The guardian awakens!" }],
      ["Zelda: Add Wave Enemy", { wave: 1, template: "slime", position: { x: 300, y: 80 } }],
      ["Zelda: Add Wave Enemy", { wave: 1, template: "slime", position: { x: 320, y: 160 } }],
      ["Zelda: Add Wave Enemy", { wave: 2, template: "soldier", position: { x: 340, y: 120 } }],
      ["Zelda: Add Wave Enemy", { wave: 2, template: "spitter", position: { x: 300, y: 200 } }],
      ["Zelda: Add Rule", { whenBoss: true, revealAt: { x: 300, y: 60 }, once: true }],
    ],
    triggers: [
      { rect: { x: 0, y: 176, w: 6, h: 48 }, transfer: { map: "field", x: 370, y: 120 } },
    ],
  },
};
