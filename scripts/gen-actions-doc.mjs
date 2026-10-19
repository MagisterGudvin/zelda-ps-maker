// Generates docs/ACTIONS.md from the built plugin bundle so the reference
// always matches what PS Maker actually sees. Usage: npm run docs:actions
import { writeFile } from "node:fs/promises";
const { default: plugin } = await import(new URL("../dist/zelda-maker-toolkit.ps-maker.js", import.meta.url));

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
let md = `# Справочник действий PS Maker / Action reference\n\n`;
md += `Сгенерировано из \`dist/zelda-maker-toolkit.ps-maker.js\` (${plugin.name} ${plugin.version}) скриптом \`scripts/gen-actions-doc.mjs\`. `;
md += `Не редактируйте вручную.\n\nВсего действий: **${plugin.events.length}**. Все имена начинаются с \`Zelda: \`.\n\n`;
md += `## Оглавление\n\n` + plugin.events.map((e) => `- [${e.name}](#${e.name.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-")})`).join("\n") + "\n\n";
for (const e of plugin.events) {
  md += `## ${e.name}\n\n${esc(e.description)}\n\n`;
  const params = Object.entries(e.parameterDefs);
  if (params.length === 0) {
    md += `_Без параметров._\n\n`;
    continue;
  }
  md += `| Параметр | Тип | По умолчанию | Описание |\n|---|---|---|---|\n`;
  for (const [key, p] of params) md += `| \`${key}\` (${esc(p.label ?? key)}) | ${p.type} | ${p.defaultValue === undefined ? "—" : `\`${esc(JSON.stringify(p.defaultValue))}\``} | ${esc(p.description)} |\n`;
  md += "\n";
}
await writeFile(new URL("../docs/ACTIONS.md", import.meta.url), md);
console.log(`docs/ACTIONS.md: ${plugin.events.length} actions`);
