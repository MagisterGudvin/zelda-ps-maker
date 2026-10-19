import { en } from "../../locales/en/strings.ts";
import { ru } from "../../locales/ru/strings.ts";
import type { LocalizedText } from "../core/types.ts";

const TABLES: Record<string, Record<string, string>> = { en, ru };

/**
 * Minimal localization: key lookup with English fallback and `{var}`
 * substitution. Authors can add or override strings at runtime.
 */
export class I18n {
  private lang = "en";

  setLanguage(lang: string): void {
    if (lang === "auto") {
      const nav = typeof navigator !== "undefined" ? navigator.language : "en";
      lang = (nav || "en").slice(0, 2).toLowerCase();
    }
    this.lang = TABLES[lang] ? lang : "en";
  }

  get language(): string {
    return this.lang;
  }

  has(key: string): boolean {
    return key in (TABLES[this.lang] ?? {}) || key in en;
  }

  t(key: string, vars?: Record<string, string | number>): string {
    const raw = TABLES[this.lang]?.[key] ?? en[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
  }

  /** Resolves a key, a literal string, or a `{en, ru}` map. */
  text(value: LocalizedText | undefined, fallback = ""): string {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "string") return this.has(value) ? this.t(value) : value;
    return value[this.lang] ?? value.en ?? Object.values(value).find((v) => typeof v === "string") ?? fallback;
  }

  /** Adds or overrides strings, e.g. `{ ru: { "item.ice_rod.name": "Ледяной жезл" } }`. */
  extend(tables: Record<string, Record<string, string>>): void {
    for (const [lang, entries] of Object.entries(tables)) {
      const table = (TABLES[lang] ??= {});
      Object.assign(table, entries);
    }
  }
}
