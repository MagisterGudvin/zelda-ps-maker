import type { HostAdapter } from "../host/types.ts";
import type { Toolkit } from "./toolkit.ts";
import { World } from "./world.ts";
import { Rng } from "./rng.ts";
import { Subscriptions } from "./events.ts";
import { PlayerSystem } from "../player/player.ts";
import { SwordSystem } from "../combat/sword.ts";
import { ItemSystem } from "../items/itemSystem.ts";
import { InventorySystem } from "../inventory/inventorySystem.ts";
import { InteractionSystem } from "../interactions/interactionSystem.ts";
import { RulesEngine } from "../puzzles/rules.ts";
import { DungeonSystem } from "../dungeons/dungeonSystem.ts";
import { HudSystem } from "../ui/hud.ts";
import { MessageBoxSystem } from "../ui/messageBox.ts";
import { MoveAbilities } from "../player/moves.ts";
import { UiScreenSystem } from "../ui/uiScreens.ts";
import { DebugSystem } from "../debug/debug.ts";
import { SoundSystem } from "../ui/sound.ts";
import type { FeatureId } from "./config.ts";
import type { Vec2 } from "./math.ts";
import { toWorld } from "./units.ts";
import { Interactable } from "../interactions/interactable.ts";
import { Enemy } from "../enemies/enemy.ts";

/** A subsystem that lives as long as one map session. */
export interface SessionSystem {
  readonly name: string;
  tick(dtMs: number): void;
  dispose(): void;
}

export interface SessionOptions {
  seed?: number;
}

/**
 * Everything that belongs to one bound map: host adapter, entity world and
 * per-map subsystems. Created by `Toolkit.start`, destroyed on map shutdown.
 * Disabled features leave their system `null`; callers must handle that.
 */
export class Session {
  readonly toolkit: Toolkit;
  readonly mapId: string;
  readonly host: HostAdapter;
  readonly world: World;
  readonly rng: Rng;
  readonly subs = new Subscriptions();
  /**
   * Named points placed with `Zelda: Place Marker` (PS Maker position picker).
   * Rules, waves and patrols refer to them with `"at": "<marker>"` instead of
   * typed coordinates.
   */
  readonly markers = new Map<string, Vec2>();

  readonly player: PlayerSystem;
  readonly sword: SwordSystem | null;
  /** Item moves: the Pegasus Boots dash, the Roc's Feather jump. */
  readonly moves: MoveAbilities | null;
  readonly items: ItemSystem | null;
  readonly inventoryUi: InventorySystem | null;
  readonly interactions: InteractionSystem | null;
  readonly rules: RulesEngine | null;
  readonly dungeons: DungeonSystem | null;
  readonly hud: HudSystem | null;
  readonly messageBox: MessageBoxSystem | null;
  readonly screens: UiScreenSystem | null;
  readonly debug: DebugSystem | null;
  readonly sound: SoundSystem;

  tick = 0;
  /** Accumulated real time not yet consumed by fixed steps. */
  private accumulator = 0;
  private readonly pauseReasons = new Set<string>();
  private disposed = false;
  private readonly systems: SessionSystem[] = [];

  constructor(toolkit: Toolkit, host: HostAdapter, mapId: string, options: SessionOptions = {}) {
    this.toolkit = toolkit;
    this.host = host;
    this.mapId = mapId;
    this.world = new World(host);
    this.rng = new Rng(options.seed ?? hashString(mapId));

    const f = toolkit.config.features;
    this.player = new PlayerSystem(this);
    this.sword = f.combat && toolkit.config.sword.enabled ? new SwordSystem(this) : null;
    this.moves = f.items ? new MoveAbilities(this) : null;
    this.items = f.items ? new ItemSystem(this) : null;
    this.inventoryUi = f.inventory ? new InventorySystem(this) : null;
    this.interactions = f.interactions ? new InteractionSystem(this) : null;
    this.rules = f.puzzles ? new RulesEngine(this) : null;
    this.dungeons = f.dungeons ? new DungeonSystem(this) : null;
    this.hud = f.ui && toolkit.config.ui.enabled && host.hud ? new HudSystem(this) : null;
    this.messageBox = this.hud ? new MessageBoxSystem(this) : null;
    this.screens = this.hud ? new UiScreenSystem(this) : null;
    this.debug = f.debugTools && host.debug ? new DebugSystem(this) : null;
    this.sound = new SoundSystem(this);

    // Order matters: input-driven systems first, entities next, evaluation last.
    this.systems.push(this.player);
    if (this.moves) this.systems.push(this.moves);
    if (this.sword) this.systems.push(this.sword);
    if (this.items) this.systems.push(this.items);
    if (this.interactions) this.systems.push(this.interactions);
  }

