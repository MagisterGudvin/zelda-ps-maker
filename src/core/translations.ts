/**
 * Translations without touching the project's texts: the texts stay as written in the editor (the
 * source language), and a table — one row per text, one column per language — gives what each text
 * reads in the other languages. The table lives in the project (a "Zelda: Translations" action,
 * written by its sheet editor), and goes to and from a CSV file for spreadsheets (Excel, Google
 * Sheets, LibreOffice).
 *
 * A row is found by what the text says in the source language, so nothing is added to the texts in
 * the editor and a text used in several places is translated once. A text changed in the editor is a
 * new row; the old row stays (marked unused on the next extraction) so its translation is not lost.
 *
 * Row types:
 * - `text` — a dialogue page, a choice, a message, a sign, an item name, a text in a UI layout…
 * - `name` — a speaker name ("Name: text" lines, `@name "…"`, Zelda: Dialogue's Speaker).
 * - `image` — an image (by its name in the project's Images): which image to show instead.
 * - `toolkit` — a string of the toolkit itself (its `where` is the key, e.g. `hud.life`).
 */

export type RowType = "text" | "name" | "image" | "toolkit";
export const ROW_TYPES: readonly RowType[] = ["text", "name", "image", "toolkit"];

export interface TranslationLanguage {
  /** Language code: en, ru, ja, zh-CN… (the first language is the one the project is written in). */
  code: string;
  /** What the player sees in a language menu ({language} in UI layouts). */
  name: string;
  /** PS Maker dialogue layout (id) for this language — its font and size; "" = as written. */
  dialogueLayout: string;
  /** PS Maker choice layout (id) for this language; "" = as written. */
  choiceLayout: string;
  /** Project font (id) the toolkit's own texts use in this language; "" = the layout's. */
  font: string;
}

export interface TranslationRow {
  type: RowType;
  /** The text as written (source language); for `toolkit` rows, the toolkit key. */
  source: string;
  /** Where it was found first (map › event), for translators. */
  where: string;
  /** Language code → translation; empty or missing = not translated (the source is shown). */
  tr: Record<string, string>;
  /** Not found in the project at the last extraction (kept so its translation is not lost). */
  unused?: boolean;
}

export interface TranslationTable {
  v: 1;
  languages: TranslationLanguage[];
  rows: TranslationRow[];
}

export const TABLE_VERSION = 1;

export function language(code: string, name = code): TranslationLanguage {
  return { code, name, dialogueLayout: "", choiceLayout: "", font: "" };
}

