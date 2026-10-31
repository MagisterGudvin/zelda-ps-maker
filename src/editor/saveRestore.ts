import { deriveMapId, getToolkit, startSession } from "./runtime.ts";
import { isReplaying, MAP_BUILDING_ACTIONS } from "./mapReplay.ts";
import { PhaserHost } from "../host/phaserHost.ts";
import { isToolkitOff, projectStartAction, type ProjectLike } from "./projectStart.ts";

/**
 * Loading a PS Maker save. `loadGame` recreates the game and every map scene from its saved
 * snapshot; a map with a snapshot does not run its "Map setup" / "Map start" actions again
 * (`MapStartup`: only executions that were still running when the game was saved are resumed;
 * ENGINE_AUDIT, section 17). Start Toolkit and the Zelda actions that build the map would never
 * run, so the Toolkit runs them itself for such a map. Its progress (opened chests, items) comes
 * back through the progress variable (Toolkit.syncProgressVariable).
 */

const REGISTRY_KEY = "__zeldaMakerToolkitRestore";
const POLL_MS = 200;

interface ActionDef {
  name: string;
  execute(params: unknown, ctx: unknown): void;
}

interface MapScene {
  map?: { id?: string; setupActions?: unknown[]; initialActions?: unknown[] };
  sceneCreated?: boolean;
  inEditorMode?: boolean;
  mapStartSnapshot?: unknown;
  hasSavedMapStartup?: boolean;
  /** PS Maker's MapStartup: needsStart = !hasSnapshot || savedSetup.length > 0 (MapStartup.ts). */
  mapStartup?: { needsStart?: boolean; hasSavedStartup?: boolean } | null;
  player?: unknown;
  story?: ProjectLike;
  sys?: { isActive?(): boolean };
}

/** True for a map scene that PS Maker restored from a save and will not start itself. */
export function isRestoredMap(scene: MapScene): boolean {
  // PS Maker's own decision whether "Map start" will run, when the scene exposes it.
  const startup = scene.mapStartup;
  if (startup && typeof startup.needsStart === "boolean") return !startup.needsStart && startup.hasSavedStartup !== true;
  return !!scene.mapStartSnapshot && scene.hasSavedMapStartup !== true;
}

/** The Zelda actions that build the map, from its "Map setup" and "Map start" lists. */
export function mapBuildingActions(map: MapScene["map"]): { actionName: string; pluginParams: unknown }[] {
  const lists = [map?.setupActions, map?.initialActions].filter(Array.isArray) as unknown[][];
  const out: { actionName: string; pluginParams: unknown }[] = [];
  for (const list of lists) {
    for (const a of list as { type?: unknown; actionName?: unknown; pluginParams?: unknown }[]) {
      if (typeof a?.type !== "string" || !a.type.startsWith("plugin:") || typeof a.actionName !== "string") continue;
      if (MAP_BUILDING_ACTIONS.has(a.actionName)) out.push({ actionName: a.actionName, pluginParams: a.pluginParams ?? {} });
    }
  }
  return out;
}

function runningOn(scene: object): boolean {
  const s = getToolkit().session;
  return !!s && !s.isDisposed && s.host instanceof PhaserHost && s.host.scene === scene;
}

/** Runs a restored map's Zelda actions (recorded as usual, so the map also comes back after sleeping). */
export function startRestoredMap(scene: MapScene, actions: readonly ActionDef[], game: unknown): number {
  const tk = getToolkit();
  const list = mapBuildingActions(scene.map);
  if (list.length === 0) return 0;
  tk.logger.info(`Map "${scene.map?.id ?? "?"}" was restored from a PS Maker save: running its ${list.length} Zelda actions.`);
  const ctx = { game, scene, player: scene.player, endAction: () => {} };
  for (const a of list) {
    const def = actions.find((d) => d.name === a.actionName);
    try {
      def?.execute(structuredClone(a.pluginParams), ctx);
    } catch (err) {
      tk.logger.error(`Running "${a.actionName}" after loading failed:`, err);
    }
  }
  return list.length;
}

/**
 * The toolkit on every map: a project with a Start Toolkit (on any map) runs the toolkit on the
 * map the player is on, also on maps with no Zelda action, unless Stop Toolkit turned it off there.
 * A map's own Zelda actions start it as soon as they run; this covers the others.
 */
export function startOnMap(scene: MapScene, game: unknown): boolean {
  if (!scene.player || runningOn(scene) || isReplaying() || isToolkitOff(scene) || !projectStartAction(scene.story)) return false;
  startSession({ game, scene, player: scene.player }, deriveMapId(scene));
  return true;
}

/** Watches the game (browser only): map scenes restored from a save, and maps the toolkit is not running on yet. */
export function startRestoreWatcher(actions: readonly ActionDef[], win: any = globalThis): void {
  if (!win || typeof win.document === "undefined" || typeof win.setInterval !== "function") return;
  win[REGISTRY_KEY]?.stop?.();
  const seen = new WeakSet<object>();
  const tick = () => {
    const scenes: MapScene[] = win.game?.scene?.getScenes?.(true) ?? [];
    for (const scene of scenes) {
      if (!scene || typeof scene !== "object" || seen.has(scene) || !scene.map || scene.inEditorMode === true || scene.sceneCreated !== true) continue;
      seen.add(scene);
      if (isRestoredMap(scene) && !runningOn(scene)) startRestoredMap(scene, actions, win.game);
    }
    // The map the player is on now (PS Maker keeps left maps asleep, not in the active list).
    const here = scenes.find((s) => s && typeof s === "object" && s.map && s.inEditorMode !== true && s.sceneCreated === true && s.player);
    if (here) startOnMap(here, win.game);
  };
  const id = win.setInterval(() => {
    try {
      tick();
    } catch (err) {
      getToolkit().logger.error("Save restore watcher failed:", err);
    }
  }, POLL_MS);
  win[REGISTRY_KEY] = { stop: () => win.clearInterval?.(id) };
}
