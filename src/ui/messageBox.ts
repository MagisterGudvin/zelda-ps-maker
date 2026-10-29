import type { Session } from "../core/session.ts";
import type { MessageKind } from "../core/events.ts";

/** Zelda: Message Style. Without it every toolkit message is a short note in the HUD. */
export interface MessageBoxSettings {
  /** Dialogue layout id ("" = the project's default layout). */
  layoutId: string;
  /** Message kinds shown as a dialogue ("box" = Show Message with "As a dialogue" always is). */
  kinds: MessageKind[];
}

/**
 * Toolkit messages (signs, "You got...") as PS Maker's own Dialogue: queued one at a time; the game
 * waits while one is open. Where the engine cannot show a dialogue, the message is a HUD note.
 */
export class MessageBoxSystem {
  private readonly s: Session;
  private readonly queue: string[] = [];
  private current: { done: boolean } | null = null;
  private readonly off: () => void;

  constructor(session: Session) {
    this.s = session;
    this.off = session.bus.on("zelda:message", (m) => {
      if (this.accepts(m.kind)) this.queue.push(m.text);
    });
  }

  /** True when a message of this kind is shown as a dialogue (the HUD then does not show it). */
  accepts(kind: MessageKind | undefined): boolean {
    const st = this.s.toolkit.messageBox;
    if (kind === "box") return true;
    return !!st && st.kinds.includes(kind ?? "info");
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
    const text = this.queue.shift();
    if (text === undefined) return;
    const shown = this.s.host.playDialogue?.(dialogueSourceOf(text, this.s.toolkit.messageBox?.layoutId ?? ""));
    if (!shown) {
      this.s.hud?.note(text);
      return;
    }
    const state = { done: false };
    this.current = state;
    shown.then(() => (state.done = true));
    this.setHold(true);
  }

  private close(): void {
    this.current = null;
    // The press that closed the dialogue must not read the sign again in this same tick.
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
 * A toolkit message as PS Maker dialogue source (dialogueSourceParser.ts): the chosen layout as a
 * command, then the text with PS Maker's syntax escaped — "Name: text" lines and "@" commands get a
 * leading backslash, markup characters (* _ { } and the backslash itself) one each — so the text
 * shows as written. A blank line still starts a new page.
 */
export function dialogueSourceOf(text: string, layoutId = ""): string {
  const lines = text.split("\n").map((line) => {
    const escaped = line.replace(/[\\*_{}]/g, (c) => `\\${c}`);
    const t = escaped.trimStart();
    return t.startsWith("@") || t.indexOf(": ") > 0 ? `\\${escaped}` : escaped;
  });
  return [...(layoutId ? [`@dialogue_layout ${layoutId}`] : []), ...lines].join("\n");
}
