import type { Session } from "../core/session.ts";
import type { MessageKind } from "../core/events.ts";

/** A message waiting for its box: a toolkit message, or what an NPC says (Zelda: Dialogue). */
interface Queued {
  text: string;
  kind: MessageKind | "dialogue";
  speaker: string;
  portrait: string;
  /** Answers to pick from (Zelda: Dialogue). */
  choices: string[];
  /** Called once it was shown and closed (or could not be shown), with the answer picked (0 = the first) or null. */
  done?: (picked: number | null) => void;
}

/**
 * Boxes that wait for a key, made in the UI Designer:
 * - toolkit messages (signs, "You got...") in the message screen (role Message), whose kinds say
 *   which messages it shows; the others stay short notifications;
 * - what NPCs say (Zelda: Dialogue) in the dialogue screen (role Dialogue), else in the message
 *   screen, with {speaker} and the {portrait} picture.
 * Queued one at a time; the game waits while one is open. Without a screen for it, a box message
 * is PS Maker's own dialogue, else (no dialogue in the engine) a HUD note.
 */
export class MessageBoxSystem {
  private readonly s: Session;
  private readonly queue: Queued[] = [];
  private current: { done: boolean; picked: number | null; entry: Queued } | null = null;
  private readonly off: () => void;

  constructor(session: Session) {
    this.s = session;
    this.off = session.bus.on("zelda:message", (m) => {
      if (this.accepts(m.kind)) this.queue.push({ text: m.text, kind: m.kind ?? "info", speaker: "", portrait: "", choices: [] });
    });
  }

  /** The project's screen with this role, or null. */
  private screen(role: "message" | "dialogue"): { name: string; kinds: readonly string[] } | null {
    for (const [name, layout] of this.s.toolkit.uiScreens) if (layout.screen.role === role) return { name, kinds: layout.screen.kinds };
    return null;
  }

  /** True when a message of this kind waits for a key in a box (the HUD then does not show it). */
  accepts(kind: MessageKind | undefined): boolean {
    if (kind === "box") return true;
    return !!this.screen("message")?.kinds.includes(kind ?? "info");
  }

  /** What an NPC says (Zelda: Dialogue), with answers to pick: queued like a message; `done` runs when it was closed. */
  say(text: string, speaker: string, portrait: string, choices: string[] = [], done?: (picked: number | null) => void): void {
    this.queue.push({ text, kind: "dialogue", speaker, portrait, choices, done });
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
    const shown = this.show(next);
    if (!shown) {
      this.s.hud?.note(next.speaker ? `${next.speaker}: ${next.text}` : next.text);
      next.done?.(null);
      return;
    }
    const state = { done: false, picked: null as number | null, entry: next };
    this.current = state;
    shown.then((picked) => {
      state.picked = picked;
      state.done = true;
    });
    this.setHold(true);
  }

  private show(m: Queued): Promise<number | null> | null {
    const screen = m.kind === "dialogue" ? (this.screen("dialogue") ?? this.screen("message")) : this.screen("message");
    if (screen && this.s.screens) return this.s.screens.showMessage(screen.name, m.text, { speaker: m.speaker, portrait: m.portrait }, m.choices);
    if (m.choices.length) this.s.logger.warnOnce("dialogue-choices", "Zelda: Dialogue with answers needs a dialogue box or a message box made in the UI Designer; no answer is picked.");
    return this.s.host.playDialogue?.(dialogueSourceOf(m.text, m.speaker))?.then(() => null) ?? null;
  }

  private close(): void {
    const entry = this.current?.entry;
    const picked = this.current?.picked ?? null;
    this.current = null;
    // The press that closed the message must not read the sign again in this same tick.
    this.s.host.input.reset();
    if (this.queue.length === 0) this.setHold(false);
    entry?.done?.(picked);
  }

  private setHold(on: boolean): void {
    this.s.setPaused("message", on);
    if (on) this.s.player.lock("message");
    else this.s.player.unlock("message");
  }

  dispose(): void {
    this.off();
    if (this.current) this.setHold(false);
    // A PS Maker event waiting for a Zelda: Dialogue goes on.
    const waiting = [this.current?.entry, ...this.queue];
    this.current = null;
    this.queue.length = 0;
    for (const e of waiting) e?.done?.(null);
  }
}

/**
 * A toolkit message as PS Maker dialogue source (dialogueSourceParser.ts): the speaker as an
 * `@name` command, then the text with PS Maker's syntax escaped — "Name: text" lines and "@"
 * commands get a leading backslash, markup characters (* _ { } and the backslash itself) one each —
 * so the text shows as written. A blank line still starts a new page.
 */
export function dialogueSourceOf(text: string, speaker = ""): string {
  const lines = text.split("\n").map((line) => {
    const escaped = line.replace(/[\\*_{}]/g, (c) => `\\${c}`);
    const t = escaped.trimStart();
    return t.startsWith("@") || t.indexOf(": ") > 0 ? `\\${escaped}` : escaped;
  });
  return [...(speaker ? [`@name "${speaker.replace(/["\\]/g, "")}"`] : []), ...lines].join("\n");
}
