import type { Session } from "../core/session.ts";

/**
 * Input side of the inventory: quick-item cycling and the item panel.
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
    if (input.pressed("inventory") && this.s.config.ui.inventoryPanel) this.setOpen(!this.open);
    // Cycling is blocked during other pauses (cutscenes) but allowed inside the panel.
    if (this.s.isPaused() && !this.open) return;
    if (input.pressed("nextItem")) inv.cycle(1);
    if (input.pressed("prevItem")) inv.cycle(-1);
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
