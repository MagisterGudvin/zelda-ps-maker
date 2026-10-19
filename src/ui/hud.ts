import type { Session } from "../core/session.ts";
import type { HudItemSlot, HudModel } from "../host/types.ts";

const MAX_MESSAGES = 3;

const COUNTER_ICONS: Record<string, string> = {
  rupees: "pickup_rupee",
  bombs: "pickup_bomb",
  arrows: "pickup_arrow",
  keys: "pickup_key",
  magic: "pickup_magic",
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
  private readonly messages: { text: string; remainingMs: number }[] = [];
  private readonly offAny: () => void;
  private readonly offMsg: () => void;

  constructor(session: Session) {
    this.s = session;
    this.offAny = session.bus.onAny(() => {
      this.dirty = true;
    });
    this.offMsg = session.bus.on("zelda:message", (m) => {
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
    if (this.messages.length > 0) {
      for (const m of this.messages) m.remainingMs -= dtMs;
      while (this.messages.length > 0 && this.messages[0].remainingMs <= 0) this.messages.shift();
      this.dirty = true;
    }
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
    const counters = ui.counters.map((id) => ({
      id,
      label: s.i18n.t(`resource.${id}`),
      icon: COUNTER_ICONS[id] ?? `icon_${id}`,
      value: inv.count(id === "keys" ? "key" : id),
    }));
    return {
      visible: true,
      hp: st.player.hp,
      maxHp: st.player.maxHp,
      heartValue: s.config.player.heartValue,
      magic: st.player.magic,
      maxMagic: st.player.maxMagic,
      showHearts: ui.showHearts,
      showMagic: ui.showMagic && st.player.maxMagic > 0,
      activeItem: ui.showActiveItem && activeId && s.feature("inventory") ? slot(activeId) : null,
      counters,
      messages: this.messages.map((m) => ({ text: m.text, remainingMs: m.remainingMs })),
      inventoryOpen: open,
      inventoryTitle: s.i18n.t("hud.inventory"),
      inventory: open ? [...st.inventory.owned.filter((id) => s.toolkit.items.has(id)).map(slot)] : [],
      dead: s.player.isDead,
      deathText: s.i18n.t("hud.dead"),
      position: ui.position,
      scale: ui.scale,
      fontFamily: ui.fontFamily,
    };
  }

  dispose(): void {
    this.offAny();
    this.offMsg();
    this.messages.length = 0;
    this.s.host.hud?.setVisible(false);
  }
}
