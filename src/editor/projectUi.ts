import type { Toolkit } from "../core/toolkit.ts";
import { parseLayout } from "../ui/uiLayout.ts";

/**
 * The UI shared by the whole project: the HUD of a "Zelda: UI Layout" without a screen name and
 * without "This map only", and every screen, found in all maps of the project data (PS Maker
 * keeps the whole project in each map scene's `story`). A HUD made once is the HUD of every map
 * that has no HUD of its own; a screen made on one map opens on any map. The first one in the
 * project's map order counts; a later shared HUD is a mistake the designer points out.
 */

export const UI_LAYOUT_ACTION = "Zelda: UI Layout";

interface ActionLike {
  id?: string;
  actionName?: string;
  pluginParams?: Record<string, unknown>;
}
interface MapLike {
  id?: string;
  name?: string;
  setupActions?: ActionLike[];
  initialActions?: ActionLike[];
  enterActions?: ActionLike[];
}

export interface SharedLayout {
  actionId: string;
  mapId: string;
  mapName: string;
  raw: string;
}

export interface ProjectUi {
  hud: SharedLayout | null;
  screens: (SharedLayout & { name: string })[];
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** A UI Layout action's screen name ("" = a HUD) and whether it is for its own map only. */
export function layoutAction(a: ActionLike): { screen: string; thisMapOnly: boolean; raw: string } {
  const p = a.pluginParams ?? {};
  return { screen: text(p.name).trim(), thisMapOnly: p.thisMapOnly === true, raw: text(p.layout) };
}

/** The UI Layout actions of a map that build it (its setup, start and enter lists). */
export function mapLayoutActions(map: MapLike): ActionLike[] {
  return [map.setupActions, map.initialActions, map.enterActions].flatMap((l) => (Array.isArray(l) ? l : [])).filter((a) => a?.actionName === UI_LAYOUT_ACTION);
}

export function projectUi(story: { maps?: MapLike[] } | null | undefined): ProjectUi {
  const out: ProjectUi = { hud: null, screens: [] };
  for (const map of story?.maps ?? []) {
    for (const a of mapLayoutActions(map)) {
      const { screen, thisMapOnly, raw } = layoutAction(a);
      const found = { actionId: a.id ?? "", mapId: map.id ?? "", mapName: map.name || map.id || "", raw };
      if (screen) {
        if (!out.screens.some((s) => s.name === screen)) out.screens.push({ ...found, name: screen });
      } else if (!thisMapOnly && !out.hud) out.hud = found;
    }
  }
  return out;
}

/**
 * At the start of a map: the shared HUD becomes the HUD (the map's own UI Layout, which runs after
 * Start Toolkit, may still replace it) and every screen of the project can be opened.
 */
export function applyProjectUi(tk: Toolkit, story: { maps?: MapLike[] } | null | undefined): void {
  const ui = projectUi(story);
  tk.sharedHud = ui.hud;
  if (ui.hud) {
    const { layout, error } = parseLayout(ui.hud.raw);
    if (error) tk.logger.warnOnce(`shared-hud-${ui.hud.actionId}`, `The shared UI Layout on map "${ui.hud.mapName}": ${error}; the classic HUD is shown.`);
    // Unreadable: the classic HUD (built to the player's magic and the HUD position).
    tk.hudLayout = layout;
  }
  for (const s of ui.screens) {
    const { layout, error } = parseLayout(s.raw);
    if (error) tk.logger.warnOnce(`shared-screen-${s.actionId}`, `UI screen "${s.name}" on map "${s.mapName}": ${error}.`);
    if (layout) tk.uiScreens.set(s.name, layout);
  }
}
