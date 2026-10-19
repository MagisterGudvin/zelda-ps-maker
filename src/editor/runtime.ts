import { Toolkit } from "../core/toolkit.ts";
import type { Session } from "../core/session.ts";
import { PhaserHost, type PluginContextLike } from "../host/phaserHost.ts";
import { installPublicApi } from "./publicApi.ts";

/**
 * Process-wide toolkit instance and its binding to PS Maker scenes. PS Maker
 * has no plugin lifecycle hooks, so the toolkit binds itself the first time an
 * action runs on a map scene and unbinds on the scene's shutdown/destroy.
 */
let instance: Toolkit | null = null;

export function getToolkit(): Toolkit {
  if (!instance) {
    instance = new Toolkit();
    if (instance.config.publicApi) installPublicApi(instance);
  }
  return instance;
}

/** For tests: forget the singleton. */
export function resetToolkitForTests(): void {
  instance?.stop("test reset");
  instance = null;
}

/** Best-effort map id when the author did not set one (see docs: always set Map ID). */
export function deriveMapId(scene: any): string {
  const candidates = [scene?.mapId, scene?.mapKey, scene?.currentMapId, scene?.map?.id, scene?.mapName, scene?.sys?.settings?.key];
  for (const c of candidates) if (typeof c === "string" || typeof c === "number") return String(c);
  return "map";
}

function hostOf(session: Session): PhaserHost | null {
  return session.host instanceof PhaserHost ? session.host : null;
}

/** Starts (or restarts) the toolkit on the context's scene. */
export function startSession(ctx: PluginContextLike, mapId: string): Session {
  const tk = getToolkit();
  const host = new PhaserHost(ctx, tk.config, tk.logger);
  const session = tk.start(host, mapId);
  host.attach(
    (delta) => session.update(delta),
    () => {
      if (tk.session === session) tk.stop("scene shutdown");
    },
  );
  tk.logger.info(`Started on map "${mapId}".`);
  return session;
}

/**
 * Returns the session bound to the context's scene, starting one with
 * defaults if the author did not call `Zelda: Start Toolkit` first.
 */
export function ensureSession(ctx: PluginContextLike, mapId?: string): Session {
  const tk = getToolkit();
  const current = tk.session;
  if (current && !current.isDisposed) {
    const host = hostOf(current);
    const sameScene = host ? host.scene === ctx.scene : true;
    const sameMap = mapId === undefined || mapId === "" || mapId === current.mapId;
    if (sameScene && sameMap) {
      host?.updatePlayer(ctx.player);
      return current;
    }
  }
  return startSession(ctx, mapId || deriveMapId(ctx.scene));
}
