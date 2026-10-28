#!/usr/bin/env node
/**
 * Creates the Zelda Maker Toolkit demo as a new PS Maker project next to an existing one.
 *
 *   node scripts/make-demo-project.mjs --from "Istina" [--name "Zelda Toolkit Demo"]
 *
 * --from: a project folder (path), or a project name in the PS Maker projects folder. The project
 *         must contain the built-in "Tiles 'N Such Assets" pack. It is only read.
 * --name: folder name of the new project (default "Zelda Toolkit Demo"); it must not exist yet.
 *
 * The new project gets story.json, copies of the asset files it uses and plugins/ with the
 * Toolkit build (run `npm run build` first). Nothing is overwritten or deleted.
 */
import { existsSync } from "node:fs";
import { writeUiAssets } from "./ui-assets.mjs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MAPS } from "../examples/harness/demo-maps.js";
import { assetKeysOf, buildDemoStory } from "./demo-project.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_FILE = "zelda-maker-toolkit.ps-maker.js";

/** Where PS Maker keeps projects (electron/main.cjs: getProjectsDataDir). */
export function defaultProjectsRoot() {
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "PS Maker", "projects");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "PS Maker", "projects");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "PS Maker", "projects");
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

async function listProjects(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && existsSync(path.join(root, e.name, "story.json"))).map((e) => e.name);
}

async function main() {
  const opts = args(process.argv.slice(2));
  const root = opts.root ? path.resolve(opts.root) : defaultProjectsRoot();
  if (opts.help || !opts.from) {
    console.log(`Usage: node scripts/make-demo-project.mjs --from <project> [--name "Zelda Toolkit Demo"] [--root <projects folder>]`);
    const projects = await listProjects(root);
    console.log(projects.length ? `Projects in ${root}:\n  ${projects.join("\n  ")}` : `No projects found in ${root}.`);
    process.exitCode = opts.help ? 0 : 1;
    return;
  }
  const from = existsSync(path.join(path.resolve(opts.from), "story.json")) ? path.resolve(opts.from) : path.join(root, opts.from);
  if (!existsSync(path.join(from, "story.json"))) throw new Error(`No story.json in ${from}.`);
  const name = opts.name || "Zelda Toolkit Demo";
  if (/[\\/]/.test(name) || name.startsWith(".")) throw new Error(`"${name}" is not a folder name.`);
  const dest = path.join(path.dirname(from), name);
  if (existsSync(dest)) throw new Error(`${dest} already exists. Choose another --name; nothing was changed.`);
  const pluginPath = path.join(ROOT, "dist", PLUGIN_FILE);
  if (!existsSync(pluginPath)) throw new Error(`${pluginPath} not found: run "npm run build" first.`);

  const source = JSON.parse(await readFile(path.join(from, "story.json"), "utf8"));
  const { default: plugin } = await import(pathToFileURL(pluginPath).href);
  const { story, warnings } = buildDemoStory({ source, plugin, maps: MAPS, name });

  const assetsFrom = path.join(from, "assets");
  const available = new Set(await readdir(assetsFrom).catch(() => []));
  const files = assetKeysOf(story).filter((f) => available.has(f));

  await mkdir(path.join(dest, "assets"), { recursive: true });
  await mkdir(path.join(dest, "plugins"), { recursive: true });
  for (const f of files) await copyFile(path.join(assetsFrom, f), path.join(dest, "assets", f));
  // The demo's own UI pictures (drawn by scripts/ui-assets.mjs), referenced by story.images.
  const ui = writeUiAssets(path.join(dest, "assets"));
  await copyFile(pluginPath, path.join(dest, "plugins", PLUGIN_FILE));
  await writeFile(path.join(dest, "story.json"), JSON.stringify(story), "utf8");

  for (const w of warnings) console.warn(`Note: ${w}`);
  console.log(`Created ${dest}\n  maps: ${story.maps.map((m) => m.name).join(", ")}; ${files.length} asset files copied, ${ui.length} UI pictures written; plugin ${plugin.version ?? ""} in plugins/.`);
  console.log(`Open PS Maker: the project "${name}" is in the project list.`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exitCode = 1;
});
