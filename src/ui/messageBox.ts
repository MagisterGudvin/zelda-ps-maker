import type { Session } from "../core/session.ts";
import type { MessageKind } from "../core/events.ts";

/**
 * Toolkit messages (signs, "You got...") in the project's message screen: a UI Layout screen with
 * the role Message, made in the UI Designer, whose texts show {message}. Its kinds say which
 * messages it shows; the others stay short HUD notes. Queued one at a time; the game waits while
 * one is open. "Show Message" as a box always waits for a key: in the message screen, else in
 * PS Maker's own dialogue, else (no dialogue in the engine) as a HUD note.
 */
export class MessageBoxSystem {
  private readonly s: Session;
  private readonly queue: { text: string; kind: MessageKind }[] = [];
  private current: { done: boolean } | null = null;
  private readonly off: () => void;

  constructor(session: Session) {
    this.s = session;
    this.off = session.bus.on("zelda:message", (m) => {
      if (this.accepts(m.kind)) this.queue.push({ text: m.text, kind: m.kind ?? "info" });
    });
  }

  /** The message screen of the project (role Message), or null. */
  private screen(): { name: string; kinds: readonly string[] } | null {
    for (const [name, layout] of this.s.toolkit.uiScreens) if (layout.screen.role === "message") return { name, kinds: layout.screen.kinds };
    return null;
  }

  /** True when a message of this kind waits for a key in a box (the HUD then does not show it). */
  accepts(kind: MessageKind | undefined): boolean {
    if (kind === "box") return true;
    return !!this.screen()?.kinds.includes(kind ?? "info");
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  /** Runs every tick, also while the game is paused. */
  tick(): void {
    if (this.current) {
      if (this.current.done) this.close();
      return;
    }
    const next = this.queue.shift();
    if (next === undefined) return;
    const screen = this.screen();
    const shown = screen && this.s.screens ? this.s.screens.showMessage(screen.name, next.text) : this.s.host.playDialogue?.(dialogueSourceOf(next.text));
    if (!shown) {
      this.s.hud?.note(next.text);
      return;
    }
    const state = { done: false };
    this.current = state;
    shown.then(() => (state.done = true));
    this.setHold(true);
  }

  private close(): void {
    this.current = null;
    // The press that closed the message must not read the sign again in this same tick.
    this.s.host.input.reset();
    if (this.queue.length === 0) this.setHold(false);
  }

  private setHold(on: boolean): void {
    this.s.setPaused("message", on);
    if (on) this.s.player.lock("message");
    else this.s.player.unlock("message");
  }

  dispose(): void {
    this.off();
    if (this.current) this.setHold(false);
    this.current = null;
    this.queue.length = 0;
  }
}

/**
 * A toolkit message as PS Maker dialogue source (dialogueSourceParser.ts): the text with PS Maker's
 * syntax escaped — "Name: text" lines and "@" commands get a leading backslash, markup characters
 * (* _ { } and the backslash itself) one each — so the text shows as written. A blank line still
 * starts a new page.
 */
export function dialogueSourceOf(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const escaped = line.replace(/[\\*_{}]/g, (c) => `\\${c}`);
      const t = escaped.trimStart();
      return t.startsWith("@") || t.indexOf(": ") > 0 ? `\\${escaped}` : escaped;
    })
    .join("\n");
}