export function emptyTable(source = "en"): TranslationTable {
  return { v: TABLE_VERSION, languages: [language(source)], rows: [] };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Reads the table kept in the project (the action's data field); unreadable or empty = null. */
export function parseTable(raw: string): { table: TranslationTable | null; error: string } {
  if (!raw.trim()) return { table: null, error: "" };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { table: null, error: "the translation data is not readable" };
  }
  const d = data as { languages?: unknown; rows?: unknown };
  if (!d || typeof d !== "object" || !Array.isArray(d.languages)) return { table: null, error: "the translation data has no languages" };
  const languages: TranslationLanguage[] = [];
  for (const l of d.languages as Record<string, unknown>[]) {
    const code = str(l?.code).trim();
    if (!code || languages.some((x) => x.code === code)) continue;
    languages.push({ code, name: str(l.name) || code, dialogueLayout: str(l.dialogueLayout), choiceLayout: str(l.choiceLayout), font: str(l.font) });
  }
  if (!languages.length) return { table: null, error: "the translation data has no languages" };
  const rows: TranslationRow[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(d.rows) ? (d.rows as Record<string, unknown>[]) : []) {
    const type = ROW_TYPES.includes(r?.type as RowType) ? (r.type as RowType) : null;
    const source = str(r?.source);
    if (!type || !source || seen.has(rowKey(type, source))) continue;
    seen.add(rowKey(type, source));
    const tr: Record<string, string> = {};
    for (const [k, v] of Object.entries((r.tr as Record<string, unknown>) ?? {})) if (typeof v === "string" && v) tr[k] = v;
    rows.push({ type, source, where: str(r.where), tr, ...(r.unused === true ? { unused: true } : {}) });
  }
  return { table: { v: TABLE_VERSION, languages, rows }, error: "" };
}

export function serializeTable(t: TranslationTable): string {
  return JSON.stringify(t);
}

export const rowKey = (type: RowType, source: string) => `${type}\u0000${source}`;

// ---- looking texts up ---------------------------------------------------------------------------

/** Images of the project, for image rows (rows name images; actions and layouts use their ids). */
export interface ImageRef {
  id: string;
  name: string;
}

/** Looks translations up; built once per table (and when it changes). */
export class Translator {
  readonly table: TranslationTable;
  private readonly index = new Map<string, TranslationRow>();
  private readonly imageById = new Map<string, string>();
  private readonly imageByName = new Map<string, string>();

  constructor(table: TranslationTable, images: readonly ImageRef[] = []) {
    this.table = table;
    for (const r of table.rows) this.index.set(rowKey(r.type, r.source), r);
    for (const i of images) {
      if (!i.id || !i.name) continue;
      this.imageById.set(i.id, i.name);
      if (!this.imageByName.has(i.name)) this.imageByName.set(i.name, i.id);
    }
  }

  get codes(): string[] {
    return this.table.languages.map((l) => l.code);
  }

  /** The language the project is written in. */
  get source(): string {
    return this.table.languages[0].code;
  }

  lang(code: string): TranslationLanguage | undefined {
    return this.table.languages.find((l) => l.code === code);
  }

  /** The translation of a text (or a name), or null when there is none in this language. */
  lookup(type: RowType, source: string, lang: string): string | null {
    if (!source) return null;
    const row = this.index.get(rowKey(type, source));
    const t = row?.tr[lang];
    return t ? t : null;
  }

  /** What a text reads in a language: its translation, else the text itself. */
  text(source: string, lang: string, type: RowType = "text"): string {
    if (lang === this.source && type !== "toolkit") return source;
    return this.lookup(type, source, lang) ?? source;
  }

  /** The image (id) to show in a language instead of an image (id). */
  image(id: string, lang: string): string {
    if (lang === this.source) return id;
    const name = this.imageById.get(id);
    const other = name ? this.lookup("image", name, lang) : null;
    return (other && this.imageByName.get(other)) || id;
  }
}

// ---- PS Maker dialogue sources ------------------------------------------------------------------

/**
 * A piece of a PS Maker dialogue source a translator sees: a page's text (consecutive text lines,
 * the speaker's "Name: " left out) or a speaker name. Grammar as PS Maker 1.2.1 reads it
 * (dialogueSourceParser.ts): a line starting with `@` is a command, `\` at the start makes the line
 * plain text, "Name: text" (": " after at least one character) names the speaker, one blank line or
 * more starts a new page, `<!-- -->` is a comment (removed, see withoutComments), `{@run_action id}` alone on a line runs an action.
 */
interface DialogueUnit {
  /** Lines [first, last] of the source (comments removed) the unit covers. */
  first: number;
  last: number;
  name: string;
  text: string;
  /** The first line started with `\` (escaped "Name: " or command): it stays plain text. */
  escaped: boolean;
}

const RUN_ACTION_LINE = /^\{@run_action\s+\S+\}$/i;
const NAME_COMMAND = /^@name[ \t]+"((?:\\.|[^"\\])*)"\s*$/i;

/**
 * The source without its comments, as PS Maker removes them (dialogueMarkup.ts): `<!--` not
 * escaped by an odd number of backslashes opens one, `-->` closes it (an open one runs to the end),
 * and a line that held only comment is dropped, so comments never add lines or pages.
 */
