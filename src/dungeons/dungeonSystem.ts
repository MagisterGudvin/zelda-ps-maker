import type { Session } from "../core/session.ts";
import { getDungeon } from "../core/state.ts";
import { toWorld } from "../core/units.ts";
import { aliveInGroup, spawnEnemy } from "../enemies/spawn.ts";
import type { EnemyConfig } from "../enemies/templates.ts";
import type { RuleAction } from "../puzzles/ruleTypes.ts";
import { Interactable } from "../interactions/interactable.ts";

export interface WaveSpawn {
  template: string;
  x: number;
  y: number;
  overrides?: Partial<EnemyConfig>;
}

export interface WaveRoomSpec {
  id: string;
  waves: WaveSpawn[][];
  /** Start immediately when created (default) or wait for `startWaves`. */
  autoStart?: boolean;
  /** Doors closed while the fight is on and opened when it ends. */
  lockDoors?: string[];
  onCleared?: RuleAction[];
  delayMs?: number;
}

interface WaveRoomEntry {
  spec: WaveRoomSpec;
  wave: number;
  running: boolean;
  delayMs: number;
}

/**
 * Dungeon progress (current dungeon, keys, boss, completion) and enemy wave
 * rooms. Key counts themselves live in GameState via the inventory.
 */
export class DungeonSystem {
  readonly name = "dungeons";
  private readonly s: Session;
  private readonly rooms = new Map<string, WaveRoomEntry>();
  private readonly completeOnBoss = new Map<string, boolean>();
  private readonly offBoss: () => void;
  private readonly offDefeat: () => void;

  constructor(session: Session) {
    this.s = session;
    this.offBoss = session.bus.on("zelda:boss:defeated", (e) => {
      const id = e.dungeonId;
      if (!id) return;
      getDungeon(session.state, id).bossDefeated = true;
      if (this.completeOnBoss.get(id) !== false) this.complete(id);
    });
    this.offDefeat = session.bus.on("zelda:enemy:defeated", (e) => {
      const room = e.group.startsWith("wave:") ? this.rooms.get(e.group.slice(5)) : undefined;
      if (room && room.running && aliveInGroup(session, e.group) === 0) room.delayMs = room.spec.delayMs ?? 600;
    });
  }

  enter(dungeonId: string, options: { completeOnBoss?: boolean } = {}): void {
    if (!dungeonId) return;
    this.s.state.currentDungeon = dungeonId;
    getDungeon(this.s.state, dungeonId);
    if (options.completeOnBoss !== undefined) this.completeOnBoss.set(dungeonId, options.completeOnBoss);
    this.s.bus.emit("zelda:dungeon:entered", { dungeonId });
    this.s.bus.emit("zelda:resource:changed", { resource: "keys", value: getDungeon(this.s.state, dungeonId).keys, max: 99 });
  }

  leave(): void {
    this.s.state.currentDungeon = null;
    this.s.bus.emit("zelda:resource:changed", { resource: "keys", value: getDungeon(this.s.state, null).keys, max: 99 });
  }

  complete(dungeonId: string | null): void {
    const id = dungeonId ?? this.s.state.currentDungeon;
    if (!id) return;
    const d = getDungeon(this.s.state, id);
    if (d.completed) return;
    d.completed = true;
    this.s.bus.emit("zelda:dungeon:completed", { dungeonId: id });
    this.s.bus.emit("zelda:message", { text: this.s.i18n.t("msg.dungeon_completed"), durationMs: this.s.config.ui.messageMs });
    if (this.s.config.save.autoSave) this.s.toolkit.saves.autoSave("dungeon");
  }

  addWaveRoom(spec: WaveRoomSpec): void {
    if (!spec.id || !Array.isArray(spec.waves) || spec.waves.length === 0) throw new Error("Wave room needs an id and at least one wave");
    const entry: WaveRoomEntry = { spec, wave: -1, running: false, delayMs: 0 };
    this.rooms.set(spec.id, entry);
    if (this.s.state.flags[`waves:${spec.id}`]) {
      this.setDoors(spec, true);
      return;
    }
    if (spec.autoStart !== false) this.startWaves(spec.id);
  }

  startWaves(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      this.s.logger.warn(`startWaves: unknown wave room "${roomId}".`);
      return;
    }
    if (room.running || this.s.state.flags[`waves:${roomId}`]) return;
    room.running = true;
    room.wave = -1;
    this.setDoors(room.spec, false);
    this.nextWave(room);
  }

  private nextWave(room: WaveRoomEntry): void {
    room.wave++;
    const spec = room.spec;
    if (room.wave >= spec.waves.length) {
      room.running = false;
      this.s.toolkit.setFlag(`waves:${spec.id}`, true);
      this.setDoors(spec, true);
      this.s.bus.emit("zelda:wave:cleared", { roomId: spec.id });
      if (spec.onCleared && this.s.rules) this.s.rules.execute(spec.onCleared, `wave room ${spec.id}`);
      return;
    }
    const group = `wave:${spec.id}`;
    let spawned = 0;
    for (const w of spec.waves[room.wave]) {
      if (spawnEnemy(this.s, w.template, toWorld(this.s.config, w.x), toWorld(this.s.config, w.y), { group, overrides: w.overrides })) spawned++;
    }
    this.s.bus.emit("zelda:wave:started", { roomId: spec.id, wave: room.wave + 1, total: spec.waves.length });
    // An empty/failed wave must not stall the room.
    if (spawned === 0) room.delayMs = 1;
  }

  private setDoors(spec: WaveRoomSpec, open: boolean): void {
    for (const id of spec.lockDoors ?? []) {
      const d = this.s.world.get(id);
      if (!(d instanceof Interactable)) continue;
      if (open) d.open();
      else d.close();
    }
  }

  tick(dtMs: number): void {
    for (const room of this.rooms.values()) {
      if (!room.running || room.delayMs <= 0) continue;
      room.delayMs -= dtMs;
      if (room.delayMs <= 0) this.nextWave(room);
    }
  }

  dispose(): void {
    this.offBoss();
    this.offDefeat();
    this.rooms.clear();
  }
}
