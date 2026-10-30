import type { Toolkit } from "./toolkit.ts";
import { storage } from "./playerControls.ts";

/**
 * The language the player picked in the game (a language button on a UI screen): kept in the
 * browser for this project, like the player's controls, and above the project's language (Start
 * Toolkit → Language) until the player picks again.
 */

const key = (tk: Toolkit) => `zelda-maker-toolkit:language:${tk.projectKey || "game"}`;

export function loadPlayerLanguage(tk: Toolkit): void {
  try {
    tk.playerLanguage = storage()?.getItem(key(tk)) || null;
  } catch {
    tk.playerLanguage = null;
  }
}

/** Sets the game's language; `code` "" = the next language of the project. Returns the language set. */
export function setPlayerLanguage(tk: Toolkit, code: string): string {
  const codes = tk.i18n.languages;
  const next = code || codes[(codes.indexOf(tk.i18n.language) + 1) % codes.length] || tk.i18n.language;
  tk.playerLanguage = next;
  try {
    storage()?.setItem(key(tk), next);
  } catch {
    // Storage off (private mode): the choice lasts this session only.
  }
  tk.configure({}, "language");
  tk.bus.emit("zelda:language:changed", { language: tk.i18n.language });
  return tk.i18n.language;
}
