/**
 * Zelda Param Probe — a tiny diagnostic plugin, separate from the toolkit.
 *
 * Purpose: find out which parameter `type` makes the PS Maker editor show the
 * native map picker ("Set position" / "Locate in map") for plugin actions, and
 * what value each parameter type delivers at runtime. @ps-maker/plugin-api 0.0.3
 * only documents `position`, which the editor renders as two number fields.
 *
 * Each action is one candidate. Open them in the editor, note which one shows
 * the picker, then run the map: the received params are printed on screen and
 * in the browser console. Remove this file from /plugins afterwards.
 */
import { definePlugin } from "@ps-maker/plugin-api";

type Ctx = { scene: any };

function show(name: string, params: unknown, ctx: Ctx): void {
  const text = `${name}: ${JSON.stringify(params, (_k, v) => (v && typeof v === "object" && typeof v.setVisible === "function" ? `[GameObject ${v.name ?? v.type}]` : v))}`;
  console.log("[ZeldaParamProbe]", text, params);
  const scene = ctx?.scene;
  if (!scene?.add?.text) return;
  const cam = scene.cameras?.main;
  const t = scene.add.text(4, 4 + (probeLine++ % 8) * 12, text, { fontFamily: "monospace", fontSize: "8px", color: "#ffff66", backgroundColor: "#000000cc", wordWrap: { width: (cam?.width ?? 320) - 8 } });
  t.setScrollFactor?.(0);
  t.setDepth?.(999999);
  scene.time?.delayedCall?.(10000, () => t.destroy());
}
let probeLine = 0;

/** Candidate parameter schemas. Untyped on purpose: most types are not in plugin-api 0.0.3. */
const CANDIDATES: [string, Record<string, unknown>][] = [
  ["position (baseline)", { type: "position" }],
  ["position + picker hints", { type: "position", picker: "map", mode: "map", widget: "map", map: true, input: "map" }],
  ["mapPosition", { type: "mapPosition" }],
  ["map_position", { type: "map_position" }],
  ["mapLocation", { type: "mapLocation" }],
  ["location", { type: "location" }],
  ["point", { type: "point" }],
  ["coordinates", { type: "coordinates" }],
  ["tile", { type: "tile" }],
  ["tilePosition", { type: "tilePosition" }],
  ["worldPosition", { type: "worldPosition" }],
  ["mapPoint", { type: "mapPoint" }],
  ["map", { type: "map" }],
  ["vector2", { type: "vector2" }],
];

const events = CANDIDATES.map(([label, schema]) => ({
  name: `Probe: ${label}`,
  description: `Parameter type candidate "${String(schema.type)}". Does the editor show "Set position"? Run the map to see the runtime value.`,
  parameterDefs: { value: { label: "Value", description: `type: ${String(schema.type)}`, ...schema } },
  execute: (params: unknown, ctx: Ctx) => show(label, params, ctx),
}));

events.push({
  name: "Probe: npc / image / audio values",
  description: "Prints what NPC, image and audio parameters deliver at runtime.",
  parameterDefs: {
    npc: { type: "npc", label: "NPC", description: "Pick any NPC." },
    image: { type: "image", label: "Image", description: "Pick any image." },
    audio: { type: "audio", label: "Audio", description: "Pick any sound." },
  } as any,
  execute: (params: unknown, ctx: Ctx) => show("npc/image/audio", params, ctx),
});

export default definePlugin({
  name: "Zelda Param Probe",
  description: "Diagnostic: which parameter type gives the map picker, and what values plugin parameters deliver.",
  version: "0.1.0",
  events: events as any,
});
