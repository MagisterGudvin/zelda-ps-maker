import type { ToolkitConfig } from "../core/config.ts";
import { fontFamilyCss, type PsStory } from "../host/psmakerAssets.ts";
import { resolveImage } from "./paramResolvers.ts";
import type { HudPart } from "../ui/hudLayout.ts";

/** Slots of Zelda: HUD Style, in form order (config.ui.skin). */
export const HUD_SKIN_SLOTS = ["heartFull", "heartHalf", "heartEmpty", "rupees", "bombs", "arrows", "keys", "digits", "itemBox", "magicFrame", "magicFill", "bar"] as const;
export const HUD_PART_OPTIONS = [["hearts", "Hearts"], ["counters", "Counters (rupees, bombs, arrows, keys)"], ["item", "Item box"], ["magic", "Magic meter"]] as const;
export const DEFAULT_COUNTERS = ["rupees", "bombs", "arrows", "keys"];

/** HUD Style fields that place a part: X and Y in HUD pixels (map pixels at the map's scale), -1 = classic place. */
export const HUD_PLACE_FIELDS: Record<HudPart, [string, string]> = {
  hearts: ["heartsX", "heartsY"],
  counters: ["countersX", "countersY"],
  item: ["itemX", "itemY"],
  magic: ["magicX", "magicY"],
};

/** Form labels of the position fields (Zelda: HUD Style): "<part> X" / "<part> Y". */
export const HUD_PART_LABELS: Record<HudPart, string> = { hearts: "Hearts", counters: "Counters", item: "Item box", magic: "Magic meter" };

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Zelda: HUD Style fields as UI settings. Used by the action in the game and by the editor's HUD
 * preview, so both draw the same HUD.
 */
export function hudStyleConfig(p: Record<string, unknown>, story: PsStory | null): Partial<ToolkitConfig["ui"]> {
  const skin: Record<string, string> = {};
  for (const slot of HUD_SKIN_SLOTS) skin[slot] = resolveImage(p[slot]);
  // An action saved before 0.18 has no parts: everything stays on.
  const parts = new Set(Array.isArray(p.parts) ? (p.parts as string[]) : HUD_PART_OPTIONS.map(([v]) => v));
  const places: Record<string, { x: number; y: number }> = {};
  for (const [part, [fx, fy]] of Object.entries(HUD_PLACE_FIELDS)) places[part] = { x: Math.round(num(p[fx], -1)), y: Math.round(num(p[fy], -1)) };
  const font = text(p.font);
  return {
    showHearts: parts.has("hearts"),
    counters: parts.has("counters") ? DEFAULT_COUNTERS : [],
    showActiveItem: parts.has("item"),
    showMagic: parts.has("magic"),
    skin,
    places,
    barSlice: Math.max(0, Math.round(num(p.barSlice, 4))),
    showLifeLabel: p.lifeLabel === undefined ? true : p.lifeLabel === true || p.lifeLabel === "true",
    textColor: text(p.textColor) || "#f8e0a0",
    scale: Math.max(0, Math.round(num(p.scale, 0))),
    fontFamily: font ? fontFamilyCss(story, font) : "monospace",
  };
}
