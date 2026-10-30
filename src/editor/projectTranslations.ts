import type { Toolkit } from "../core/toolkit.ts";
import type { HostAdapter } from "../host/types.ts";
import { fontFamilyCss, type PsStory } from "../host/psmakerAssets.ts";
import { parseTable, translateDialogue, Translator, withDialogueLayout, type ImageRef } from "../core/translations.ts";

/**
 * The project's translations at run time. The table is the first "Zelda: Translations" in the
 * project's maps (PS Maker keeps the whole project in each map scene's `story`), so it works on
 * every map.
 *
 * PS Maker's own Dialogue, Choices, Show Image and Change Image are translated as they run, not in
 * the project data: each map scene's story runner looks its built-in actions up through
 * `storyRunner.dependencies.getBuiltInAction(type)` (StoryRunner.ts, createStoryRunner.ts; the
 * name survives in the exported game), and the toolkit hands it the same action definition whose
 * `execute` gets a translated copy of the action. The action in the project stays as written.
 */

export const TRANSLATIONS_ACTION = "Zelda: Translations";

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
export interface StoryLike {
  maps?: MapLike[];
  images?: ImageRef[];
}

export interface FoundTranslations {
  actionId: string;
  mapName: string;
  raw: string;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** The project's translation table: the first Zelda: Translations by map order. */
export function findTranslations(story: StoryLike | null | undefined): FoundTranslations | null {
  for (const map of story?.maps ?? []) {
    for (const list of [map.setupActions, map.initialActions, map.enterActions]) {
      for (const a of Array.isArray(list) ? list : []) {
        if (a?.actionName === TRANSLATIONS_ACTION) return { actionId: a.id ?? "", mapName: map.name || map.id || "", raw: text(a.pluginParams?.data) };
      }
    }
  }
  return null;
}

/** Reads the project's translations into the toolkit (none = texts as written). */
export function applyProjectTranslations(tk: Toolkit, story: StoryLike | null | undefined): void {
  const found = findTranslations(story);
  const { table, error } = parseTable(found?.raw ?? "");
  if (error) tk.logger.warnOnce(`translations-${found?.actionId}`, `Zelda: Translations on map "${found?.mapName}": ${error}; texts are shown as written.`);
  const current = tk.i18n.translator;
  // The same table: keep its translator (and its index).
  if (current && table && JSON.stringify(current.table) === JSON.stringify(table)) return;
  tk.i18n.useTranslations(table ? new Translator(table, Array.isArray(story?.images) ? story!.images : []) : null);
}

type ActionDef = { execute?: (action: Record<string, unknown>, ctx: unknown) => void; [k: string]: unknown };
type Deps = { getBuiltInAction?: (type: string) => ActionDef | undefined; __zeldaTranslations?: true };
const TRANSLATED = new Set(["dialogueAction", "choicesAction", "showImageAction", "changeImageAction"]);

/** A PS Maker action as it reads in the game's language (the same object when nothing changes). */
export function translatedAction(tk: Toolkit, action: Record<string, unknown>): Record<string, unknown> {
  const tr = tk.i18n.translator;
  const lang = tk.i18n.language;
  if (!tr || !action) return action;
  const L = tr.lang(lang);
  const own = lang !== tr.source;
  switch (action.type) {
    case "dialogueAction": {
      let source = text(action.dialogueSource);
      if (own) source = translateDialogue(source, (type, t) => tr.lookup(type, t, lang));
      if (L?.dialogueLayout) source = withDialogueLayout(source, L.dialogueLayout);
      return source === action.dialogueSource ? action : { ...action, dialogueSource: source };
    }
    case "choicesAction": {
      if (!own && !L?.choiceLayout) return action;
      const choices = Array.isArray(action.choices) ? (action.choices as Record<string, unknown>[]).map((c) => ({ ...c, text: tr.text(text(c?.text), lang) })) : action.choices;
      return { ...action, text: tr.text(text(action.text), lang), choices, ...(L?.choiceLayout ? { layoutId: L.choiceLayout } : {}) };
    }
    case "showImageAction":
    case "changeImageAction": {
      const id = tr.image(text(action.imageId), lang);
      return id === action.imageId ? action : { ...action, imageId: id };
    }
  }
  return action;
}

/**
 * Translates PS Maker's own actions on a map scene as they run (once per scene). False when the
 * scene has no story runner to hook (then its dialogues show as written).
 */
export function translateStoryRunner(scene: unknown, tk: Toolkit): boolean {
  const deps = (scene as { storyRunner?: { dependencies?: Deps } } | null)?.storyRunner?.dependencies;
  if (!deps || typeof deps.getBuiltInAction !== "function") return false;
  if (deps.__zeldaTranslations) return true;
  const original = deps.getBuiltInAction;
  const wrapped = new WeakMap<ActionDef, ActionDef>();
  deps.getBuiltInAction = (type: string) => {
    const def = original(type);
    if (!def || !TRANSLATED.has(type) || typeof def.execute !== "function") return def;
    let w = wrapped.get(def);
    if (!w) {
      const execute = def.execute;
      w = { ...def, execute: (action: Record<string, unknown>, ctx: unknown) => execute(translatedAction(tk, action), ctx) };
      wrapped.set(def, w);
    }
    return w;
  };
  deps.__zeldaTranslations = true;
  return true;
}

/** Every map scene running now (PS Maker keeps a scene per visited map). */
export function translateRunningScenes(scene: unknown, tk: Toolkit): void {
  const game = (scene as { game?: { scene?: { getScenes?: (active: boolean) => unknown[] } } } | null)?.game;
  for (const sc of game?.scene?.getScenes?.(false) ?? []) translateStoryRunner(sc, tk);
  translateStoryRunner(scene, tk);
}

/** The project fonts the languages use for the toolkit's texts: their CSS family, loaded. */
export function useLanguageFonts(tk: Toolkit, story: unknown, host: HostAdapter | undefined): void {
  for (const l of tk.i18n.translator?.table.languages ?? []) {
    if (!l.font) continue;
    tk.uiFonts[l.font] = fontFamilyCss(story as PsStory | null, l.font);
    host?.loadProjectFont?.(l.font);
  }
}
