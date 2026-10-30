import {
  defaultSeparator,
  detectSeparator,
  emptyTable,
  extractTexts,
  language,
  mergeCsv,
  mergeExtracted,
  parseTable,
  serializeTable,
  toCsv,
  type RowType,
  type TranslationRow,
  type TranslationTable,
} from "../core/translations.ts";
import { builtinKeys, builtinString } from "../ui/i18n.ts";
import { writeFormText } from "./layoutEdit.ts";
import { TRANSLATIONS_ACTION } from "./projectTranslations.ts";

/**
 * The translation sheet: a page panel shown while "Zelda: Translations" is open in the editor. A
 * row per text of the project, a column per language; it finds the project's texts, keeps the
 * table in the action (its "Translation data" field, written the way typing does), and exchanges
 * it with CSV files for spreadsheets. Undo, and a few backups kept in the browser before each
 * extraction or import.
 */

export const DATA_FIELD_LABEL = "Translation data";
const SAVE_DELAY_MS = 600;
const ECHO_MS = 1500;
const PAGE = 120;
const BACKUPS = 5;

interface SheetStory {
  maps?: unknown[];
  images?: { id?: string; name?: string }[];
  gameUI?: { dialogLayouts?: { id?: string; name?: string }[]; choiceLayouts?: { id?: string; name?: string }[]; fonts?: { id?: string; name?: string }[] };
  metadata?: { storyId?: string };
  storyName?: string;
}

export interface SheetHost {
  story(): SheetStory | null;
}

type Show = "all" | "untranslated" | "unused" | RowType;

const CSS = {
  panel: "position:fixed;right:8px;top:64px;width:min(920px,calc(100vw - 740px));min-width:420px;max-height:calc(100vh - 88px);display:flex;flex-direction:column;z-index:10000;background:#1f1a24;color:#eee;border:1px solid #ffd23a;border-radius:6px;font:12px/1.35 sans-serif;box-shadow:0 4px 16px #0008",
  bar: "display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:4px 6px",
  input: "background:#2c2533;color:#eee;border:1px solid #554a5e;border-radius:3px;padding:2px 4px;font:inherit",
  button: "background:#3a3144;color:#eee;border:1px solid #6a5a78;border-radius:3px;padding:2px 6px;font:inherit;cursor:pointer",
  chip: "background:#2c2533;color:#eee;border:1px solid #6a5a78;border-radius:10px;padding:1px 8px;font:inherit;cursor:pointer",
  chipOn: "background:#5a4a24;color:#fff;border:1px solid #ffd23a;border-radius:10px;padding:1px 8px;font:inherit;cursor:pointer",
  head: "font-weight:bold;color:#ffd23a",
  scroll: "overflow:auto;flex:1;min-height:120px;border-top:1px solid #3a3144",
  cell: "vertical-align:top;padding:2px 3px;border-bottom:1px solid #2c2533",
  area: "width:100%;box-sizing:border-box;min-height:22px;resize:vertical;background:#2c2533;color:#eee;border:1px solid #554a5e;border-radius:3px;padding:2px 4px;font:inherit",
  missing: "border-color:#a0444c",
};

export class TranslationSheet {
  private readonly win: any;
  private readonly doc: any;
  private readonly host: SheetHost;
  private root: any = null;
  private body: any = null;
  private statusEl: any = null;
  private table: TranslationTable | null = null;
  private ref = "";
  private seenRaw = "";
  private lastWritten = "";
  private writtenAt = 0;
  private saveTimer: any = null;
  private readonly undoStack: string[] = [];
  private filter = "";
  private show: Show = "all";
  private shown = PAGE;
  private langOpen = "";
  private sep: "auto" | "," | ";" = "auto";
  private collapsed = false;

  constructor(win: any, host: SheetHost) {
    this.win = win;
    this.doc = win.document;
    this.host = host;
  }

