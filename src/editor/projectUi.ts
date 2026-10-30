import type { Toolkit } from "../core/toolkit.ts";
import type { HostAdapter } from "../host/types.ts";
import { fontFamilyCss, type PsStory } from "../host/psmakerAssets.ts";
import { parseLayout, type ScreenRole, type UiLayout } from "../ui/uiLayout.ts";

/**
 * The UI shared by the whole project: the HUD (a "Zelda: UI Layout" with the role HUD, without
 * "This map only") and every screen, found in all maps of the project data (PS Maker keeps the
 * whole project in each map scene's `story`). A HUD made once is the HUD of every map that has no
 * HUD of its own; a screen made on one map opens on any map. Like every role, the first one in the
 * project's map order counts; the designer says when a layout is not the one used.
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
  /** Screens by key (the screen name, or "(role)" for a screen without one), first by map order. */
  screens: (SharedLayout & { name: string; role: ScreenRole })[];
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * What a UI Layout is: the HUD (the role HUD; a layout without a screen name and without a role,
 * as made before 0.27.0) or a screen. A screen's key is its name, or "(role)" when it has none.
 */
export function layoutKind(name: string, role: ScreenRole): { hud: boolean; key: string } {
  const hud = role === "hud" || (role === "none" && !name);
  return { hud, key: hud ? "" : name || `(${role})` };
}

/** A UI Layout action: its screen name, role, whether it is the HUD, its key, "This map only", its text. */
export function layoutAction(a: ActionLike): { screen: string; name: string; role: ScreenRole; hud: boolean; thisMapOnly: boolean; raw: string } {
  const p = a.pluginParams ?? {};
  const name = text(p.name).trim();
  const raw = text(p.layout);
  const role = parseLayout(raw).layout?.screen.role ?? "none";
  const { hud, key } = layoutKind(name, role);
  return { screen: key, name, role, hud, thisMapOnly: p.thisMapOnly === true, raw };
}

/** The UI Layout actions of a map that build it (its setup, start and enter lists). */
export function mapLayoutActions(map: MapLike): ActionLike[] {
  return [map.setupActions, map.initialActions, map.enterActions].flatMap((l) => (Array.isArray(l) ? l : [])).filter((a) => a?.actionName === UI_LAYOUT_ACTION);
}

export function projectUi(story: { maps?: MapLike[] } | null | undefined): ProjectUi {
  const out: ProjectUi = { hud: null, screens: [] };
  for (const map of story?.maps ?? []) {
    for (const a of mapLayoutActions(map)) {
      const { screen, role, hud, thisMapOnly, raw } = layoutAction(a);
      const found = { actionId: a.id ?? "", mapId: map.id ?? "", mapName: map.name || map.id || "", raw };
      if (!hud) {
        if (!out.screens.some((s) => s.name === screen)) out.screens.push({ ...found, name: screen, role });
      } else if (!thisMapOnly && !out.hud) out.hud = found;
    }
  }
  return out;
}

/**
 * The project fonts a layout's texts use: their CSS family for the HUD, and loaded by the toolkit
 * (PS Maker loads a project font only when it first shows its own text with it).
 */
export function useLayoutFonts(tk: Toolkit, story: unknown, host: HostAdapter | undefined, layout: UiLayout): void {
  for (const id of new Set([layout.theme.font, ...layout.elements.map((e) => (e.type === "text" || e.type === "button" ? e.font : ""))].filter(Boolean))) {
    tk.uiFonts[id] = fontFamilyCss(story as PsStory | null, id);
    host?.loadProjectFont?.(id);
  }
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
    // Unreadable: the classic HUD (its magic meter once the player has magic).
    tk.hudLayout = layout;
    if (layout) useLayoutFonts(tk, story, tk.session?.host, layout);
  }
  for (const s of ui.screens) {
    const { layout, error } = parseLayout(s.raw);
    if (error) tk.logger.warnOnce(`shared-screen-${s.actionId}`, `UI screen "${s.name}" on map "${s.mapName}": ${error}.`);
    if (!layout) continue;
    tk.uiScreens.set(s.name, layout);
    useLayoutFonts(tk, story, tk.session?.host, layout);
  }
}

/**
 * The layout the game uses for a role (or a screen name), when it is not this action: the first one
 * by map order counts, as for every role. Null when this action is the one used.
 */
export function usedInstead(story: { maps?: MapLike[] } | null | undefined, actionId: string): { mapName: string; what: string } | null {
  const all: (ReturnType<typeof layoutAction> & { id: string; mapName: string })[] = [];
  for (const map of story?.maps ?? []) for (const a of mapLayoutActions(map)) all.push({ ...layoutAction(a), id: a.id ?? "", mapName: map.name || map.id || "" });
  const me = all.find((x) => x.id === actionId);
  if (!me || (me.hud && me.thisMapOnly)) return null;
  // Roles opened by their role (pause menu, message box...) are one per project; plain and title screens one per name.
  const byRole = !me.hud && me.role !== "none" && me.role !== "title";
  const first = all.find((x) => (me.hud ? x.hud && !x.thisMapOnly : byRole ? !x.hud && x.role === me.role : !x.hud && x.screen === me.screen));
  if (!first || first.id === me.id) return null;
  return { mapName: first.mapName, what: me.hud ? "HUD" : byRole ? ROLE_WORDS[me.role] : `screen "${me.screen}"` };
}

const ROLE_WORDS: Record<string, string> = { menu: "pause menu", message: "message box", dialogue: "dialogue box", notification: "notification screen", inventory: "inventory screen" };