function withoutComments(source: string): string {
  const ranges: [number, number][] = [];
  let open = -1;
  for (let i = 0; i < source.length; i++) {
    if (open < 0) {
      if (!source.startsWith("<!--", i)) continue;
      let slashes = 0;
      for (let j = i - 1; j >= 0 && source[j] === "\\"; j--) slashes++;
      if (slashes % 2 === 0) {
        open = i;
        i += 3;
      }
    } else if (source.startsWith("-->", i)) {
      ranges.push([open, i + 3]);
      open = -1;
      i += 2;
    }
  }
  if (open >= 0) ranges.push([open, source.length]);
  if (!ranges.length) return source;
  const kept: string[] = [];
  let start = 0;
  for (const line of source.split("\n")) {
    const end = start + line.length;
    let text = "";
    let cursor = start;
    let had = false;
    for (const [a, b] of ranges) {
      if (b < start || a > end) continue;
      if (a > cursor) text += source.slice(cursor, a);
      had = true;
      cursor = Math.max(cursor, Math.min(b, end));
    }
    if (cursor < end) text += source.slice(cursor, end);
    if (!had || text.trim()) kept.push(text);
    start = end + 1;
  }
  return kept.join("\n");
}

function dialogueLines(source: string): string[] {
  return withoutComments(source.replace(/\r\n?/g, "\n")).split("\n");
}

function isTextLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (trimmed.startsWith("\\")) return true;
  if (trimmed.startsWith("@")) return false;
  return !RUN_ACTION_LINE.test(trimmed);
}

function dialogueUnits(lines: string[]): DialogueUnit[] {
  const out: DialogueUnit[] = [];
  let cur: DialogueUnit | null = null;
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (!isTextLine(t)) {
      cur = null;
      return;
    }
    // PS Maker drops the backslash only before a command or a "Name: " line (before "*" it escapes markup).
    const escaped = t.startsWith("\\@") || (t.startsWith("\\") && t.indexOf(": ") > 1);
    const colon = t.startsWith("\\") ? -1 : t.indexOf(": ");
    // A line naming its speaker starts a unit of its own.
    if (!cur || colon > 0) {
      cur = { first: i, last: i, name: colon > 0 ? t.slice(0, colon) : "", text: colon > 0 ? t.slice(colon + 2) : escaped ? t.slice(1) : t, escaped };
      out.push(cur);
      return;
    }
    cur.last = i;
    cur.text += `\n${escaped ? t.slice(1) : t}`;
  });
  return out;
}

/** Texts and speaker names of a PS Maker dialogue source, in order. */
export function dialogueTexts(source: string): { type: "text" | "name"; text: string }[] {
  const lines = dialogueLines(source);
  const out: { type: "text" | "name"; text: string }[] = [];
  const units = dialogueUnits(lines);
  let u = 0;
  lines.forEach((raw, i) => {
    const m = raw.trim().match(NAME_COMMAND);
    if (m) out.push({ type: "name", text: m[1].replace(/\\(.)/g, "$1") });
    while (u < units.length && units[u].first === i) {
      if (units[u].name) out.push({ type: "name", text: units[u].name });
      if (units[u].text.trim()) out.push({ type: "text", text: units[u].text });
      u++;
    }
  });
  return out;
}

/** A translated line must not read as a command or a "Name: " line it was not. */
function plainLine(line: string, mayName: boolean): string {
  const t = line.trim();
  if (!t) return t;
  if (t.startsWith("@") || t.startsWith("{@") || (!mayName && t.indexOf(": ") > 0)) return `\\${t}`;
  return t;
}

/**
 * The dialogue source with its texts and names translated (`tr` returns null for "keep"); commands,
 * pages and the rest stay as written. A translation may span several lines, or pages (blank lines).
 */
export function translateDialogue(source: string, tr: (type: "text" | "name", text: string) => string | null): string {
  const lines = dialogueLines(source);
  const units = dialogueUnits(lines);
  const byFirst = new Map(units.map((u) => [u.first, u]));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const u = byFirst.get(i);
    if (!u) {
      const m = lines[i].trim().match(NAME_COMMAND);
      const name = m ? tr("name", m[1].replace(/\\(.)/g, "$1")) : null;
      out.push(name ? `@name "${name.replace(/(["\\])/g, "\\$1")}"` : lines[i]);
      continue;
    }
    const text = tr("text", u.text) ?? u.text;
    const name = u.name ? (tr("name", u.name) ?? u.name) : "";
    const textLines = text.split("\n");
    const first = plainLine(textLines[0], false);
    out.push(name ? `${name}: ${first.startsWith("\\") ? first.slice(1) : first}` : u.escaped && !first.startsWith("\\") && text === u.text ? `\\${first}` : first);
    for (const l of textLines.slice(1)) out.push(plainLine(l, false));
    i = u.last;
  }
  return out.join("\n");
}