  /** Called a few times a second: the open Translations action (its id and data), or null. */
  update(open: { id: string; raw: string } | null): void {
    if (!open) {
      this.flush();
      this.table = null;
      this.ref = "";
      this.hide();
      return;
    }
    this.mount();
    if (!this.table || this.ref !== open.id) this.load(open);
    else if (open.raw !== this.seenRaw) {
      // Our own write coming back, or a change from elsewhere (the editor's undo).
      this.seenRaw = open.raw;
      if (open.raw !== this.lastWritten && Date.now() - this.writtenAt > ECHO_MS) this.load(open);
    }
  }

  private load(open: { id: string; raw: string }): void {
    const { table, error } = parseTable(open.raw);
    this.ref = open.id;
    this.seenRaw = open.raw;
    this.lastWritten = open.raw;
    this.table = table ?? emptyTable(this.guessSource());
    this.undoStack.length = 0;
    this.render();
    if (error) this.status(`Saved data not read: ${error}. A change replaces it.`, true);
    else if (!table) this.status('New sheet. Set the source language (the one the project is written in), add languages, then "Find texts".');
  }

  /** The source language of a new sheet: the editor's language when the toolkit has it, else English. */
  private guessSource(): string {
    const nav = String(this.win.navigator?.language ?? "en").slice(0, 2).toLowerCase();
    return builtinString("hud.life", nav) ? nav : "en";
  }

  // ---- changes -------------------------------------------------------------------------------------

  /** Changes the table (undo keeps the one before) and saves it soon. */
  private change(next: TranslationTable, rerender = true): void {
    if (!this.table) return;
    this.undoStack.push(serializeTable(this.table));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.table = next;
    this.scheduleSave();
    if (rerender) this.render();
  }

  /** A change made from the table as it is now (typing in cells changes it without a redraw). */
  private edit(fn: (t: TranslationTable) => TranslationTable): void {
    if (this.table) this.change(fn(this.table));
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return this.status("Nothing to undo.");
    this.table = parseTable(prev).table ?? this.table;
    this.scheduleSave();
    this.render();
  }

  private scheduleSave(): void {
    if (this.saveTimer) this.win.clearTimeout(this.saveTimer);
    this.saveTimer = this.win.setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  /** Writes a pending change into the action's field now. */
  private flush(): void {
    if (!this.saveTimer) return;
    this.win.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.table) return;
    const text = serializeTable(this.table);
    if (text === this.lastWritten) return;
    if (!writeFormText(this.doc, TRANSLATIONS_ACTION, DATA_FIELD_LABEL, text)) return this.status(`Not saved: the "${DATA_FIELD_LABEL}" field of ${TRANSLATIONS_ACTION} was not found.`, true);
    this.lastWritten = text;
    this.writtenAt = Date.now();
  }

  /** Keeps the table in the browser before a big change (an extraction, an import). */
  private backup(why: string): void {
    if (!this.table) return;
    try {
      const store = this.win.localStorage;
      const key = this.backupKey();
      const list = JSON.parse(store.getItem(key) ?? "[]") as { at: number; why: string; data: string }[];
      list.unshift({ at: Date.now(), why, data: serializeTable(this.table) });
      store.setItem(key, JSON.stringify(list.slice(0, BACKUPS)));
    } catch {
      // No storage: undo still works.
    }
  }

  private backups(): { at: number; why: string; data: string }[] {
    try {
      return JSON.parse(this.win.localStorage.getItem(this.backupKey()) ?? "[]");
    } catch {
      return [];
    }
  }

  private backupKey(): string {
    const s = this.host.story();
    return `zelda-maker-toolkit:translations-backup:${s?.metadata?.storyId || s?.storyName || "project"}`;
  }

