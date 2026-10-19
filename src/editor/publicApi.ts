import type { Toolkit } from "../core/toolkit.ts";
import type { Handler, ZeldaEventName } from "../core/events.ts";
import type { ItemDefinition } from "../items/registry.ts";
import { createDataItem, type DataItemSpec } from "../items/builtinItems.ts";
import type { EnemyConfig } from "../enemies/templates.ts";
import type { ActionHandler, ConditionHandler } from "../puzzles/ruleRegistry.ts";
import { spawnEnemy, type SpawnEnemyOptions } from "../enemies/spawn.ts";
import { createObject, type CreateObjectOptions } from "../interactions/spawnObject.ts";
import { changeHealth } from "../player/health.ts";

export const GLOBAL_KEY = "ZeldaMakerToolkit";

/**
 * Public JavaScript API for extension plugins and PS Maker "Run Code" events.
 * It is the only global the toolkit defines (`globalThis.ZeldaMakerToolkit`).
 */
export function createPublicApi(tk: Toolkit) {
  return {
    version: "0.1.0",
    get toolkit() {
      return tk;
    },
    get session() {
      return tk.session;
    },
    on<K extends ZeldaEventName>(name: K, fn: Handler<K>) {
      return tk.bus.on(name, fn);
    },
    once<K extends ZeldaEventName>(name: K, fn: Handler<K>) {
      return tk.bus.once(name, fn);
    },
    off<K extends ZeldaEventName>(name: K, fn: Handler<K>) {
      tk.bus.off(name, fn);
    },
    emitCustom(name: string, data: Record<string, unknown> = {}) {
      tk.bus.emit(`zelda:custom:${name}`, data);
    },
    configure(patch: unknown) {
      return tk.configure(patch, "api");
    },
    registerItem(def: ItemDefinition) {
      tk.items.register(def);
    },
    defineItem(spec: DataItemSpec) {
      tk.items.register(createDataItem(spec));
    },
    registerEnemyTemplate(name: string, template: Partial<EnemyConfig> & { extends?: string }) {
      tk.enemyTemplates.define(name, template);
    },
    registerCondition(name: string, fn: ConditionHandler) {
      tk.ruleRegistry.registerCondition(name, fn);
    },
    registerAction(name: string, fn: ActionHandler) {
      tk.ruleRegistry.registerAction(name, fn);
    },
    extendStrings(tables: Record<string, Record<string, string>>) {
      tk.i18n.extend(tables);
    },
    getState() {
      return JSON.parse(JSON.stringify(tk.state));
    },
    give(item: string, count = 1, silent = false) {
      return tk.inventory.give(item, count, { silent });
    },
    spend(resource: string, count = 1) {
      return tk.inventory.spend(resource, count);
    },
    has(item: string, count = 1) {
      return tk.inventory.has(item, count);
    },
    setFlag(name: string, value: boolean | number | string = true) {
      tk.setFlag(name, value);
    },
    getFlag(name: string) {
      return tk.state.flags[name];
    },
    heal(amount: number) {
      return changeHealth(tk, amount);
    },
    damagePlayer(amount: number) {
      const s = tk.session;
      if (!s) return "ignored";
      return s.player.applyDamage(amount, { type: "script", sourceId: "api", originX: s.player.box.x, originY: s.player.box.y, knockback: 0 });
    },
    spawnEnemy(template: string, x: number, y: number, opts?: SpawnEnemyOptions) {
      return tk.session ? spawnEnemy(tk.session, template, x, y, opts) : null;
    },
    createObject(type: string, x: number, y: number, opts?: CreateObjectOptions) {
      return tk.session ? createObject(tk.session, type, x, y, opts) : null;
    },
    save(slot?: string) {
      return tk.saves.save(slot);
    },
    load(slot?: string) {
      return tk.saves.load({ slot });
    },
  };
}

export type ZeldaMakerToolkitApi = ReturnType<typeof createPublicApi>;

export function installPublicApi(tk: Toolkit): void {
  const g = globalThis as Record<string, unknown>;
  const existing = g[GLOBAL_KEY] as { version?: string } | undefined;
  if (existing && existing.version !== "0.1.0") {
    tk.logger.warn(`globalThis.${GLOBAL_KEY} already defined by version ${existing.version}; not overriding.`);
    return;
  }
  g[GLOBAL_KEY] = createPublicApi(tk);
}