// ---- finding the texts of a project -------------------------------------------------------------

export interface FoundText {
  type: RowType;
  source: string;
  where: string;
}

interface ActionLike {
  type?: string;
  actionName?: string;
  pluginParams?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Text fields of the toolkit's actions (by action name) and their row type. */
const TOOLKIT_TEXT_FIELDS: Record<string, [string, RowType][]> = {
  "Zelda: Show Message": [["text", "text"]],
  "Zelda: Dialogue": [["name", "name"], ["text", "text"], ["choice1", "text"], ["choice2", "text"], ["choice3", "text"], ["choice4", "text"]],
  "Zelda: Create Object": [["text", "text"]],
  "Zelda: Define Item": [["name", "text"]],
  "Zelda: Add Rule": [["message", "text"]],
  "Zelda: Create Switch Sequence": [["message", "text"]],
  "Zelda: Run Actions": [["message", "text"]],
};

/** Texts of a UI layout made in the designer (its data, as JSON). */
export function layoutTexts(raw: string): string[] {
  try {
    const d = JSON.parse(raw) as { elements?: { type?: string; text?: unknown }[] };
    return (d.elements ?? []).filter((e) => ["text", "button", "bar"].includes(str(e?.type))).map((e) => str(e.text)).filter(textWorthTranslating);
  } catch {
    return [];
  }
}

/** A text with something to translate: not only {bindings}, numbers and signs. */
export function textWorthTranslating(t: string): boolean {
  return /\p{L}/u.test(t.replace(/\{[^{}]*\}/g, ""));
}

/** Toolkit texts are run through `i18n.text`, which reads a toolkit key as that string. */
const isToolkitKey = (t: string, keys: ReadonlySet<string>) => keys.has(t);

/**
 * Every text of a project a player can see: PS Maker's Dialogue (pages, speaker names), Choices
 * (prompt, answers) and the images of Show Image / Change Image; the toolkit's actions (messages,
 * signs, dialogue, item names) and the texts of UI layouts; then the toolkit's own strings (`keys`).
 */
export function extractTexts(story: unknown, keys: readonly string[] = [], imageNames: ReadonlyMap<string, string> = new Map()): FoundText[] {
  const s = (story ?? {}) as { maps?: Record<string, unknown>[]; globalStoryEvents?: Record<string, unknown>[]; ownedStoryEvents?: Record<string, unknown>[] };
  const out: FoundText[] = [];
  const keySet = new Set(keys);
  const add = (type: RowType, source: string, where: string) => {
    if (!source.trim() || (type === "text" && (!textWorthTranslating(source) || isToolkitKey(source, keySet)))) return;
    out.push({ type, source, where });
  };
  const visit = (a: ActionLike, where: string) => {
    if (a.type === "dialogueAction") for (const t of dialogueTexts(str(a.dialogueSource))) add(t.type, t.text, `${where} › Dialogue`);
    if (a.type === "choicesAction") {
      add("text", str(a.text), `${where} › Choices`);
      for (const c of Array.isArray(a.choices) ? (a.choices as { text?: unknown }[]) : []) add("text", str(c?.text), `${where} › Choices`);
    }
    if (a.type === "showImageAction" || a.type === "changeImageAction") {
      const name = imageNames.get(str(a.imageId));
      if (name) add("image", name, `${where} › ${a.type === "showImageAction" ? "Show image" : "Change image"}`);
    }
    const name = str(a.actionName);
    const p = a.pluginParams ?? {};
    for (const [field, type] of TOOLKIT_TEXT_FIELDS[name] ?? []) add(type, str(p[field]), `${where} › ${name.replace(/^Zelda: /, "")}`);
    if (name === "Zelda: UI Layout") {
      const screen = str(p.name) || "HUD";
      for (const t of layoutTexts(str(p.layout))) add("text", t, `${where} › UI Layout ${screen}`);
    }
  };
  // Every action, also inside conditions and embedded in dialogues.
  const walk = (o: unknown, where: string, depth = 0) => {
    if (depth > 40 || !o || typeof o !== "object") return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x, where, depth + 1);
      return;
    }
    const a = o as ActionLike;
    if (typeof a.type === "string") visit(a, where);
    for (const [k, v] of Object.entries(a)) if (k !== "pluginParams" && v && typeof v === "object") walk(v, where, depth + 1);
  };
  // An event owned by an action (an event trigger) is named after that action, on its map.
  const owners = new Map<string, string>();
  for (const m of s.maps ?? []) {
    const map = str(m.name) || str(m.id);
    for (const list of ["setupActions", "initialActions", "enterActions", "leaveActions"]) {
      for (const a of Array.isArray(m[list]) ? (m[list] as ActionLike[]) : []) if (a && str(a.id)) owners.set(str(a.id), `${map} › ${str(a.instanceName) || str(a.name) || "event"}`);
    }
  }
  for (const m of s.maps ?? []) {
    const map = str(m.name) || str(m.id);
    for (const list of ["setupActions", "initialActions", "enterActions", "leaveActions"]) walk(m[list], `${map} › ${list.replace("Actions", "")}`);
    for (const e of Array.isArray(m.storyEvents) ? (m.storyEvents as Record<string, unknown>[]) : []) walk(e.actions, `${map} › ${str(e.name) || "event"}`);
  }
  for (const e of s.globalStoryEvents ?? []) walk(e.actions, str(e.name) || "event");
  for (const e of s.ownedStoryEvents ?? []) walk(e.actions, owners.get(str((e.owner as { actionId?: unknown } | undefined)?.actionId)) ?? (str(e.name) || "event"));
  for (const k of keys) out.push({ type: "toolkit", source: k, where: "toolkit" });
  return out;
}