  private findTexts(): void {
    if (!this.table) return;
    const story = this.host.story();
    if (!story) return this.status("The project data is not available here.", true);
    this.backup("before Find texts");
    const images = new Map((story.images ?? []).filter((i) => i.id && i.name).map((i) => [i.id!, i.name!]));
    const { table, added, unused } = mergeExtracted(this.table, extractTexts(story, builtinKeys(), images));
    this.change(table);
    this.status(`${table.rows.filter((r) => !r.unused).length} texts: ${added} new, ${unused} no longer in the project (kept, shown as unused).`);
  }

  private separator(): "," | ";" {
    return this.sep === "auto" ? defaultSeparator(this.win.navigator?.language) : this.sep;
  }

  private async exportCsv(): Promise<void> {
    if (!this.table) return;
    const csv = toCsv(this.table, this.separator(), builtinString);
    const s = this.host.story();
    const name = `${(s?.storyName || "translations").replace(/[\\/:*?"<>|]+/g, "_")} translations.csv`;
    const data = new TextEncoder().encode(csv);
    // The desktop editor's own save dialog (its preload API), else a browser download.
    const desktop = this.win.psMakerDesktop;
    try {
      if (desktop?.saveFileDialog && desktop.writeSavedFile) {
        const target = await desktop.saveFileDialog({ title: "Export translations", defaultPath: name, filters: [{ name: "CSV", extensions: ["csv"] }] });
        if (!target) return this.status("Export cancelled.");
        await desktop.writeSavedFile(target.token, data);
        return this.status(`Saved ${target.filePath ?? name} (separator "${this.separator()}").`);
      }
      const url = this.win.URL.createObjectURL(new this.win.Blob([data], { type: "text/csv;charset=utf-8" }));
      const a = this.doc.createElement("a");
      a.href = url;
      a.download = name;
      a.style.display = "none";
      this.doc.body.appendChild(a);
      a.click();
      a.remove();
      this.win.setTimeout(() => this.win.URL.revokeObjectURL(url), 10000);
      this.status(`Downloaded ${name} (separator "${this.separator()}").`);
    } catch (err) {
      this.status(`Export failed: ${String((err as Error)?.message ?? err)}`, true);
    }
  }