  get config() {
    return this.toolkit.config;
  }

  get state() {
    return this.toolkit.state;
  }

  get bus() {
    return this.toolkit.bus;
  }

  get logger() {
    return this.toolkit.logger;
  }

  get i18n() {
    return this.toolkit.i18n;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  feature(id: FeatureId): boolean {
    return this.toolkit.config.features[id];
  }

  /** Pauses simulation (inventory open, cutscene). Reasons are reference-counted by name. */
  setPaused(reason: string, paused: boolean): void {
    if (paused) this.pauseReasons.add(reason);
    else this.pauseReasons.delete(reason);
    if (this.pauseReasons.size > 0) {
      this.host.input.reset();
      this.player?.showForPause();
    }
  }

  isPaused(reason?: string): boolean {
    return reason ? this.pauseReasons.has(reason) : this.pauseReasons.size > 0;
  }

  /**
   * Advances the simulation by real elapsed time using a fixed step so that
   * combat resolution is deterministic regardless of frame rate.
   */
  update(deltaMs: number): void {
    if (this.disposed) return;
    const step = 1000 / this.config.world.fixedStepHz;
    const maxSteps = this.config.world.maxStepsPerFrame;
    this.accumulator = Math.min(this.accumulator + Math.max(0, deltaMs), step * maxSteps);
    let steps = 0;
    while (this.accumulator >= step && steps < maxSteps) {
      this.accumulator -= step;
      this.step(step);
      steps++;
    }
  }

  private readonly linkedLast = new Map<string, number | string>();

  /**
   * Current value of a stat mirrored into a project variable (Show Stat In Variable, HUD
   * Variables). Whole numbers where a HUD built with Add UI needs them: PS Maker expressions have
   * only + - * / (variableValue.ts), so the toolkit hands out full hearts, the half heart as 0/1, a
   * selected or owned item as 0/1.
   */
  statValue(stat: string): number | string {
    const st = this.state.player;
    const inv = this.toolkit.inventory;
    const heart = Math.max(1, this.config.player.heartValue);
    const [kind, item] = stat.split(":");
    switch (kind) {
      case "hearts":
        return st.hp / heart;
      case "maxHearts":
        return st.maxHp / heart;
      case "fullHearts":
        return Math.floor(Math.max(0, st.hp) / heart);
      case "halfHeart":
        return st.hp > 0 && st.hp % heart !== 0 ? 1 : 0;
      case "health":
        return st.hp;
      case "maxHealth":
        return st.maxHp;
      case "magicPercent":
        return st.maxMagic > 0 ? Math.round((100 * st.magic) / st.maxMagic) : 0;
      case "itemName":
        return this.state.inventory.activeItem ? inv.displayName(this.state.inventory.activeItem) : "";
      case "itemCount": {
        const def = this.state.inventory.activeItem ? this.toolkit.items.get(this.state.inventory.activeItem) : undefined;
        const counter = def?.counter ?? def?.resource;
        return counter && counter !== "magic" ? inv.count(counter) : 0;
      }
      case "selected":
        return this.state.inventory.activeItem === item ? 1 : 0;
      case "owned":
        return item && inv.has(item) ? 1 : 0;
      case "enemies":
        return this.world.list("enemy").filter((e) => e.alive && !e.removed).length;
      default:
        return inv.count(stat);
    }
  }

  /** Writes linked stats into PS Maker variables when they change (a few times a second). */
  private syncLinkedVariables(): void {
    const links = this.toolkit.variableLinks;
    if (links.size === 0 || !this.host.setVariable || this.tick % 6 !== 0) return;
    for (const [id, stat] of links) {
      const v = this.statValue(stat);
      if (this.linkedLast.get(id) === v) continue;
      this.linkedLast.set(id, v);
      this.host.setVariable(id, v);
    }
  }

  /** One fixed simulation tick. Public for tests. */
  step(dtMs: number): void {
    if (this.disposed) return;
    this.tick++;
    this.host.beginTick(this.tick);
    this.host.input.latch();
    this.world.reindex();

    const dialogue = this.config.combat.pauseDuringDialogue && this.host.isDialogueOpen?.() === true;
    if (dialogue !== this.isPaused("dialogue")) {
      this.setPaused("dialogue", dialogue);
      // The key that closed PS Maker's dialogue must not also open the chest or sign in front.
      if (!dialogue) this.host.input.reset();
    }

    this.debug?.handleInput();
    this.screens?.tick();
    this.inventoryUi?.tick(dtMs);
    this.messageBox?.tick();

    if (!this.isPaused()) {
      for (let i = 0; i < this.systems.length; i++) this.systems[i].tick(dtMs);
      this.tickEntities(dtMs);
      this.player.flushOverlay();
      this.dungeons?.tick(dtMs);
      this.rules?.tick(dtMs);
      this.world.flush();
    }

    this.syncViews();
    this.syncLinkedVariables();
    if (this.tick % 15 === 0) this.toolkit.syncProgressVariable(this.host);
    this.hud?.tick(dtMs);
    this.debug?.tick(dtMs);
  }

  private tickEntities(dtMs: number): void {
    // Iterate by index: entities spawned during the tick are appended and
    // simulated starting next tick (their tick runs once they exist at start).
    const kinds = ["enemy", "object", "projectile", "pickup", "effect"] as const;
    for (const kind of kinds) {
      const list = this.world.list(kind);
      const n = list.length;
      for (let i = 0; i < n; i++) {
        const e = list[i];
        if (e.removed) continue;
        e.tick(dtMs, this);
      }
    }
  }

  private syncViews(): void {
    for (const e of this.world.all()) {
      if (!e.removed) e.syncView();
    }
  }

  /**
   * Resolves a point given as `{ at: "marker" }`, `"marker"` or `{ x, y }`
   * (pixels or tiles per `world.positionUnits`). Unknown markers are logged.
   */
  resolvePoint(spec: unknown, what: string, fallback: Vec2 | null = null): Vec2 | null {
    const markerId = typeof spec === "string" ? spec : spec && typeof spec === "object" && typeof (spec as { at?: unknown }).at === "string" ? (spec as { at: string }).at : null;
    if (markerId !== null) {
      const m = this.markers.get(markerId);
      if (m) return { x: m.x, y: m.y };
      this.logger.warn(`${what}: marker "${markerId}" is not placed on map "${this.mapId}" (use Zelda: Place Marker before it).`);
      return fallback;
    }
    const o = (spec ?? {}) as { x?: unknown; y?: unknown };
    if (typeof o.x === "number" && typeof o.y === "number") return { x: toWorld(this.config, o.x), y: toWorld(this.config, o.y) };
    if (!fallback) this.logger.warn(`${what}: no position (give "at": "<marker>" or "x"/"y").`);
    return fallback;
  }

  /** A save was loaded: re-sync persistent objects on this map with the new state. */
  onStateReplaced(): void {
    for (const e of this.world.list("object")) if (e instanceof Interactable) e.syncWithState();
    for (const e of this.world.list("enemy")) {
      if (e instanceof Enemy && e.persistentKey && this.state.objects[e.persistentKey] === "defeated") this.world.remove(e);
    }
    this.world.flush();
    this.hud?.markDirty();
  }

  /** Releases all map-local resources. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.systems.length - 1; i >= 0; i--) {
      try {
        this.systems[i].dispose();
      } catch (err) {
        this.logger.error(`Disposing ${this.systems[i].name} failed:`, err);
      }
    }
    this.screens?.dispose();
    this.inventoryUi?.dispose();
    this.messageBox?.dispose();
    this.rules?.dispose();
    this.dungeons?.dispose();
    this.hud?.dispose();
    this.debug?.dispose();
    this.sound.dispose();
    this.subs.releaseAll();
    this.world.clear();
    this.markers.clear();
    this.pauseReasons.clear();
  }
}

/** FNV-1a; used to derive a stable RNG seed from the map id. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
