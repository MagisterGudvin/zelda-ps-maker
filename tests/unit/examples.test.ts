import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRig } from "../helpers/fakeHost.ts";
import { createDataItem, type DataItemSpec } from "../../src/items/builtinItems.ts";
import { spawnEnemy } from "../../src/enemies/spawn.ts";
import { MAPS } from "../../examples/harness/demo-maps.js";

const content = JSON.parse(readFileSync(new URL("../../examples/configs/custom-content.json", import.meta.url), "utf8"));
const defaults = JSON.parse(readFileSync(new URL("../../examples/configs/default-config.json", import.meta.url), "utf8"));

test("example custom content is valid for the toolkit", () => {
  const rig = createRig();
  for (const spec of content.items as DataItemSpec[]) rig.tk.items.register(createDataItem(spec));
  for (const [name, t] of Object.entries(content.enemies)) rig.tk.enemyTemplates.define(name, t as never);
  for (const name of Object.keys(content.enemies)) assert.ok(spawnEnemy(rig.session, name, 10, 10), name);
  const reg = rig.tk.ruleRegistry;
  const walk = (o: unknown, kind: "cond" | "act"): void => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      assert.ok(kind === "cond" ? reg.condition(k) : reg.action(k), `${kind} ${k}`);
      if (kind === "cond" && (k === "all" || k === "any")) for (const c of v as unknown[]) walk(c, "cond");
      if (kind === "cond" && k === "not") walk(v, "cond");
    }
  };
  for (const r of content.rules) {
    walk(r.when, "cond");
    for (const a of [...r.then, ...(r.else ?? [])]) walk(a, "act");
    rig.session.rules!.addRule(r);
  }
  rig.session.dungeons!.addWaveRoom(content.waveRoom);
  for (const [name, cfg] of Object.entries(content.configs)) assert.deepEqual(rig.tk.configure(cfg, name), [], name);
  assert.deepEqual(rig.tk.configure(defaults, "defaults"), []);
});

test("demo maps only use existing actions with known parameters", async () => {
  const { default: plugin } = await import("../../src/index.ts");
  const byName = new Map(plugin.events.map((e: { name: string; parameterDefs: object }) => [e.name, e]));
  for (const map of Object.values(MAPS) as unknown as { onLoad: [string, Record<string, unknown>][]; triggers: { events?: [string, Record<string, unknown>][] }[] }[]) {
    const all = [...map.onLoad, ...map.triggers.flatMap((t) => t.events ?? [])];
    for (const [name, params] of all) {
      const ev = byName.get(name) as { parameterDefs: Record<string, unknown> } | undefined;
      assert.ok(ev, `unknown action ${name}`);
      for (const key of Object.keys(params)) assert.ok(key in ev.parameterDefs, `${name}: unknown parameter ${key}`);
    }
  }
});

test("version literals agree (CLI reads src/index.ts, runtime uses TOOLKIT_VERSION)", async () => {
  const { TOOLKIT_VERSION } = await import("../../src/core/version.ts");
  const { default: plugin } = await import("../../src/index.ts");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(plugin.version, TOOLKIT_VERSION);
  assert.equal(pkg.version, TOOLKIT_VERSION);
});
