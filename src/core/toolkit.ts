import type { HostAdapter } from "../host/types.ts";
import { CONFIG_PRESETS, type ConfigIssue, createDefaultConfig, mergeConfig, type ToolkitConfig } from "./config.ts";
import { EventBus, type FlagValue } from "./events.ts";
import { Logger, type LogSink } from "./logger.ts";
import { createDefaultState, type GameState } from "./state.ts";
import { Session, type SessionOptions } from "./session.ts";
import { I18n } from "../ui/i18n.ts";
import { Inventory } from "../inventory/inventory.ts";
import { ItemRegistry } from "../items/registry.ts";
import { registerBuiltinItems } from "../items/builtinItems.ts";
import { EnemyTemplateRegistry } from "../enemies/templates.ts";
import { RuleRegistry } from "../puzzles/ruleRegistry.ts";
import { parseProgress, serializeProgress } from "../save/save.ts";
import type { UiLayout } from "../ui/uiLayout.ts";

export interface ToolkitOptions {
  logSink?: LogSink;
}

/**
 * Process-wide toolkit instance: configuration, persistent game state, the
 * event bus and extension registries. A `Session` is attached per map.
 */
export class Toolkit {
  readonly config: ToolkitConfig = createDefaultConfig();
  readonly logger: Logger;
  readonly bus: EventBus;
  readonly i18n = new I18n();
  readonly items = new ItemRegistry();
  readonly enemyTemplates = new EnemyTemplateRegistry();
  readonly ruleRegistry = new RuleRegistry();
  readonly inventory: Inventory;

  state: GameState;
  session: Session | null = null;
  /** Project variable id → toolkit stat mirrored into it (Zelda: Show Stat In Variable). */
  readonly variableLinks = new Map<string, string>();
  /**
   * Text variable of the project that always holds the toolkit's progress (Start Toolkit →
   * Progress variable). PS Maker keeps variables in its saves, so its save and load menus carry
   * the toolkit's progress too.
   */
  progressVariable: string | null = null;
  /** The HUD made in the designer (Zelda: UI Layout); null = the classic HUD. */
  hudLayout: UiLayout | null = null;
  /** Project font id → CSS family, for the fonts the layouts use. */
  readonly uiFonts: Record<string, string> = {};
  /** The project's shared HUD (a UI Layout for every map), found when a map starts; null = none. */
  sharedHud: { actionId: string; mapName: string; raw: string } | null = null;
  /** UI screens by name (Zelda: UI Layout with a screen name), kept across maps. */
  readonly uiScreens = new Map<string, UiLayout>();
  private progressWritten: string | null = null;
  /** Executed editor actions by name (shown by the diagnostics panel). */
  readonly actionCounts = new Map<string, number>();
  /** True once a game has been started or loaded (start items granted). */
  private gameInitialized = false;

  constructor(options: ToolkitOptions = {}) {
    this.logger = new Logger("[ZeldaMakerToolkit]", options.logSink);
    this.bus = new EventBus(this.logger);
    this.state = createDefaultState(this.config);
    this.inventory = new Inventory(this);
    registerBuiltinItems(this.items);
    this.applyRuntimeSettings();
  }

  /** Merges a JSON-like patch into the configuration and reports problems. */
  configure(patch: unknown, source = "config"): ConfigIssue[] {
    const issues = mergeConfig(this.config, patch);
    for (const issue of issues) this.logger.warn(`${source}: ${issue.path}: ${issue.message}`);
    this.applyRuntimeSettings();
    return issues;
  }

  applyPreset(name: string): boolean {
    const preset = CONFIG_PRESETS[name];
    if (preset === undefined) {
      this.logger.warn(`Unknown preset "${name}". Available: ${Object.keys(CONFIG_PRESETS).join(", ")}`);
      return false;
    }
    this.configure(preset, `preset ${name}`);
    return true;
  }

  private applyRuntimeSettings(): void {
    this.logger.level = this.config.debug.logLevel;
    this.i18n.setLanguage(this.config.language);
    this.session?.hud?.markDirty();
    this.session?.debug?.setEnabled(this.config.debug.hitboxes);
    if (this.session?.debug && this.session.debug.diagnosticsOn !== this.config.debug.diagnostics) this.session.debug.setDiagnostics(this.config.debug.diagnostics);
  }