/**
 * The table after an extraction: new texts are added (in project order), translated ones keep
 * their translations, rows no longer in the project are kept and marked unused.
 */
export function mergeExtracted(table: TranslationTable, found: readonly FoundText[]): { table: TranslationTable; added: number; unused: number } {
  const old = new Map(table.rows.map((r) => [rowKey(r.type, r.source), r]));
  const rows: TranslationRow[] = [];
  const seen = new Set<string>();
  let added = 0;
  for (const f of found) {
    const k = rowKey(f.type, f.source);
    if (seen.has(k)) continue;
    seen.add(k);
    const before = old.get(k);
    if (!before) added++;
    rows.push({ type: f.type, source: f.source, where: f.where, tr: { ...(before?.tr ?? {}) } });
  }
  let unused = 0;
  for (const r of table.rows) {
    if (seen.has(rowKey(r.type, r.source))) continue;
    unused++;
    rows.push({ ...r, tr: { ...r.tr }, unused: true });
  }
  return { table: { ...table, rows }, added, unused };
}

// ---- CSV ----------------------------------------------------------------------------------------

/**
 * The separator a spreadsheet expects in this locale: where the decimal mark is a comma (ru, de,
 * fr…), Excel lists with ";", elsewhere with ",".
 */
export function defaultSeparator(locale?: string): "," | ";" {
  try {
    return (1.5).toLocaleString(locale).includes(",") ? ";" : ",";
  } catch {
    return ",";
  }
}

