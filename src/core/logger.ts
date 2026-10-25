export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface LogSink {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface LogEntry {
  level: Exclude<LogLevel, "silent">;
  text: string;
}

const HISTORY_SIZE = 40;

/** Formats log arguments into one short line for the on-screen diagnostics panel. */
export function formatLogArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ")
    .slice(0, 300);
}

/**
 * Prefixed, level-filtered logger. Errors are never swallowed silently: the
 * level can hide debug/info/warn noise, but `error` is only hidden when the
 * author explicitly picks "silent".
 */
export class Logger {
  level: LogLevel = "warn";
  /**
   * Recent info/warn/error lines, kept regardless of `level`, so the in-game
   * diagnostics panel (F10) can show them when the browser console is not
   * reachable (e.g. inside the PS Maker editor).
   */
  readonly history: LogEntry[] = [];
  private readonly sink: LogSink;
  private readonly prefix: string;
  private readonly onceKeys = new Set<string>();

  private remember(level: LogEntry["level"], args: unknown[]): void {
    this.history.push({ level, text: formatLogArgs(args) });
    if (this.history.length > HISTORY_SIZE) this.history.shift();
  }

  constructor(prefix = "[ZeldaMakerToolkit]", sink: LogSink = console) {
    this.prefix = prefix;
    this.sink = sink;
  }

  private enabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  debug(...args: unknown[]): void {
    if (this.enabled("debug")) this.sink.debug(this.prefix, ...args);
  }

  info(...args: unknown[]): void {
    this.remember("info", args);
    if (this.enabled("info")) this.sink.info(this.prefix, ...args);
  }

  warn(...args: unknown[]): void {
    this.remember("warn", args);
    if (this.enabled("warn")) this.sink.warn(this.prefix, ...args);
  }

  error(...args: unknown[]): void {
    this.remember("error", args);
    if (this.enabled("error")) this.sink.error(this.prefix, ...args);
  }

  /** Stores a line for the diagnostics panel without printing it (used for errors captured from the page). */
  record(level: LogEntry["level"], text: string): void {
    this.remember(level, [text]);
  }

  /** Logs a warning only the first time `key` is seen (avoids per-frame spam). */
  warnOnce(key: string, ...args: unknown[]): void {
    if (this.onceKeys.has(key)) return;
    this.onceKeys.add(key);
    this.warn(...args);
  }
}