  /** Starts a fresh game: default state plus configured starting items. */
  newGame(): void {
    this.state = createDefaultState(this.config);
    for (const item of this.config.player.startItems) this.inventory.give(item, 1, { silent: true });
    for (const [res, count] of Object.entries(this.config.player.startCounts)) this.inventory.give(res, count, { silent: true });
    this.gameInitialized = true;
  }

  get isGameInitialized(): boolean {
    return this.gameInitialized;
  }

  markGameInitialized(): void {
    this.gameInitialized = true;
  }

  /** Sets a persistent game flag and notifies listeners (rules re-evaluate). */
  setFlag(name: string, value: FlagValue): void {
    if (!name) return;
    if (this.state.flags[name] === value) return;
    if (value === false) delete this.state.flags[name];
    else this.state.flags[name] = value;
    this.bus.emit("zelda:flag:changed", { flag: name, value });
  }

  /** Binds the toolkit to a map; stops the previous session first. */
  start(host: HostAdapter, mapId: string, options: SessionOptions = {}): Session {
    this.stop("restart");
    if (!this.gameInitialized) this.newGame();
    // Each map shows its own UI Layout or the classic HUD, as its game window frame in the editor does.
    this.hudLayout = null;
    const session = new Session(this, host, mapId, options);
    this.session = session;
    session.player.captureStartPosition();
    this.bus.emit("zelda:toolkit:started", { mapId });
    return session;
  }

  /**
   * Keeps the progress variable and the toolkit state in step (a few times a second). A value the
   * toolkit did not write came from PS Maker: a loaded save (restore it) or, when it is empty again,
   * a new game (start over). On the first sync of a page a filled variable counts as loaded.
   */
  syncProgressVariable(host: HostAdapter): void {
    const id = this.progressVariable;
    if (!id || !host.getVariable || !host.setVariable) return;
    const value = host.getVariable(id);
    if (value === undefined) {
      this.logger.warnOnce(`progress-var-${id}`, `Progress variable "${id}" not found in the project.`);
      return;
    }
    if (typeof value !== "string") {
      this.logger.warnOnce(`progress-var-type-${id}`, `Progress variable "${id}" must be a Text variable.`);
      return;
    }
    // The first time, a filled variable is progress the toolkit has not seen yet (a loaded save).
    if (value !== this.progressWritten && (this.progressWritten !== null || value !== "")) {
      if (value === "") {
        this.logger.info("The progress variable was cleared (PS Maker started a new game): toolkit progress starts over.");
        this.newGame();
        this.session?.onStateReplaced();
        this.bus.emit("zelda:player:healthChanged", { hp: this.state.player.hp, maxHp: this.state.player.maxHp, delta: 0 });
      } else if (this.restoreProgress(value)) {
        this.logger.info("Toolkit progress restored from the progress variable (PS Maker loaded a save).");
      }
    }
    const now = serializeProgress(this.state);
    if (now !== value) host.setVariable(id, now);
    this.progressWritten = now;
  }

  /** Replaces the progress with saved text (the progress variable). */
  restoreProgress(raw: string): boolean {
    const state = parseProgress(raw, this.config, this.logger);
    if (!state) return false;
    this.state = state;
    this.markGameInitialized();
    this.session?.onStateReplaced();
    this.bus.emit("zelda:player:healthChanged", { hp: state.player.hp, maxHp: state.player.maxHp, delta: 0 });
    return true;
  }

  noteAction(name: string): void {
    this.actionCounts.set(name, (this.actionCounts.get(name) ?? 0) + 1);
  }

  stop(reason: string): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    this.logger.info(`Stopped on map "${s.mapId}" after ${(s.tick / this.config.world.fixedStepHz).toFixed(1)} s (${reason}).`);
    s.dispose();
    try {
      s.host.dispose();
    } catch (err) {
      this.logger.error("Host dispose failed:", err);
    }
    this.bus.emit("zelda:toolkit:stopped", { mapId: s.mapId, reason });
  }
}
