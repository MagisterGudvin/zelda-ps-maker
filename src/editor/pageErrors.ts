import { formatLogArgs, type Logger } from "../core/logger.ts";

/**
 * Mirrors errors raised outside the toolkit (uncaught errors, unhandled
 * promise rejections, console.error) into the diagnostics history. If PS Maker
 * fails while preparing an action's parameters, the action never reaches the
 * plugin; this is the only way to see why when the browser console is not
 * reachable from the editor's playtest. Pass-through only: nothing is
 * swallowed, console.error still prints as before.
 */
let target: Logger | null = null;
let installed = false;

function note(what: string, args: unknown[]): void {
  if (!target) return;
  const text = formatLogArgs(args);
  if (text.includes("[ZeldaMakerToolkit]")) return; // our own logger output
  target.record("error", `${what}: ${text}`);
}

export function capturePageErrors(logger: Logger): void {
  target = logger;
  if (installed) return;
  installed = true;
  const g = globalThis as any;
  if (typeof g.addEventListener === "function") {
    g.addEventListener("error", (e: any) => note("Page error", [e?.error ?? e?.message ?? "unknown"]));
    g.addEventListener("unhandledrejection", (e: any) => note("Unhandled rejection", [e?.reason ?? "unknown"]));
  }
  const c = g.console;
  if (c && typeof c.error === "function") {
    const original = c.error;
    c.error = function (this: unknown, ...args: unknown[]) {
      try {
        note("console.error", args);
      } catch {
        // never let diagnostics break logging
      }
      return original.apply(this, args);
    };
  }
}
