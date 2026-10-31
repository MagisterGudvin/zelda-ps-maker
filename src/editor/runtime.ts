import { Toolkit } from "../core/toolkit.ts";
import type { Session } from "../core/session.ts";
import { mapSceneOf, PhaserHost, type PluginContextLike } from "../host/phaserHost.ts";
import { installPublicApi } from "./publicApi.ts";
import { capturePageErrors } from "./pageErrors.ts";
import { applyProjectUi } from "./projectUi.ts";
import { applyProjectTranslations, useLanguageFonts } from "./projectTranslations.ts";
import { hookRunningScenes } from "./storyHooks.ts";

/**
 * Process-wide toolkit instance and its binding to PS Maker scenes. PS Maker
 * has no plugin lifecycle hooks, so the toolkit binds itself the first time an
 * action runs on a map scene and unbinds on the scene's shutdown/destroy.
 */
let instance: Toolkit | null = null;

export function getToolkit(): Toolkit {
  if (!instance) {
    instance = new Toolkit();
    capturePageErrors(instance.logger);
    if (instance.config.publicApi) installPublicApi(instance);
  }
  return instance;
}

/** For tests: forget the singleton. */
export function resetToolkitForTests(): void {
  instance?.stop("test reset");
  instance = null;
}

/** The map id when the author did not set one: the PS Maker map of the scene (GameMap.map.id). */
export function deriveMapId(scene: any): string {
  const id = scene?.map?.id;
  return typeof id === "string" && id ? id : "map";
}

function hostOf(session: Session): PhaserHost | null {
  return session.host instanceof PhaserHost ? session.host : null;
}

/**
 * Why the current session can NOT be reused for this context, or null when it
 * can. The same player sprite means the same running map even if PS Maker
 * hands over a different `ctx.scene`, so a repeated Start Toolkit (or an
 * On-load list that runs twice) does not wipe enemies created in between.
 */
export function sessionMismatch(session: Session | null, ctx: PluginContextLike, mapId?: string): string | null {
  if (!session || session.isDisposed) return "not running";
  if (mapId && mapId !== session.mapId) return `map id changed ("${session.mapId}" -> "${mapId}")`;
  const host = hostOf(session);
  if (!host) return null;
  if (host.scene === mapSceneOf(ctx)) return null;
  if (ctx.player && ctx.player === host.player) return null;
  const key = (sc: any) => sc?.sys?.settings?.key ?? "?";
  return `scene changed ("${key(host.scene)}" -> "${key(mapSceneOf(ctx))}")`;
}

/** Starts (or restarts) the toolkit on the context's scene. */
export function startSession(ctx: PluginContextLike, mapId: string, reason?: string): Session {
  const tk = getToolkit();
  if (reason && tk.session) tk.logger.info(`Restarting: ${reason}.`);
  const host = new PhaserHost(ctx, tk.config, tk.logger);
  const session = tk.start(host, mapId);
  // The project's shared HUD and its screens, from the project data every map scene carries.
  applyProjectUi(tk, host.psMakerStory() as Parameters<typeof applyProjectUi>[1]);
  // Its translations, also of PS Maker's own dialogues on every map scene; its settings screen in
  // place of PS Maker's options menu (and its gear).
  applyProjectTranslations(tk, host.psMakerStory() as Parameters<typeof applyProjectTranslations>[1]);
  hookRunningScenes(host.scene, tk);
  host.hideOptionsButton([...tk.uiScreens.values()].some((l) => l.screen.role === "settings"));
  useLanguageFonts(tk, host.psMakerStory(), host);
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
  const reason = sessionMismatch(current, ctx, mapId);
  if (current && !reason) {
    hostOf(current)?.updatePlayer(ctx.player);
    return current;
  }
  return startSession(ctx, mapId || deriveMapId(ctx.scene), reason ?? undefined);
}
