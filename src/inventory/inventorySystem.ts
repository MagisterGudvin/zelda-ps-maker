import type { Session } from "../core/session.ts";
import { HOTBAR_ACTIONS } from "../host/types.ts";

/**
 * Input side of the inventory: quick-item cycling and the item panel (or the inventory screen made
 * in the UI Designer).
 * Runs even while the session is paused so the panel can be closed.
 */
export class InventorySystem {
  readonly name = "inventory";
  open = false;
  private readonly s: Session;

  constructor(session: Session) {
    this.s = session;
  }

  tick(_dtMs: number): void {
    const input = this.s.host.input;
    const inv = this.s.toolkit.inventory;
    // A UI screen has the keys while it is open.
    if (this.s.isPaused("screen")) return;
    if (input.pressed("inventory")) {
      // The inventory screen made in the UI Designer (role Inventory), else the built-in panel.
      const screen = this.open ? null : this.s.screens?.withRole("inventory");
      if (screen && !this.s.isPaused()) {
        this.s.screens!.open(screen);
        return;
      }
      if (this.s.config.ui.inventoryPanel) this.setOpen(!this.open);
    }
    // Cycling is blocked during other pauses (cutscenes) but allowed inside the panel.
    if (this.s.isPaused() && !this.open) return;
    if (input.pressed("nextItem")) inv.cycle(1);
    if (input.pressed("prevItem")) inv.cycle(-1);
    // Slot keys (1…9) select the item of a quick-use slot, while the HUD has Slot elements.
    const slots = this.s.hud?.layout().elements.filter((e) => e.type === "slot") ?? [];
    for (const e of slots) {
      if (e.type !== "slot" || !input.pressed(HOTBAR_ACTIONS[e.index - 1])) continue;
      const id = inv.quickItems()[e.index - 1];
      if (id) inv.equip(id);
    }
  }

  setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    if (this.s.config.ui.pauseWhileInventoryOpen) this.s.setPaused("inventory", open);
    this.s.hud?.markDirty();
    this.s.bus.emit("zelda:inventory:toggled", { open });
  }

  dispose(): void {
    if (this.open) this.s.setPaused("inventory", false);
    this.open = false;
  }
}
