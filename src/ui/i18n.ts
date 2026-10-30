import { en } from "../../locales/en/strings.ts";
import { ru } from "../../locales/ru/strings.ts";
import type { LocalizedText } from "../core/types.ts";
import type { RowType, Translator } from "../core/translations.ts";

const TABLES: Record<string, Record<string, string>> = { en, ru };

/** Languages of the toolkit's own strings. */
export const BUILTIN_LANGUAGES = Object.keys(TABLES);

/** A toolkit string in one of its own languages (null when it has none there). */
export function builtinString(key: string, lang: string): string | null {
  return TABLES[lang]?.[key] ?? null;
}

/** Every key of the toolkit's own strings. */
export function builtinKeys(): string[] {
  return Object.keys(en);
}

/**
 * Localization: the toolkit's strings by key (English fallback, `{var}` substitution) and, with
 * the project's translation table (Zelda: Translations), the project's own texts — dialogues,
 * messages, signs, layout texts — in any language of the table, without changing them.
 */
export class I18n {
  private lang = "en";
  private tr: Translator | null = null;

  /** The project's translation table (null = none: the toolkit's languages, texts as written). */
  useTranslations(tr: Translator | null): void {
    this.tr = tr;
  }

  get translator(): Translator | null {
    return this.tr;
  }

  /** The languages a player can choose: the table's, else the toolkit's own. */
  get languages(): string[] {
    return this.tr ? this.tr.codes : BUILTIN_LANGUAGES;
  }

  setLanguage(lang: string): void {
    const codes = this.languages;
    const pick = (l: string) => codes.find((c) => c.toLowerCase() === l.toLowerCase()) ?? codes.find((c) => c.slice(0, 2).toLowerCase() === l.slice(0, 2).toLowerCase());
    const fallback = this.tr ? this.tr.source : "en";
    if (lang === "auto" || !lang) {
      const nav = typeof navigator !== "undefined" ? navigator.language : "";
      this.lang = (nav && pick(nav)) || fallback;
    } else this.lang = pick(lang) ?? fallback;
  }

  get language(): string {
    return this.lang;
  }

  /** The language's name for the player (the table's name for it, else its code). */
  languageName(code = this.lang): string {
    return this.tr?.lang(code)?.name || code;
  }

  /** The toolkit's strings in this language: the table's, else its own, else English. */
  private table(): Record<string, string> {
    return TABLES[this.lang] ?? TABLES[this.lang.slice(0, 2)] ?? en;
  }

  has(key: string): boolean {
    return key in this.table() || key in en;
  }

  t(key: string, vars?: Record<string, string | number>): string {
    const raw = this.tr?.lookup("toolkit", key, this.lang) ?? this.table()[key] ?? en[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
  }

  /** Resolves a key, a literal string (translated by the table), or a `{en, ru}` map. */
  text(value: LocalizedText | undefined, fallback = "", type: RowType = "text"): string {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "string") {
      if (this.has(value)) return this.t(value);
      return this.tr ? this.tr.text(value, this.lang, type) : value;
    }
    return value[this.lang] ?? value.en ?? Object.values(value).find((v) => typeof v === "string") ?? fallback;
  }

  /** A speaker's name in this language. */
  name(value: string): string {
    return this.text(value, "", "name");
  }

  /** Adds or overrides strings, e.g. `{ ru: { "item.ice_rod.name": "Ледяной жезл" } }`. */
  extend(tables: Record<string, Record<string, string>>): void {
    for (const [lang, entries] of Object.entries(tables)) {
      const table = (TABLES[lang] ??= {});
      Object.assign(table, entries);
    }
  }
}
