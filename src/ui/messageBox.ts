import type { Session } from "../core/session.ts";
import type { MessageKind } from "../core/events.ts";
import type { MessageBoxModel, MessageBoxStyle } from "../host/types.ts";
import { fontFamilyCss, type PsStory } from "../host/psmakerAssets.ts";

/** Zelda: Message Style. Without it every toolkit message is a short note in the HUD. */
export interface MessageBoxSettings {
  /** Message kinds shown in the box ("box" = Show Message with "In a dialogue box" is always). */
  kinds: MessageKind[];
  typing: boolean;
  waitForKey: boolean;
  pause: boolean;
  position: "bottom" | "top";
  style: MessageBoxStyle;
}

/** Characters per second when the layout has no typing speed. */
const DEFAULT_CPS = 42;
/** A box that does not wait for a key stays at least this long after the text is out. */
const MIN_READ_MS = 1200;

/** The look of the classic toolkit box, used when the project has no dialogue layout. */
export const CLASSIC_STYLE: MessageBoxStyle = {
  logicalW: 1280,
  logicalH: 720,
  width: 896,
  height: 200,
  gap: 14,
  padding: { top: 24, right: 27, bottom: 24, left: 27 },
  background: { type: "plain", color: "#101030", opacity: 92, borderColor: "#f0f0f0", borderWidth: 4, borderRadius: 8 },
  text: { fontFamily: "monospace", size: 40, color: "#ffffff", lineHeight: 125, strokeWidth: 0, strokeColor: "#000000", align: "left" },
  typingSpeed: DEFAULT_CPS,
  caretColor: "#ffffff",
};

type Raw = Record<string, any>;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" && v ? v : d);

/**
 * A dialogue layout of the project (gameUI.dialogLayouts, chosen by id; "" = the project's
 * default) as the look of the toolkit box: the text box size, padding, background (colour or
 * picture) and text style, in the game's logical UI pixels (gameConfig width × height).
 */
export function styleFromLayout(story: (PsStory & Raw) | null, layoutId: string): MessageBoxStyle {
  const ui = story?.gameUI as Raw | undefined;
  const layouts: Raw[] = Array.isArray(ui?.dialogLayouts) ? ui.dialogLayouts : [];
  const layout = layouts.find((l) => l?.id === (layoutId || ui?.defaultDialogLayoutId)) ?? layouts[0];
  if (!layout?.textBox) return { ...CLASSIC_STYLE };
  const box = layout.textBox as Raw;
  const t = (box.textStyles ?? {}) as Raw;
  const bg = (box.background ?? {}) as Raw;
  const pad = (box.padding ?? {}) as Raw;
  const background: MessageBoxStyle["background"] =
    bg.type === "plain" || !bg.imageId
      ? { type: "plain", color: str(bg.backgroundColor, "#000000"), opacity: num(bg.backgroundOpacity, 100), borderColor: str(bg.borderColor, "#ffffff"), borderWidth: num(bg.borderWidth, 0), borderRadius: num(bg.borderRadius, 0) }
      : {
          type: "image",
          imageId: bg.imageId,
          opacity: num(bg.backgroundOpacity, 100),
          mode: bg.type === "nine-slice" ? "nine-slice" : bg.scalingMode === "nine-slice" ? "nine-slice" : bg.scalingMode === "fit" ? "fit" : "stretch",
          slice: { top: num(bg.slice?.top, 8), right: num(bg.slice?.right, 8), bottom: num(bg.slice?.bottom, 8), left: num(bg.slice?.left, 8) },
          borderWidth: num(bg.borderWidth, 26),
        };
  return {
    logicalW: num(story?.gameConfig?.width, 1280),
    logicalH: num(story?.gameConfig?.height, 720),
    width: num(box.width, 896),
    height: num(box.height, 252),
    gap: num(layout.bottomGap, 14),
    padding: { top: num(pad.top, 27), right: num(pad.right, 27), bottom: num(pad.bottom, 27), left: num(pad.left, 27) },
    background,
    text: {
      fontFamily: fontFamilyCss(story, typeof t.fontAssetId === "string" ? t.fontAssetId : "", str(t.fontFamily, "sans-serif")),
      size: num(t.fontSize, 41),
      color: str(t.color, "#ffffff"),
      lineHeight: num(t.lineHeightPercent, 120),
      strokeWidth: num(t.strokeWidth, 0),
      strokeColor: str(t.strokeColor, "#000000"),
      align: t.textAlign === "center" || t.textAlign === "right" ? t.textAlign : "left",
    },
    typingSpeed: num(layout.typingSpeed, DEFAULT_CPS),
    caretColor: str(layout.caret?.appearance?.color, str(t.color, "#ffffff")),
  };
}

/**
 * Toolkit messages in a dialogue box (A Link to the Past style): queued one at a time, typed
 * letter by letter, closed with the action key; the game waits while one is open.
 */
export class MessageBoxSystem {
  private readonly s: Session;
  private readonly queue: string[] = [];
  private current: { text: string; shown: number; readMs: number; fresh: boolean } | null = null;
  private readonly off: () => void;

  constructor(session: Session) {
    this.s = session;
    this.off = session.bus.on("zelda:message", (m) => {
      if (this.accepts(m.kind)) this.queue.push(m.text);
    });
  }

  private get settings(): MessageBoxSettings | null {
    return this.s.toolkit.messageBox;
  }

  /** True when a message of this kind goes into the box (the HUD then does not show it). */
  accepts(kind: MessageKind | undefined): boolean {
    const st = this.settings;
    if (kind === "box") return true;
    return !!st && st.kinds.includes(kind ?? "info");
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  /** Runs every tick, also while the game is paused. */
  tick(dtMs: number): void {
    const st = this.settings;
    if (!this.current) {
      const text = this.queue.shift();
      if (text === undefined) return;
      this.current = { text, shown: st?.typing === false ? text.length : 0, readMs: 0, fresh: true };
      this.setHold(true);
      return;
    }
    const c = this.current;
    const all = c.shown >= c.text.length;
    // The press that opened the box (reading a sign) does not close it.
    const press = !c.fresh && this.s.host.input.pressed("action");
    c.fresh = false;
    if (!all) {
      c.shown = press ? c.text.length : Math.min(c.text.length, c.shown + ((st?.style.typingSpeed ?? DEFAULT_CPS) * dtMs) / 1000);
      return;
    }
    c.readMs += dtMs;
    const waits = st?.waitForKey !== false;
    if (waits ? press : c.readMs >= Math.max(MIN_READ_MS, this.s.config.ui.messageMs)) this.close();
  }

  private close(): void {
    this.current = null;
    if (this.queue.length === 0) this.setHold(false);
  }

  private setHold(on: boolean): void {
    if (this.settings?.pause === false && on) return;
    this.s.setPaused("message", on);
    if (on) this.s.player.lock("message");
    else this.s.player.unlock("message");
  }

  model(): MessageBoxModel | null {
    const c = this.current;
    if (!c) return null;
    const st = this.settings;
    const shown = Math.floor(c.shown);
    return {
      text: c.text,
      shown,
      waiting: shown >= c.text.length && st?.waitForKey !== false,
      position: st?.position ?? "bottom",
      style: st?.style ?? CLASSIC_STYLE,
    };
  }

  dispose(): void {
    this.off();
    if (this.current) this.setHold(false);
    this.current = null;
    this.queue.length = 0;
  }
}
