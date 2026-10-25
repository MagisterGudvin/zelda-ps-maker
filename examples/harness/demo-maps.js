/**
 * Demo project for Zelda Maker Toolkit.
 *
 * Each map lists exactly what an author enters in PS Maker:
 *  - `walls`: map collision rectangles (drawn with the PS Maker collision tool),
 *  - `npcs`: NPCs placed in the editor,
 *  - `onLoad`: the map's On-load events (plugin actions + their parameters),
 *  - `triggers`: event-group trigger areas with the events they run on touch.
 * The harness (host-emulator.js) replays them through the real plugin bundle.
 * All coordinates are pixels; tiles are 16x16.
 */

const RIGHT_GATE = { x: 384, y: 104, w: 16, h: 32 };

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
      { x: 384, y: 0, w: 16, h: 104 },
      { x: 384, y: 136, w: 16, h: 104 },
      // Secret room (top-left), entered through a bombable wall.
      { x: 16, y: 80, w: 32, h: 16 },
      { x: 64, y: 80, w: 32, h: 16 },
      { x: 96, y: 16, w: 16, h: 80 },
      // Switch ledge (top-right), reachable only by boomerang.
      { x: 284, y: 16, w: 16, h: 72 },
    ],
    npcs: [{ name: "npc_guard", x: 120, y: 184, color: "#d9822b" }],
    onLoad: [
      ["Zelda: Start Toolkit", { mapId: "field", difficulty: "alttp", hearts: 3, swordDamage: 2, magicBar: true, shieldButton: false, hudBottom: false, autosave: true, language: "auto", debugHitboxes: false, diagnostics: false }],
      ["Zelda: Enter Dungeon", { dungeonId: "", completeOnBoss: true }],
      ["Zelda: Set Respawn Point", { position: { x: 48, y: 140 } }],
      ["Zelda: Create Object", { type: "sign", position: { x: 32, y: 120 }, id: "sign_intro", text: "Arrows: move  X: sword (hold = spin)  C: item  Q/E: switch item  Z: lift/open  I: items  F9: hitboxes" }],
      // 3. Sword targets and enemies (several types).
      ["Zelda: Create Enemy", { template: "slime", position: { x: 230, y: 120 }, id: "slime_1", group: "field" }],
      ["Zelda: Create Enemy", { template: "slime", position: { x: 260, y: 160 }, id: "slime_2", group: "field" }],
      ["Zelda: Create Enemy", { template: "soldier", position: { x: 300, y: 205 }, id: "soldier_1", group: "field" }],
      // Patrol route: two points picked on the map, referenced by name.
      ["Zelda: Place Marker", { id: "patrol_a", position: { x: 150, y: 84 } }],
      ["Zelda: Place Marker", { id: "patrol_b", position: { x: 250, y: 84 } }],
      ["Zelda: Create Enemy", { template: "sentry", position: { x: 200, y: 84 }, id: "sentry_1", group: "", patrol: "patrol_a,patrol_b" }],
      // 6. Ranged enemy to test the shield.
      ["Zelda: Create Enemy", { template: "spitter", position: { x: 350, y: 180 }, id: "spitter_1", group: "field" }],
      // NPC placed in the editor turned into a shielded knight.
      ["Zelda: Enemy From NPC", { npc: "npc_guard", template: "knight", id: "knight_1", group: "field", hp: 4 }],
      // World objects.
      ["Zelda: Create Object", { type: "bush", position: { x: 152, y: 128 }, id: "" }],
      ["Zelda: Create Object", { type: "bush", position: { x: 168, y: 128 }, id: "" }],
      ["Zelda: Create Object", { type: "bush", position: { x: 152, y: 144 }, id: "" }],
      ["Zelda: Create Object", { type: "grass", position: { x: 232, y: 200 }, id: "" }],
      ["Zelda: Create Object", { type: "grass", position: { x: 248, y: 200 }, id: "" }],
      ["Zelda: Create Object", { type: "pot", position: { x: 56, y: 200 }, id: "" }],
      ["Zelda: Create Object", { type: "pot", position: { x: 72, y: 200 }, id: "" }],
      ["Zelda: Create Object", { type: "rock", position: { x: 120, y: 128 }, id: "" }],
      // 9. Items in chests.
      ["Zelda: Create Chest", { id: "boomerang_chest", position: { x: 200, y: 40 }, item: "boomerang", count: 1, requiresBigKey: false, hidden: false }],
      ["Zelda: Create Chest", { id: "bomb_chest", position: { x: 140, y: 200 }, item: "bombs", count: 5, requiresBigKey: false, hidden: false }],
      ["Zelda: Create Chest", { id: "bow_chest", position: { x: 248, y: 40 }, item: "bow", count: 1, requiresBigKey: false, hidden: false }],
      ["Zelda: Give Item", { item: "arrows", count: 10, silent: true }],
      // 4. Bomb + destructible wall + passage to a secret room.
      ["Zelda: Create Object", { type: "bombable_wall", position: { x: 56, y: 88 }, id: "secret_wall" }],
      ["Zelda: Create Chest", { id: "secret_chest", position: { x: 40, y: 40 }, item: "heart_container", count: 1, requiresBigKey: false, hidden: false }],
      ["Zelda: Create Object", { type: "pot", position: { x: 72, y: 40 }, id: "" }],
      // 5. Boomerang + switch behind pits; the switch opens the gate.
      ["Zelda: Create Object", { type: "button", position: { x: 340, y: 40 }, id: "gate_switch", staysOn: true }],
      ["Zelda: Create Object", { type: "pit", position: { x: 308, y: 80 }, id: "" }],
      ["Zelda: Create Object", { type: "pit", position: { x: 324, y: 80 }, id: "" }],
      ["Zelda: Create Object", { type: "pit", position: { x: 340, y: 80 }, id: "" }],
      ["Zelda: Create Object", { type: "pit", position: { x: 356, y: 80 }, id: "" }],
      ["Zelda: Create Object", { type: "pit", position: { x: 372, y: 80 }, id: "" }],
      ["Zelda: Create Door", { id: "gate", position: { x: 392, y: 120 }, lock: "switch", startOpen: false, height: 32 }],
      ["Zelda: Add Rule", { id: "open_gate", whenActive: "gate_switch", openDoors: "gate", message: "The gate opened!", once: true }],
      ["Zelda: Add Rule", { id: "field_cleared", whenDefeated: "field", giveItem: "rupees", giveCount: 20, message: "Field cleared!", once: true }],
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
      { x: 0, y: 0, w: 16, h: 184 },
      { x: 384, y: 0, w: 16, h: 240 },
      // Left half split horizontally with a shutter in the middle (puzzle door).
      { x: 16, y: 104, w: 76, h: 16 },
      { x: 108, y: 104, w: 84, h: 16 },
      // Vertical wall between the left half and the arena with a locked door.
      { x: 192, y: 16, w: 16, h: 96 },
      { x: 192, y: 128, w: 16, h: 96 },
    ],
    npcs: [],
    onLoad: [
      ["Zelda: Start Toolkit", { mapId: "dungeon", difficulty: "alttp", hearts: 3, swordDamage: 2, magicBar: true, shieldButton: false, hudBottom: false, autosave: true, language: "auto", debugHitboxes: false, diagnostics: false }],
      ["Zelda: Enter Dungeon", { dungeonId: "d1", completeOnBoss: true }],
      ["Zelda: Set Respawn Point", { position: { x: 40, y: 200 } }],
      // 8. Block + pressure plate opens the puzzle shutter.
      ["Zelda: Create Object", { type: "block", position: { x: 88, y: 168 }, id: "block_1" }],
      ["Zelda: Create Object", { type: "pressure_plate", position: { x: 104, y: 168 }, id: "plate_1", staysOn: true }],
      ["Zelda: Create Door", { id: "puzzle_door", position: { x: 100, y: 112 }, lock: "switch", startOpen: false }],
      ["Zelda: Add Rule", { id: "plate_opens_shutter", whenActive: "plate_1", openDoors: "puzzle_door", once: true }],
      // 7. Chest with a small key + locked door.
      ["Zelda: Create Chest", { id: "key_chest", position: { x: 60, y: 48 }, item: "key", count: 1, requiresBigKey: false, hidden: false }],
      ["Zelda: Create Object", { type: "torch", position: { x: 150, y: 40 }, id: "torch_1", setFlag: "torch_lit" }],
      ["Zelda: Create Door", { id: "key_door", position: { x: 200, y: 120 }, lock: "small_key", startOpen: false }],
      // Arena: two waves, then the mini-boss.
      // Arena: two waves (spawn points picked on the map), then the mini-boss.
      ["Zelda: Place Marker", { id: "boss_spot", position: { x: 300, y: 120 } }],
      ["Zelda: Create Chest", { id: "boss_chest", position: { x: 300, y: 60 }, item: "rupees", count: 50, requiresBigKey: false, hidden: true }],
      [
        "Zelda: Create Wave Room",
        {
          id: "arena",
          lockDoors: "",
          autoStart: false,
          delayMs: 800,
          spawnEnemy: "ogre",
          spawnAt: "boss_spot",
          message: "The guardian awakens!",
        },
      ],
      ["Zelda: Add Wave Enemy", { roomId: "arena", wave: 1, template: "slime", position: { x: 300, y: 80 } }],
      ["Zelda: Add Wave Enemy", { roomId: "arena", wave: 1, template: "slime", position: { x: 320, y: 160 } }],
      ["Zelda: Add Wave Enemy", { roomId: "arena", wave: 2, template: "soldier", position: { x: 340, y: 120 } }],
      ["Zelda: Add Wave Enemy", { roomId: "arena", wave: 2, template: "spitter", position: { x: 300, y: 200 } }],
      ["Zelda: Add Rule", { id: "boss_reward", whenBoss: true, reveal: "boss_chest", once: true }],
    ],
    triggers: [
      { rect: { x: 0, y: 184, w: 6, h: 40 }, transfer: { map: "field", x: 370, y: 120 } },
      { rect: { x: 216, y: 16, w: 16, h: 208 }, events: [["Zelda: Start Waves", { roomId: "arena" }]], once: true },
    ],
  },
};
