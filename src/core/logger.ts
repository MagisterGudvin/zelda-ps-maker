export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface LogSink {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Prefixed, level-filtered logger. Errors are never swallowed silently: the
 * level can hide debug/info/warn noise, but `error` is only hidden when the
 * author explicitly picks "silent".
 */
export class Logger {
  level: LogLevel = "warn";
  private readonly sink: LogSink;
  private readonly prefix: string;
  private readonly onceKeys = new Set<string>();

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
    if (this.enabled("info")) this.sink.info(this.prefix, ...args);
  }

  warn(...args: unknown[]): void {
    if (this.enabled("warn")) this.sink.warn(this.prefix, ...args);
  }

  error(...args: unknown[]): void {
    if (this.enabled("error")) this.sink.error(this.prefix, ...args);
  }

  /** Logs a warning only the first time `key` is seen (avoids per-frame spam). */
  warnOnce(key: string, ...args: unknown[]): void {
    if (this.onceKeys.has(key)) return;
    this.onceKeys.add(key);
    this.warn(...args);
  }
}
