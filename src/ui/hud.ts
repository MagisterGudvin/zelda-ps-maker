import type { Session } from "../core/session.ts";
import type { HudItemSlot, HudModel } from "../host/types.ts";
import { PAD_ACTIONS, padButtonLabel, type PadAction } from "../host/gamepadBridge.ts";
import { keyLabel } from "./keyLabels.ts";
import type { Translator } from "../core/translations.ts";
import { classicLayout, isShown, layoutBindings, type LayoutValues, type MinimapData, type UiLayout } from "./uiLayout.ts";

const MAX_MESSAGES = 3;

/**
 * Builds a render-agnostic HUD model from game state and hands it to the
 * host's HUD sink. Re-renders only when an event changed something or a
 * message is on screen.
 */
export class HudSystem {
  readonly name = "hud";
  private readonly s: Session;
  private dirty = true;
  private readonly messages: { text: string; remainingMs: number }[] = [];
  private readonly offAny: () => void;
  private readonly offMsg: () => void;

  constructor(session: Session) {
    this.s = session;
    this.offAny = session.bus.onAny(() => {
      this.dirty = true;
    });
    this.offMsg = session.bus.on("zelda:message", (m) => {
      if (!this.s.messageBox?.accepts(m.kind)) this.note(m.text, m.durationMs);
    });
    session.host.hud?.setVisible(true);
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** A short message note in the HUD. */
  note(text: string, durationMs = this.s.config.ui.messageMs): void {
    this.messages.push({ text, remainingMs: durationMs });
    while (this.messages.length > MAX_MESSAGES) this.messages.shift();
    this.dirty = true;
  }

  tick(dtMs: number): void {
    const hud = this.s.host.hud;
    if (!hud) return;
    // Project variables change without toolkit events (a few redraws a second do); effects move every
    // tick, a minimap follows the player at 20 frames a second.
    const live = this.liveness();
    this.ticks++;
    if ((live.effects && this.effectShown()) || (live.minimap && this.ticks % 3 === 0) || (live.vars && this.ticks % 15 === 0)) this.dirty = true;
    // Key prompts follow the device the player used last.
    const device = s0(this.s.host.input.device);
    if (device !== this.deviceSeen) {
      this.deviceSeen = device;
      this.dirty = true;
    }
    if (this.messages.length > 0) {
      for (const m of this.messages) m.remainingMs -= dtMs;
      while (this.messages.length > 0 && this.messages[0].remainingMs <= 0) this.messages.shift();
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    hud.render(this.buildModel());
  }

  private ticks = 0;
  private deviceSeen = "";

  private readonly live = new WeakMap<UiLayout, { vars: boolean; effects: boolean; minimap: boolean }>();

  /** What makes the shown layouts change without toolkit events. */
  private liveness(): { vars: boolean; effects: boolean; minimap: boolean } {
    const out = { vars: false, effects: false, minimap: false };
    for (const l of this.shownLayouts()) {
      let f = this.live.get(l);
      if (!f) {
        f = { vars: [...layoutBindings(l)].some((k) => k.startsWith("var:")), effects: l.elements.some((e) => e.effect !== "none"), minimap: l.elements.some((e) => e.type === "minimap") };
        this.live.set(l, f);
      }
      out.vars ||= f.vars;
      out.effects ||= f.effects;
      out.minimap ||= f.minimap;
    }
    return out;
  }

  /** An element with an effect is on screen now (effects redraw the HUD every tick only then). */
  private effectShown(): boolean {
    return this.shownLayouts().some((l) => {
      const fx = l.elements.filter((e) => e.effect !== "none");
      if (!fx.length) return false;
      const values = this.values(l);
      return fx.some((e) => isShown(e, values));
    });
  }

  private shownLayouts(): UiLayout[] {
    const sc = this.s.screens;
    return [this.layout(), ...(sc?.layers ?? []).map((l) => l.layout), ...(sc?.current ? [sc.current.layout] : [])];
  }

  /** The world around the player for minimaps: the map's walls, live enemies and solid objects. */
  private minimapData(): MinimapData | null {
    if (!this.liveness().minimap) return null;
    const s = this.s;
    const dots: MinimapData["dots"][number][] = [];
    for (const e of s.world.list("enemy")) if (e.alive && !e.removed) dots.push({ x: e.x, y: e.y, kind: "enemy" });
    for (const e of s.world.list("object")) if (!e.removed && e.solid) dots.push({ x: e.x, y: e.y, kind: "object" });
    return { x: s.player.box.x, y: s.player.box.y, walls: s.host.mapWalls?.() ?? [], dots };
  }

  /** The layout the HUD shows: the designer's (Zelda: UI Layout) or the classic one. */
  layout(): UiLayout {
    const own = this.s.toolkit.hudLayout;
    if (own) return own;
    // The magic meter only once the player has magic.
    const magic = this.s.state.player.maxMagic > 0;
    if (this.classic?.magic !== magic) this.classic = { magic, layout: classicLayout({ magic }) };
    return this.classic.layout;
  }

  private classic: { magic: boolean; layout: UiLayout } | null = null;

  /** The values a layout shows, from the toolkit state and the project variables. */
  values(layout: UiLayout): LayoutValues {
    const s = this.s;
    const st = s.state;
    const out: LayoutValues = {};
    for (const key of layoutBindings(layout)) {
      if (key.startsWith("var:")) {
        const v = s.host.getVariable?.(key.slice(4));
        out[key] = typeof v === "boolean" ? (v ? 1 : 0) : (v ?? 0);
      } else if (key.startsWith("t:")) out[key] = s.i18n.t(key.slice(2));
      else if (key === "heartValue") out[key] = s.config.player.heartValue;
      else if (key === "language") out[key] = s.i18n.languageName();
      else if (key === "magic") out[key] = st.player.magic;
      else if (key === "maxMagic") out[key] = st.player.maxMagic;
      else if (key === "dialogue") out[key] = s.isPaused("dialogue") || s.isPaused("message") ? 1 : 0;
      else if (key === "item.icon") out[key] = st.inventory.activeItem && s.feature("inventory") ? this.iconOf(st.inventory.activeItem, layout) : "";
      else if (key === "item.count") out[key] = s.statValue("itemCount");
      else if (key.startsWith("key:")) out[key] = this.keyPrompt(key.slice(4));
      else if (key === "item2.icon" || key === "item2.count") {
        const id = st.inventory.secondItem;
        out[key] = !id || !s.feature("inventory") ? "" : key === "item2.icon" ? this.iconOf(id, layout) : (this.countOf(id) ?? "");
      }
      else if (key === "message" || key === "message.ready" || key === "message.more" || key === "speaker" || key === "portrait") {
        // The message or dialogue screen: its text as typed so far, whether it waits for a key, more pages, who speaks.
        const m = s.screens?.messageView() ?? { text: "", ready: false, more: false, speaker: "", portrait: "" };
        out[key] = key === "message" ? m.text : key === "message.ready" ? (m.ready ? 1 : 0) : key === "message.more" ? (m.more ? 1 : 0) : key === "speaker" ? m.speaker : m.portrait;
      } else if (key === "note") out[key] = ""; else if (key.startsWith("inv.")) {
        // The item under an inventory screen's cursor.
        const id = s.screens?.cursorItem() ?? null;
        out[key] = !id ? "" : key === "inv.name" ? s.toolkit.inventory.displayName(id) : key === "inv.description" ? s.toolkit.inventory.displayDescription(id) : (this.countOf(id) ?? "");
      } else if (key.startsWith("slot.")) {
        // slot.<n>.icon / slot.<n>.sel: the n-th quick-use item.
        const [, n, what] = key.split(".");
        const id = s.toolkit.inventory.quickItems()[Number(n) - 1];
        out[key] = what === "sel" ? (id && id === st.inventory.activeItem ? 1 : 0) : id && s.feature("inventory") ? this.iconOf(id, layout) : "";
      }
      else out[key] = s.statValue(key);
    }
    return out;
  }

  /**
   * A layout as it reads in the game's language (Zelda: Translations): its texts translated, its
   * pictures swapped for the language's, its texts in the language's font. The same layout when
   * there is nothing to change.
   */
  private translated(layout: UiLayout): UiLayout {
    const i18n = this.s.i18n;
    const tr = i18n.translator;
    if (!tr) return layout;
    const lang = i18n.language;
    const font = tr.lang(lang)?.font ?? "";
    if (lang === tr.source && !font) return layout;
    const cached = this.translations.get(layout);
    if (cached?.lang === lang && cached.tr === tr) return cached.layout;
    const out: UiLayout = {
      ...layout,
      theme: font ? { ...layout.theme, font } : layout.theme,
      elements: layout.elements.map((e) => {
        if (e.type === "text" || e.type === "button") return { ...e, text: tr.text(e.text, lang), ...(font ? { font } : {}), ...(e.type === "button" && e.image ? { image: tr.image(e.image, lang), hover: e.hover && tr.image(e.hover, lang) } : {}) };
        if (e.type === "bar") return { ...e, text: tr.text(e.text, lang) };
        if (e.type === "image" && e.image && !e.image.includes("{")) return { ...e, image: tr.image(e.image, lang) };
        return e;
      }),
    };
    this.translations.set(layout, { lang, tr, layout: out });
    return out;
  }

  private readonly translations = new WeakMap<UiLayout, { lang: string; tr: Translator; layout: UiLayout }>();

  /** The project's notification screen (role Notification), or null: it shows each note. */
  private notification(): { name: string; layout: UiLayout } | null {
    for (const [name, layout] of this.s.toolkit.uiScreens) if (layout.screen.role === "notification") return { name, layout };
    return null;
  }

  /**
   * A key prompt ({key:sword}): the key bound to a toolkit action, or its gamepad button — named the
   * Xbox, PlayStation or Nintendo way — when the gamepad was used last. Directions: up, down, left, right.
   */
  private keyPrompt(action: string): string {
    const s = this.s;
    const c = s.config.controls;
    const device = s.host.input.device;
    const dirs: Record<string, [string[], number]> = { up: [c.move.up, 12], down: [c.move.down, 13], left: [c.move.left, 14], right: [c.move.right, 15] };
    const own = (PAD_ACTIONS as readonly string[]).includes(action) ? ([c[action as PadAction], c.gamepad[action as PadAction]] as [string[], number]) : dirs[action];
    if (!own) return "";
    if (device?.kind === "gamepad") return padButtonLabel(own[1], device.family);
    return keyLabel(own[0][0], s.i18n);
  }

  /** The ammunition count an item shows (bombs, arrows), or null. */
  private countOf(id: string): number | null {
    const def = this.s.toolkit.items.get(id);
    const counter = def?.counter ?? def?.resource;
    return counter && counter !== "magic" ? this.s.toolkit.inventory.count(counter) : null;
  }

  /** An item's icon: the layout theme's picture for it, its own (Define Item), or the built-in one. */
  private iconOf(id: string, layout: UiLayout): string {
    return layout.theme.icons[id] || (this.s.toolkit.items.get(id)?.icon ?? `icon_${id}`);
  }

  buildModel(): HudModel {
    const s = this.s;
    const st = s.state;
    const inv = s.toolkit.inventory;
    const open = s.inventoryUi?.open ?? false;
    const activeId = st.inventory.activeItem;
    const layout = this.layout();
    const note = this.notification();
    const slot = (id: string): HudItemSlot => ({
      itemId: id,
      name: inv.displayName(id),
      description: inv.displayDescription(id),
      icon: this.iconOf(id, layout),
      count: this.countOf(id),
      selected: id === activeId,
    });
    return {
      visible: true,
      layout: this.translated(layout),
      values: this.values(layout),
      fonts: s.toolkit.uiFonts,
      scale: s.config.ui.scale,
      mapZoom: s.host.mapZoom?.() ?? 0,
      // With a notification screen (UI Designer) the notes are drawn by it, else by the HUD's own box.
      messages: note ? [] : this.messages.map((m) => ({ text: m.text, remainingMs: m.remainingMs })),
      inventoryOpen: open,
      inventoryTitle: s.i18n.t("hud.inventory"),
      inventory: open ? [...st.inventory.owned.filter((id) => s.toolkit.items.has(id)).map(slot)] : [],
      dead: s.player.isDead,
      deathText: s.i18n.t("hud.dead"),
      hudHidden: s.screens?.titleOpen ?? false,
      screen: (() => {
        const cur = s.screens?.current;
        if (!cur) return null;
        const grid = cur.layout.elements.some((e) => e.type === "inventory");
        const inventory = grid ? { cells: s.screens!.gridItems().map((id) => ({ icon: this.iconOf(id, cur.layout), count: this.countOf(id) })), cursor: cur.cursor } : null;
        const view = s.screens!.messageView();
        const choices = view.choices.length ? { items: view.choices, cursor: view.choice } : null;
        const keybinds = s.screens!.keybindsView();
        // While a key bindings row is selected no button is.
        return { name: cur.name, layout: this.translated(cur.layout), values: this.values(cur.layout), focus: keybinds && keybinds.row >= 0 ? "" : cur.focus, inventory, choices, keybinds };
      })(),
      layers: [
        ...(s.screens?.layers ?? []).map((l) => ({ name: l.name, layout: this.translated(l.layout), values: this.values(l.layout) })),
        ...(note ? this.messages.map((m, i) => ({ name: note.name, layout: this.translated(note.layout), values: { ...this.values(note.layout), note: m.text }, stack: i })) : []),
      ],
      time: s.tick * (1000 / s.config.world.fixedStepHz),
      minimap: this.minimapData(),
    };
  }

  dispose(): void {
    this.offAny();
    this.offMsg();
    this.messages.length = 0;
    this.s.host.hud?.setVisible(false);
  }
}

const s0 = (d: { kind: string; family: string } | undefined) => (d ? `${d.kind}/${d.family}` : "");

