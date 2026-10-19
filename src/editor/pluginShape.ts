import type { Plugin, PluginEvent } from "@ps-maker/plugin-api";

/**
 * @ps-maker/plugin-api 0.0.3 (the latest on npm) names the list `events`; the
 * online docs mention `defineAction`/actions. Exposing the same array under
 * both names keeps the bundle loadable by either editor version. See
 * docs/ENGINE_AUDIT.md (U-1).
 */
export function withActionsAlias<E extends readonly PluginEvent<any>[]>(plugin: Plugin<E>): Plugin<E> & { actions: E } {
  return Object.assign(plugin, { actions: plugin.events });
}