  private importCsv(): void {
    const input = this.doc.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv,text/plain";
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file || !this.table) return;
      try {
        const text = String(await file.text());
        const { table, updated, added, error } = mergeCsv(this.table, text, builtinString);
        if (error) return this.status(`Not imported: ${error}.`, true);
        this.backup(`before importing ${file.name}`);
        this.change(table);
        this.status(`Imported ${file.name} (separator "${detectSeparator(text)}"): ${updated} rows changed, ${added} added.`);
      } catch (err) {
        this.status(`Import failed: ${String((err as Error)?.message ?? err)}`, true);
      }
    });
    this.doc.body.appendChild(input);
    input.click();
  }

  // ---- the page ------------------------------------------------------------------------------------

  private el(tag: string, style = "", text = ""): any {
    const e = this.doc.createElement(tag);
    if (style) e.style.cssText = style;
    if (text) e.textContent = text;
    return e;
  }

  private button(text: string, onClick: () => void, title = ""): any {
    const b = this.el("button", CSS.button, text);
    b.type = "button";
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  private select(options: [string, string][], value: string, onChange: (v: string) => void): any {
    const s = this.el("select", CSS.input);
    for (const [v, label] of options) {
      const o = this.el("option", "", label);
      o.value = v;
      s.appendChild(o);
    }
    s.value = value;
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }

  /** Typing here must not reach the editor's shortcuts, nor a press the map under the panel. */
  private guard(node: any): void {
    for (const type of ["keydown", "keyup", "keypress", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend", "wheel"]) node.addEventListener(type, (e: any) => e.stopPropagation());
  }

  private mount(): void {
    if (!this.doc?.body) return;
    if (!this.root) {
      this.root = this.el("div", CSS.panel);
      this.root.setAttribute("data-zelda-translation-sheet", "true");
      this.guard(this.root);
      this.doc.body.appendChild(this.root);
    }
    this.root.style.display = "flex";
  }

  private hide(): void {
    if (this.root) this.root.style.display = "none";
  }

  destroy(): void {
    this.flush();
    this.root?.remove?.();
    this.root = null;
  }

  private status(text: string, warn = false): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.style.color = warn ? "#ff9a8a" : "#bbb";
  }

  private render(): void {
    if (!this.root || !this.table) return;
    const t = this.table;
    this.root.textContent = "";
    const top = this.el("div", CSS.bar);
    top.append(this.el("span", CSS.head, "Zelda translation sheet"), this.button(this.collapsed ? "▸" : "▾", () => ((this.collapsed = !this.collapsed), this.render()), "Fold the sheet"));
    this.statusEl = this.el("span", "color:#bbb;flex:1;min-width:160px");
    top.append(this.statusEl);
    this.root.append(top);
    if (this.collapsed) return;

    // Languages: the first is the one the project is written in.
    const langs = this.el("div", CSS.bar);
    langs.append(this.el("span", "color:#bbb", "Languages:"));
    t.languages.forEach((l, i) => {
      const chip = this.el("button", this.langOpen === l.code ? CSS.chipOn : CSS.chip, i === 0 ? `${l.code} · source` : l.code);
      chip.type = "button";
      chip.title = `${l.name}${i === 0 ? " — the language the project's texts are written in" : ""}. Click for its settings.`;
      chip.addEventListener("click", () => ((this.langOpen = this.langOpen === l.code ? "" : l.code), this.render()));
      langs.append(chip);
    });
    const code = this.el("input", `${CSS.input};width:64px`);
    code.placeholder = "code";
    code.title = "Language code: en, ru, de, fr, ja, zh-CN…";
    langs.append(
      code,
      this.button("+ Add", () => {
        const c = String(code.value).trim();
        if (!c || t.languages.some((l) => l.code === c)) return this.status(c ? `"${c}" is already there.` : "Type a language code first.", true);
        this.langOpen = c;
        this.edit((t) => ({ ...t, languages: [...t.languages, language(c)] }));
      }),
    );
    this.root.append(langs);
    if (this.langOpen) this.root.append(this.languageSettings());

    const tools = this.el("div", CSS.bar);
    const backups = this.backups();
    tools.append(
      this.button("Find texts in the project", () => this.findTexts(), "Every text of the project (PS Maker dialogues, choices, images; toolkit messages, signs, items, UI layouts) and the toolkit's own strings. Translations are kept."),
      this.button("Export CSV", () => void this.exportCsv(), "A file for Excel, Google Sheets, LibreOffice: a column per language."),
      this.button("Import CSV", () => this.importCsv(), "Reads an edited CSV back (its separator is detected): translations and new languages come in."),
      this.el("span", "color:#bbb", "Separator"),
      this.select([["auto", `Auto (${defaultSeparator(this.win.navigator?.language)})`], [",", ","], [";", ";"]], this.sep, (v) => ((this.sep = v as typeof this.sep), this.render())),
      this.button("Undo", () => this.undo()),
    );
    if (backups.length)
      tools.append(
        this.select([["", "Backups…"], ...backups.map((b, i) => [String(i), `${new Date(b.at).toLocaleString()} — ${b.why}`] as [string, string])], "", (v) => {
          const b = backups[Number(v)];
          const table = b && parseTable(b.data).table;
          if (!table) return;
          this.change(table);
          this.status(`Restored the backup of ${new Date(b.at).toLocaleString()}.`);
        }),
      );
    const unused = t.rows.filter((r) => r.unused).length;
    if (unused) tools.append(this.button(`Remove ${unused} unused`, () => this.edit((t) => ({ ...t, rows: t.rows.filter((r) => !r.unused) })), "Rows whose text is no longer in the project (their translations are lost)."));
    this.root.append(tools);

    const filters = this.el("div", CSS.bar);
    const search = this.el("input", `${CSS.input};flex:1;min-width:120px`);
    search.placeholder = "Search the texts and translations…";
    search.value = this.filter;
    search.addEventListener("input", () => {
      this.filter = String(search.value);
      this.shown = PAGE;
      this.renderRows();
    });
    filters.append(
      search,
      this.select(
        [
          ["all", "All rows"],
          ["untranslated", "Not translated yet"],
          ["unused", "Not in the project"],
          ["text", "Texts"],
          ["name", "Speaker names"],
          ["image", "Images"],
          ["toolkit", "Toolkit strings"],
        ],
        this.show,
        (v) => ((this.show = v as Show), (this.shown = PAGE), this.renderRows()),
      ),
    );
    this.root.append(filters);
    this.body = this.el("div", CSS.scroll);
    this.root.append(this.body);
    this.renderRows();
  }

  private languageSettings(): any {
    const t = this.table!;
    const i = t.languages.findIndex((l) => l.code === this.langOpen);
    const l = t.languages[i];
    const box = this.el("div", `${CSS.bar};background:#2a2330`);
    if (!l) return box;
    const story = this.host.story();
    const opts = (list: { id?: string; name?: string }[] | undefined, none: string): [string, string][] => [["", none], ...(list ?? []).filter((x) => x.id).map((x) => [x.id!, x.name || x.id!] as [string, string])];
    const set = (patch: Partial<typeof l>) => this.edit((t) => ({ ...t, languages: t.languages.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
    const name = this.el("input", `${CSS.input};width:110px`);
    name.value = l.name;
    name.title = "What the player sees in a language menu ({language} in a UI layout).";
    name.addEventListener("change", () => set({ name: String(name.value).trim() || l.code }));
    const code = this.el("input", `${CSS.input};width:56px`);
    code.value = l.code;
    code.title = "Language code";
    code.addEventListener("change", () => {
      const c = String(code.value).trim();
      if (!c || t.languages.some((x) => x.code === c)) return this.render();
      // The translations follow the code.
      this.langOpen = c;
      this.edit((t) => ({ ...t, languages: t.languages.map((x, j) => (j === i ? { ...x, code: c } : x)), rows: t.rows.map((r) => (l.code in r.tr ? { ...r, tr: Object.fromEntries(Object.entries(r.tr).map(([k, v]) => [k === l.code ? c : k, v])) } : r)) }));
    });
    box.append(
      this.el("span", "color:#bbb", "Code"),
      code,
      this.el("span", "color:#bbb", "Name"),
      name,
      this.el("span", "color:#bbb", "Dialogue layout"),
      this.select(opts(story?.gameUI?.dialogLayouts, "As written"), l.dialogueLayout, (v) => set({ dialogueLayout: v })),
      this.el("span", "color:#bbb", "Choices layout"),
      this.select(opts(story?.gameUI?.choiceLayouts, "As written"), l.choiceLayout, (v) => set({ choiceLayout: v })),
      this.el("span", "color:#bbb", "Toolkit font"),
      this.select(opts(story?.gameUI?.fonts, "The layout's"), l.font, (v) => set({ font: v })),
    );
    if (i > 0)
      box.append(
        this.button("Remove language", () => {
          if (!this.win.confirm?.(`Remove "${l.code}" and its translations? (Undo brings it back.)`)) return;
          this.langOpen = "";
          this.edit((t) => ({ ...t, languages: t.languages.filter((_, j) => j !== i), rows: t.rows.map((r) => ({ ...r, tr: Object.fromEntries(Object.entries(r.tr).filter(([k]) => k !== l.code)) })) }));
        }),
      );
    else box.append(this.el("span", "color:#999", "The source: the texts as written in the editor."));
    return box;
  }

  private visibleRows(): TranslationRow[] {
    const t = this.table!;
    const others = t.languages.slice(1).map((l) => l.code);
    const q = this.filter.trim().toLowerCase();
    return t.rows.filter((r) => {
      if (this.show === "unused" && !r.unused) return false;
      if (this.show === "untranslated" && (r.unused || others.every((c) => r.tr[c] || (r.type === "toolkit" && builtinString(r.source, c))))) return false;
      if ((["text", "name", "image", "toolkit"] as Show[]).includes(this.show) && r.type !== this.show) return false;
      if (!q) return true;
      return [r.source, r.where, ...Object.values(r.tr)].some((v) => v.toLowerCase().includes(q));
    });
  }

  private renderRows(): void {
    if (!this.body || !this.table) return;
    const t = this.table;
    this.body.textContent = "";
    const rows = this.visibleRows();
    const table = this.el("table", "width:100%;border-collapse:collapse;table-layout:fixed");
    const head = this.el("tr");
    const widths = ["54px", "18%", ...t.languages.map(() => "")];
    ["type", "where", ...t.languages.map((l, i) => (i === 0 ? `${l.code} (source)` : l.code))].forEach((h, i) => {
      const th = this.el("th", `text-align:left;padding:3px;color:#ffd23a;position:sticky;top:0;background:#1f1a24;${widths[i] ? `width:${widths[i]}` : ""}`, h);
      head.append(th);
    });
    table.append(head);
    for (const r of rows.slice(0, this.shown)) table.append(this.rowEl(r));
    this.body.append(table);
    if (!t.rows.length) this.body.append(this.el("div", "padding:8px;color:#bbb", 'No texts yet: press "Find texts in the project".'));
    else if (!rows.length) this.body.append(this.el("div", "padding:8px;color:#bbb", "No row matches."));
    if (rows.length > this.shown) this.body.append(this.button(`Show more (${rows.length - this.shown} left)`, () => ((this.shown += PAGE), this.renderRows())));
  }

  private rowEl(r: Readonly<TranslationRow>): any {
    const t = this.table!;
    const tr = this.el("tr", r.unused ? "opacity:0.55" : "");
    tr.append(this.el("td", `${CSS.cell};color:#bbb`, r.unused ? `${r.type} ✗` : r.type));
    const where = this.el("td", `${CSS.cell};color:#999;overflow:hidden;text-overflow:ellipsis`, r.type === "toolkit" ? r.source : r.where);
    where.title = r.unused ? "Not in the project any more (kept: its translations stay until you remove unused rows)." : r.type === "toolkit" ? `Toolkit string ${r.source}` : r.where;
    tr.append(where);
    t.languages.forEach((l, i) => {
      const td = this.el("td", CSS.cell);
      if (i === 0 && r.type !== "toolkit") {
        td.append(this.el("div", "white-space:pre-wrap;word-break:break-word", r.source));
      } else {
        const area = this.el("textarea", CSS.area);
        area.rows = Math.min(6, Math.max(1, (r.tr[l.code] ?? r.source).split("\n").length));
        area.value = r.tr[l.code] ?? "";
        area.placeholder = r.type === "toolkit" ? (builtinString(r.source, l.code) ?? builtinString(r.source, "en") ?? "") : r.type === "image" ? "image name" : "";
        if (!area.value && !(r.type === "toolkit" && builtinString(r.source, l.code)) && !r.unused) area.style.cssText += `;${CSS.missing}`;
        let typed = false;
        area.addEventListener("focus", () => (typed = false));
        area.addEventListener("input", () => {
          const cur = this.table!;
          // One undo step per cell edit; typing does not redraw the sheet (the cursor stays).
          if (!typed) this.undoStack.push(serializeTable(cur));
          typed = true;
          const v = String(area.value);
          const tr = { ...((cur.rows.find((x) => x.type === r.type && x.source === r.source) ?? r).tr) };
          if (v) tr[l.code] = v;
          else delete tr[l.code];
          this.table = { ...cur, rows: cur.rows.map((x) => (x.type === r.type && x.source === r.source ? { ...x, tr } : x)) };
          this.scheduleSave();
        });
        td.append(area);
      }
      tr.append(td);
    });
    return tr;
  }
}
