import type { Toolkit } from "../core/toolkit.ts";
import { translatedAction } from "./projectTranslations.ts";

/**
 * PS Maker's own actions as the toolkit changes them while they run, never in the project data.
 * Each map scene's story runner looks its built-in actions up through
 * `storyRunner.dependencies.getBuiltInAction(type)` (StoryRunner.ts, createStoryRunner.ts; the
 * name survives in the exported game); the toolkit hands it the same action definition with its
 * own `execute`:
 * - Dialogue, Choices, Show Image, Change Image run translated (Zelda: Translations);
 * - "Open game options menu" opens the project's settings screen (UI Designer, role Settings)
 *   instead of PS Maker's options menu, when there is one.
 */

type ActionDef = { execute?: (action: Record<string, unknown>, ctx: { endAction?: (r?: unknown) => void }) => void; [k: string]: unknown };
type Deps = { getBuiltInAction?: (type: string) => ActionDef | undefined; __zeldaHooks?: true };
const HOOKED = new Set(["dialogueAction", "choicesAction", "showImageAction", "changeImageAction", "openOptionsMenuAction"]);

function run(tk: Toolkit, execute: NonNullable<ActionDef["execute"]>, action: Record<string, unknown>, ctx: { endAction?: (r?: unknown) => void }): void {
  if (action?.type === "openOptionsMenuAction") {
    // As PS Maker's own (OpenOptionsMenu.ts), the action ends at once; the screen stays open.
    if (tk.session?.screens?.openSettings({ save: action.showSaveGameButton !== false, exit: action.showExitGameButton !== false })) {
      ctx.endAction?.({});
      return;
    }
  }
  execute(translatedAction(tk, action), ctx);
}

/** Hooks a map scene's story runner (once per scene). False when the scene has none. */
export function hookStoryRunner(scene: unknown, tk: Toolkit): boolean {
  const deps = (scene as { storyRunner?: { dependencies?: Deps } } | null)?.storyRunner?.dependencies;
  if (!deps || typeof deps.getBuiltInAction !== "function") return false;
  if (deps.__zeldaHooks) return true;
  const original = deps.getBuiltInAction;
  const wrapped = new WeakMap<ActionDef, ActionDef>();
  deps.getBuiltInAction = (type: string) => {
    const def = original(type);
    if (!def || !HOOKED.has(type) || typeof def.execute !== "function") return def;
    let w = wrapped.get(def);
    if (!w) {
      const execute = def.execute;
      w = { ...def, execute: (action, ctx) => run(tk, execute, action, ctx) };
      wrapped.set(def, w);
    }
    return w;
  };
  deps.__zeldaHooks = true;
  return true;
}

/** Every map scene PS Maker has made so far (a scene per visited map), and this one. */
export function hookRunningScenes(scene: unknown, tk: Toolkit): void {
  const game = (scene as { game?: { scene?: { getScenes?: (active: boolean) => unknown[] } } } | null)?.game;
  for (const sc of game?.scene?.getScenes?.(false) ?? []) hookStoryRunner(sc, tk);
  hookStoryRunner(scene, tk);
}