function csvCell(v: string, sep: string): string {
  return /["\r\n]/.test(v) || v.includes(sep) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The table as CSV: `type, where`, then a column per language (the first is the source: the text
 * as written; for toolkit strings, the toolkit key's text). `builtin(key, lang)` gives a toolkit
 * string's own text for the languages the toolkit has (en, ru), so translators see it.
 */
export function toCsv(table: TranslationTable, sep: "," | ";" = ",", builtin: (key: string, lang: string) => string | null = () => null): string {
  const codes = table.languages.map((l) => l.code);
  const lines = [["type", "where", ...codes].map((c) => csvCell(c, sep)).join(sep)];
  for (const r of table.rows) {
    if (r.unused) continue;
    const cells = codes.map((c, i) => {
      if (r.type === "toolkit") return r.tr[c] || builtin(r.source, c) || "";
      return i === 0 ? r.source : (r.tr[c] ?? "");
    });
    lines.push([r.type, r.type === "toolkit" ? r.source : r.where, ...cells].map((c) => csvCell(c, sep)).join(sep));
  }
  // A byte order mark: Excel then reads the file as UTF-8.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** The separator a CSV file uses: "," or ";", whichever its header line has outside quotes. */
export function detectSeparator(csv: string): "," | ";" {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const ch of csv.replace(/^\uFEFF/, "")) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch === ",") commas++;
    else if (!quoted && ch === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

export function parseCsv(csv: string, sep: string = detectSeparator(csv)): string[][] {
  const text = csv.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Reads a CSV made from `toCsv` (edited in a spreadsheet) into the table: translations of the rows
 * it has are replaced, languages it adds are added; the rows' order and the rest of the table stay.
 * A cell holding a toolkit string's own text is not a translation (the toolkit's text is used).
 */
export function mergeCsv(table: TranslationTable, csv: string, builtin: (key: string, lang: string) => string | null = () => null): { table: TranslationTable; updated: number; added: number; error: string } {
  const rows = parseCsv(csv);
  const head = rows[0]?.map((c) => c.trim()) ?? [];
  if (head[0]?.toLowerCase() !== "type" || head[1]?.toLowerCase() !== "where" || head.length < 3) return { table, updated: 0, added: 0, error: 'the first line must be "type, where" and the language codes' };
  const codes = head.slice(2);
  const source = table.languages[0].code;
  if (codes[0] !== source) return { table, updated: 0, added: 0, error: `the first language column must be the source language "${source}"` };
  const languages = [...table.languages];
  for (const c of codes) if (c && !languages.some((l) => l.code === c)) languages.push(language(c));
  const out = table.rows.map((r) => ({ ...r, tr: { ...r.tr } }));
  const index = new Map(out.map((r) => [rowKey(r.type, r.source), r]));
  let updated = 0;
  let added = 0;
  for (const cells of rows.slice(1)) {
    const type = cells[0]?.trim() as RowType;
    if (!ROW_TYPES.includes(type)) continue;
    const key = type === "toolkit" ? (cells[1] ?? "").trim() : (cells[2] ?? "");
    if (!key) continue;
    let row = index.get(rowKey(type, key));
    if (!row) {
      row = { type, source: key, where: type === "toolkit" ? "toolkit" : (cells[1] ?? ""), tr: {} };
      out.push(row);
      index.set(rowKey(type, key), row);
      added++;
    }
    let changed = false;
    codes.forEach((c, i) => {
      if (!c || (type !== "toolkit" && i === 0)) return;
      const v = cells[i + 2] ?? "";
      const keep = type === "toolkit" && v === builtin(key, c) ? "" : v;
      if ((row!.tr[c] ?? "") === keep) return;
      if (keep) row!.tr[c] = keep;
      else delete row!.tr[c];
      changed = true;
    });
    if (changed) updated++;
  }
  return { table: { ...table, languages, rows: out }, updated, added, error: "" };
}

/**
 * The dialogue source in a language's own dialogue layout (its font and size): every
 * `@dialogue_layout` of the source points to it, and it is set from the first page.
 */
export function withDialogueLayout(source: string, layoutId: string): string {
  if (!layoutId) return source;
  const lines = source.split("\n").map((l) => (/^\s*@dialogue_layout\b/i.test(l) ? `@dialogue_layout ${layoutId}` : l));
  return [`@dialogue_layout ${layoutId}`, ...lines].join("\n");
}
