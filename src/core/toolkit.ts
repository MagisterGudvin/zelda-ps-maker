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
import { SaveManager, type SaveStorage, createBrowserStorage } from "../save/save.ts";

export interface ToolkitOptions {
  storage?: SaveStorage | null;
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
  readonly saves: SaveManager;

  state: GameState;
  session: Session | null = null;
  /** Project variable id → toolkit stat mirrored into it (Zelda: Show Stat In Variable). */
  readonly variableLinks = new Map<string, string>();
  /** Executed editor actions by name (shown by the diagnostics panel). */
  readonly actionCounts = new Map<string, number>();
  /** True once a game has been started or loaded (start items granted). */
  private gameInitialized = false;

  constructor(options: ToolkitOptions = {}) {
    this.logger = new Logger("[ZeldaMakerToolkit]", options.logSink);
    this.bus = new EventBus(this.logger);
    this.state = createDefaultState(this.config);
    this.inventory = new Inventory(this);
    this.saves = new SaveManager(this, options.storage === undefined ? createBrowserStorage() : options.storage);
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
    if (!this.gameInitialized) {
      if (this.config.features.save && this.config.save.autoLoadOnStart && this.saves.exists()) {
        this.saves.load({ silent: true });
      }
      if (!this.gameInitialized) this.newGame();
    }
    const session = new Session(this, host, mapId, options);
    this.session = session;
    session.player.captureStartPosition();
    this.bus.emit("zelda:toolkit:started", { mapId });
    return session;
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
