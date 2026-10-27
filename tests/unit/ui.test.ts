import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_UI } from "../../src/editor/ui.ts";

type Def = { type: string; group?: string; ui?: string; min?: number; max?: number; defaultValue?: unknown; options?: { value: string; label: string }[] };
type Action = {
  name: string;
  parameterDefs: Record<string, Def>;
  meta?: { category?: string; keywords?: string[] };
  parameterVisibility?: Record<string, (p: Record<string, unknown>) => boolean>;
  collapsedGroups?: string[];
  getPreview?: (p: Record<string, unknown>, ctx?: { resolveParam?: (k: string) => string | undefined }) => { text: string } | undefined;
};

async function actions(): Promise<Action[]> {
  const { default: plugin } = await import("../../src/index.ts");
  return plugin.actions as unknown as Action[];
}

/** Values as the PS Maker editor passes them to parameterVisibility: saved value ?? defaultValue. */
const withDefaults = (a: Action, saved: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(a.parameterDefs).map(([k, d]) => [k, saved[k] ?? d.defaultValue]));
const visibleFields = (a: Action, saved: Record<string, unknown> = {}) => {
  const p = withDefaults(a, saved);
  return Object.keys(a.parameterDefs).filter((k) => !a.parameterVisibility?.[k] || a.parameterVisibility[k](p));
};
const byName = (list: Action[], name: string) => list.find((a) => a.name === `Zelda: ${name}`)!;

test("every action has a presentation entry with search keywords", async () => {
  for (const a of await actions()) {
    assert.ok(ACTION_UI[a.name], `${a.name} has no ACTION_UI entry`);
    assert.ok((a.meta?.keywords?.length ?? 0) >= 2, `${a.name} needs search keywords`);
    assert.equal(a.meta?.category, "Zelda Maker Toolkit");
  }
});

test("search keywords survive the editor's search normalisation", async () => {
  // PS Maker 1.2.1 lowercases the query and every keyword, then turns each run of characters
  // outside a-z and 0-9 into a space, so a Cyrillic keyword (or query) becomes empty.
  const searchable = (w: string) => w.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === w.toLowerCase().trim();
  for (const a of await actions()) for (const w of a.meta?.keywords ?? []) assert.ok(searchable(w), `${a.name}: keyword "${w}" is erased by the editor search`);
});

test("presentation refers only to existing fields; radio only on lists; sane limits; groups after main fields", async () => {
  for (const a of await actions()) {
    const ui = ACTION_UI[a.name];
    for (const k of [...Object.keys(ui.fields ?? {}), ...Object.keys(ui.visible ?? {})]) assert.ok(k in a.parameterDefs, `${a.name}: unknown field "${k}"`);
    const groups = new Set(Object.values(a.parameterDefs).map((d) => d.group).filter(Boolean));
    for (const g of a.collapsedGroups ?? []) assert.ok(groups.has(g), `${a.name}: collapsed group "${g}" has no fields`);
    let seenGroup = false;
    for (const [k, d] of Object.entries(a.parameterDefs)) {
      if (d.ui === "radio") assert.equal(d.type, "string-enum", `${a.name}.${k}: radio on a ${d.type}`);
      if (d.min !== undefined && d.max !== undefined) assert.ok(d.min <= d.max, `${a.name}.${k}: min > max`);
      if (typeof d.defaultValue === "number" && d.min !== undefined) assert.ok(d.defaultValue >= d.min, `${a.name}.${k}: default below min`);
      if (d.group) seenGroup = true;
      else assert.ok(!seenGroup, `${a.name}.${k}: main field after a group`);
    }
    assert.ok(visibleFields(a).length > 0 || Object.keys(a.parameterDefs).length === 0, `${a.name}: nothing visible by default`);
  }
});

test("previews never throw and use the editor's own formatting", async () => {
  for (const a of await actions()) {
    if (!a.getPreview) continue;
    a.getPreview({});
    a.getPreview(withDefaults(a));
    a.getPreview(withDefaults(a), { resolveParam: (k) => `<${k}>` });
  }
  const list = await actions();
  const enemy = byName(list, "Create Enemy");
  assert.equal(enemy.getPreview!({ template: "ogre", group: "2", position: { x: 10, y: 20 } }, { resolveParam: (k) => ({ template: "Ogre", group: "Group 2", position: "x: 10, y: 20" })[k] })?.text, "Ogre, Group 2, x: 10, y: 20");
  assert.equal(enemy.getPreview!({ template: "slime" })?.text, "slime, next to the player");
  const rule = byName(list, "Add Rule");
  assert.equal(rule.getPreview!({ whenGroup: "1", openDoorAt: { x: 1, y: 2 }, giveItem: "rupees", giveCount: 20 }, { resolveParam: (k) => ({ whenGroup: "Group 1", giveItem: "Rupees" })[k] })?.text, "Group 1 defeated → open door, give 20 Rupees");
  assert.equal(byName(list, "Give Item").getPreview!({ item: "bow", count: 5 })?.text, "bow", "no count for items that are not counted");
});

test("fields that do not apply are hidden", async () => {
  const list = await actions();
  const obj = byName(list, "Create Object");
  assert.ok(visibleFields(obj, { type: "pressure_plate" }).includes("staysOn"));
  assert.ok(!visibleFields(obj, { type: "bush" }).includes("staysOn"));
  assert.ok(visibleFields(obj, { type: "sign" }).includes("text"));
  assert.ok(!visibleFields(obj, { type: "pit" }).includes("openDoorAt"));
  assert.ok(visibleFields(obj, { type: "reactive" }).includes("reactsTo"));
  const give = byName(list, "Give Item");
  assert.ok(visibleFields(give, { item: "rupees" }).includes("count"));
  assert.ok(!visibleFields(give, { item: "bow" }).includes("count"));
  const rule = byName(list, "Add Rule");
  assert.ok(!visibleFields(rule).includes("spawnAt"));
  assert.ok(visibleFields(rule, { spawnEnemy: "ogre" }).includes("spawnAt"));
  assert.ok(!visibleFields(rule).includes("whenObjectAt2"));
  assert.ok(visibleFields(rule, { whenObjectAt: { x: 1, y: 1 } }).includes("whenObjectAt2"));
  const dmg = byName(list, "Damage Target");
  assert.deepEqual(visibleFields(dmg, { player: true }).filter((k) => k === "group" || k === "objectAt"), []);
  const item = byName(list, "Define Item");
  assert.ok(!visibleFields(item, { heal: 4 }).includes("damageType"));
  assert.ok(!visibleFields(item, { resource: "" }).includes("cost"));
  const start = byName(list, "Start Toolkit");
  assert.ok(!visibleFields(start, { hud: false }).includes("magicBar"));
});
