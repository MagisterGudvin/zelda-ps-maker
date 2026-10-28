import type { Session } from "../core/session.ts";
import { mapSceneOf, PhaserHost, type PluginContextLike } from "../host/phaserHost.ts";
import { getToolkit } from "./runtime.ts";

/**
 * Coming back to a map. PS Maker 1.2.1 switches maps with Phaser's `scene.switch`: the map you
 * leave goes to sleep and, when you come back, wakes up from its saved state without running its
 * "Map start" actions again (ActiveMap.performSwitchMap, MapStateTracker; ENGINE_AUDIT, section
 * 13). The Toolkit therefore remembers the Zelda actions that built each map and runs them again
 * when PS Maker wakes the map up. Effects (Give Item, Show Message, Save...) are not repeated;
 * opened chests, broken walls and taken keys stay so through the Toolkit's saved state.
 */

/** Actions that build the map: replayed on wake. Start Toolkit begins a map's list. */
export const MAP_BUILDING_ACTIONS = new Set([
  "Zelda: Start Toolkit",
  "Zelda: Set Controls",
  "Zelda: Create Enemy",
  "Zelda: Enemy From NPC",
  "Zelda: Create Object",
  "Zelda: Create Chest",
  "Zelda: Create Door",
  "Zelda: Place Item",
  "Zelda: Add Rule",
  "Zelda: Create Switch Sequence",
  "Zelda: Create Wave Room",
  "Zelda: Add Wave Enemy",
  "Zelda: Enter Dungeon",
  "Zelda: Show Stat In Variable",
  "Zelda: Set Respawn Point",
  "Zelda: Define Item",
  "Zelda: Define Enemy",
  "Zelda: Set Player Sprites",
  "Zelda: Set Sound",
  "Zelda: HUD Style",
]);

type Execute = (params: unknown, ctx: PluginContextLike) => void;
interface Entry {
  name: string;
  execute: Execute;
  params: unknown;
  ctx: PluginContextLike;
}

const scripts = new WeakMap<object, Entry[]>();
const watched = new WeakSet<object>();
const replayedSessions = new WeakSet<Session>();
let replaying = false;

const sceneOf = (session: Session | null): unknown => (session && !session.isDisposed && session.host instanceof PhaserHost ? session.host.scene : null);

/** True while the Toolkit re-runs a woken map's actions. */
export function isReplaying(): boolean {
  return replaying;
}

/** A session made by re-running a woken map's actions (a Start Toolkit in "Map enter" replaces it). */
export function isReplayedSession(session: Session | null): boolean {
  return !!session && replayedSessions.has(session);
}

/**
 * Called after every Zelda action with the session from before it ran.
 */
export function recordMapAction(name: string, execute: Execute, params: unknown, ctx: PluginContextLike, sessionBefore: Session | null): void {
  if (replaying || !MAP_BUILDING_ACTIONS.has(name)) return;
  const scene = mapSceneOf(ctx) as object | null;
  const session = getToolkit().session;
  if (!scene || typeof scene !== "object" || sceneOf(session) !== scene) return;
  // PS Maker's endAction must not be called again: the stored context has none.
  const entry: Entry = { name, execute, params: clone(params), ctx: { ...ctx, endAction: undefined } as PluginContextLike };
  // A new session (Start Toolkit, or the first action of a map without it) begins the map's list.
  if (session !== sessionBefore) scripts.set(scene, [entry]);
  else scripts.get(scene)?.push(entry);
  watch(scene);
}

function watch(scene: object): void {
  if (watched.has(scene)) return;
  const events = (scene as { sys?: { events?: { on?(e: string, f: () => void): void } } }).sys?.events;
  if (typeof events?.on !== "function") return;
  watched.add(scene);
  events.on("sleep", () => {
    const tk = getToolkit();
    if (sceneOf(tk.session) === scene) tk.stop("map left (asleep)");
  });
  events.on("wake", () => replay(scene));
  // A map that is really closed starts over with its "Map start" actions.
  events.on("shutdown", () => scripts.delete(scene));
}

/** Re-runs the actions that built a woken map. */
export function replay(scene: object): void {
  const script = scripts.get(scene);
  const tk = getToolkit();
  if (!script?.length || sceneOf(tk.session) === scene) return;
  const key = (scene as { sys?: { settings?: { key?: string } } }).sys?.settings?.key ?? "?";
  tk.logger.info(`Map "${key}" woke up: running its ${script.length} Zelda actions again.`);
  replaying = true;
  try {
    for (const e of script) {
      try {
        e.execute(clone(e.params), e.ctx);
      } catch (err) {
        tk.logger.error(`Re-running "${e.name}" failed:`, err);
      }
    }
  } finally {
    replaying = false;
  }
  if (tk.session) replayedSessions.add(tk.session);
}

function clone<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return v;
  }
}
