import type { Session } from "../core/session.ts";
import type { HudItemSlot, HudModel } from "../host/types.ts";
import { digitsFor } from "./hudLayout.ts";

const MAX_MESSAGES = 3;

const COUNTER_ICONS: Record<string, string> = {
  rupees: "hud_rupee",
  bombs: "hud_bomb",
  arrows: "hud_arrow",
  keys: "hud_key",
  magic: "hud_magic",
};

/**
 * Builds a render-agnostic HUD model from game state and hands it to the
 * host's HUD sink. Re-renders only when an event changed something or a
 * message is on screen.
 */
export class HudSystem {
  readonly name = "hud";
  private readonly s: Session;
  private dirty = true;
  private boxWasOpen = false;
  private readonly messages: { text: string; remainingMs: number }[] = [];
  private readonly offAny: () => void;
  private readonly offMsg: () => void;

  constructor(session: Session) {
    this.s = session;
    this.offAny = session.bus.onAny(() => {
      this.dirty = true;
    });
    this.offMsg = session.bus.on("zelda:message", (m) => {
      if (this.s.messageBox?.accepts(m.kind)) return;
      this.messages.push({ text: m.text, remainingMs: m.durationMs });
      while (this.messages.length > MAX_MESSAGES) this.messages.shift();
    });
    session.host.hud?.setVisible(true);
  }

  markDirty(): void {
    this.dirty = true;
  }

  tick(dtMs: number): void {
    const hud = this.s.host.hud;
    if (!hud) return;
    if (this.messages.length > 0 || this.s.messageBox?.isOpen || this.boxWasOpen) {
      for (const m of this.messages) m.remainingMs -= dtMs;
      while (this.messages.length > 0 && this.messages[0].remainingMs <= 0) this.messages.shift();
      this.dirty = true;
    }
    this.boxWasOpen = !!this.s.messageBox?.isOpen;
    if (!this.dirty) return;
    this.dirty = false;
    hud.render(this.buildModel());
  }

  buildModel(): HudModel {
    const s = this.s;
    const ui = s.config.ui;
    const st = s.state;
    const inv = s.toolkit.inventory;
    const open = s.inventoryUi?.open ?? false;
    const activeId = st.inventory.activeItem;
    const slot = (id: string): HudItemSlot => {
      const def = s.toolkit.items.get(id);
      const counter = def?.counter ?? def?.resource;
      return {
        itemId: id,
        name: inv.displayName(id),
        description: inv.displayDescription(id),
        icon: def?.icon ?? `icon_${id}`,
        count: counter && counter !== "magic" ? inv.count(counter) : null,
        selected: id === activeId,
      };
    };
    const counters = ui.counters.map((id) => {
      const key = id === "keys" ? "key" : id;
      const max = id === "keys" ? 9 : inv.capacity(key);
      return {
        id,
        label: s.i18n.t(`resource.${id}`),
        icon: COUNTER_ICONS[id] ?? `icon_${id}`,
        value: inv.count(key),
        digits: Math.min(4, digitsFor(max === 9999 ? 99 : max)),
      };
    });
    return {
      visible: true,
      hp: st.player.hp,
      maxHp: st.player.maxHp,
      heartValue: s.config.player.heartValue,
      magic: st.player.magic,
      maxMagic: st.player.maxMagic,
      showHearts: ui.showHearts,
      showMagic: ui.showMagic && st.player.maxMagic > 0,
      showItem: ui.showActiveItem && s.feature("inventory"),
      activeItem: ui.showActiveItem && activeId && s.feature("inventory") ? slot(activeId) : null,
      counters,
      messages: this.messages.map((m) => ({ text: m.text, remainingMs: m.remainingMs })),
      inventoryOpen: open,
      inventoryTitle: s.i18n.t("hud.inventory"),
      inventory: open ? [...st.inventory.owned.filter((id) => s.toolkit.items.has(id)).map(slot)] : [],
      dead: s.player.isDead,
      deathText: s.i18n.t("hud.dead"),
      lifeLabel: s.i18n.t("hud.life"),
      position: ui.position.startsWith("bottom") ? "bottom" : "top",
      scale: ui.scale,
      safeArea: { ...ui.safeArea },
      fontFamily: ui.fontFamily,
      skin: { ...ui.skin },
      barSlice: ui.barSlice,
      showLifeLabel: ui.showLifeLabel,
      textColor: ui.textColor,
      box: s.messageBox?.model() ?? null,
    };
  }

  dispose(): void {
    this.offAny();
    this.offMsg();
    this.messages.length = 0;
    this.s.host.hud?.setVisible(false);
  }
}
