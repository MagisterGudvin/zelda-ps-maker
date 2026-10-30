import type { Toolkit } from "../core/toolkit.ts";
import { getDungeon } from "../core/state.ts";
import { changeHealth, changeMagic, setMaxHealth } from "../player/health.ts";

export interface GiveOptions {
  /** Do not show the "You got ..." message. */
  silent?: boolean;
}

/** Stackable resources and the item that becomes owned with them. */
const RESOURCE_UNLOCKS: Record<string, string> = { bombs: "bomb" };

/**
 * Inventory model operating on the persistent `GameState`. Works without a
 * bound map (chests rewarded from rules, save loading, scripts).
 */
export class Inventory {
  private readonly tk: Toolkit;

  constructor(tk: Toolkit) {
    this.tk = tk;
  }

  private get inv() {
    return this.tk.state.inventory;
  }

  /** A resource is anything stored as a count. */
  isResource(id: string): boolean {
    return id === "rupees" || id === "bombs" || id === "arrows" || id in this.tk.config.inventory.capacities || this.tk.items.get(id)?.stackable === true;
  }

  capacity(id: string): number {
    return this.inv.capacities[id] ?? this.tk.config.inventory.capacities[id] ?? 9999;
  }

  setCapacity(id: string, value: number): void {
    this.inv.capacities[id] = Math.max(0, Math.round(value));
    const cur = this.inv.counts[id] ?? 0;
    if (cur > this.inv.capacities[id]) this.setCount(id, this.inv.capacities[id]);
  }

  count(id: string): number {
    const s = this.tk.state;
    switch (id) {
      case "magic":
        return s.player.magic;
      case "hp":
      case "heart":
        return s.player.hp;
      case "key":
      case "keys":
        return getDungeon(s, s.currentDungeon).keys;
      case "big_key":
        return getDungeon(s, s.currentDungeon).bigKey ? 1 : 0;
      case "map":
        return getDungeon(s, s.currentDungeon).map ? 1 : 0;
      case "compass":
        return getDungeon(s, s.currentDungeon).compass ? 1 : 0;
      default:
        if (this.isResource(id)) return this.inv.counts[id] ?? 0;
        return this.inv.owned.includes(id) ? 1 : 0;
    }
  }

  has(id: string, amount = 1): boolean {
    return this.count(id) >= amount;
  }

  owns(id: string): boolean {
    return this.inv.owned.includes(id);
  }

  /** Adds an item or resource; returns the amount actually applied. */
  give(id: string, count = 1, options: GiveOptions = {}): number {
    const tk = this.tk;
    const s = tk.state;
    const n = Math.max(0, Math.round(count));
    if (n === 0 && id !== "heart_container") return 0;
    let applied = 0;
    switch (id) {
      case "heart":
        applied = changeHealth(tk, n * tk.config.player.heartValue);
        break;
      case "heart_container":
        setMaxHealth(tk, s.player.maxHp + tk.config.player.heartValue * Math.max(1, n), true);
        applied = Math.max(1, n);
        break;
      case "magic":
        applied = changeMagic(tk, n);
        break;
      case "key":
      case "keys": {
        const d = getDungeon(s, s.currentDungeon);
        d.keys += n;
        applied = n;
        tk.bus.emit("zelda:resource:changed", { resource: "keys", value: d.keys, max: 99 });
        break;
      }
      case "big_key":
      case "map":
      case "compass": {
        const d = getDungeon(s, s.currentDungeon);
        if (id === "big_key") d.bigKey = true;
        else if (id === "map") d.map = true;
        else d.compass = true;
        applied = 1;
        tk.bus.emit("zelda:resource:changed", { resource: id, value: 1, max: 1 });
        break;
      }
      default:
        if (this.isResource(id)) {
          const before = this.inv.counts[id] ?? 0;
          this.setCount(id, before + n);
          applied = (this.inv.counts[id] ?? 0) - before;
          const unlock = RESOURCE_UNLOCKS[id];
          if (unlock && n > 0) this.addOwned(unlock);
        } else {
          // Already-owned items apply 0 but still emit `item:collected` below.
          applied = this.addOwned(id) ? 1 : 0;
        }
    }
    tk.bus.emit("zelda:item:collected", { itemId: id, count: n, total: this.count(id) });
    if (!options.silent && (applied > 0 || id === "heart_container")) {
      const name = this.displayName(id);
      const text = n > 1 ? tk.i18n.t("msg.got_item_count", { item: name, count: n }) : tk.i18n.t("msg.got_item", { item: name });
      tk.bus.emit("zelda:message", { text, durationMs: tk.config.ui.messageMs, kind: this.isResource(id) ? "info" : "item" });
    }
    return applied;
  }

  /** Spends a resource; returns false (and changes nothing) if there is not enough. */
  spend(id: string, count = 1): boolean {
    const n = Math.max(0, Math.round(count));
    if (n === 0) return true;
    if (!this.has(id, n)) return false;
    const s = this.tk.state;
    switch (id) {
      case "magic":
        changeMagic(this.tk, -n);
        return true;
      case "key":
      case "keys": {
        const d = getDungeon(s, s.currentDungeon);
        d.keys -= n;
        this.tk.bus.emit("zelda:resource:changed", { resource: "keys", value: d.keys, max: 99 });
        return true;
      }
      default:
        if (!this.isResource(id)) return false;
        this.setCount(id, (this.inv.counts[id] ?? 0) - n);
        return true;
    }
  }

  /** Removes an owned item (and unequips it). */
  remove(id: string): boolean {
    const idx = this.inv.owned.indexOf(id);
    if (idx < 0) return false;
    this.inv.owned.splice(idx, 1);
    this.unassign(id);
    return true;
  }

  /** Puts an item on the first item button (useItem, C). */
  equip(id: string | null): boolean {
    return this.assign(1, id);
  }

  /**
   * Puts an item on an item button: 1 = the first (useItem, C), 2 = the second (useItem2, B). An
   * item already on the other button swaps places with what this button had.
   */
  assign(slot: 1 | 2, id: string | null): boolean {
    if (id !== null && !this.quickItems().includes(id)) return false;
    const mine = slot === 1 ? "activeItem" : "secondItem";
    const other = slot === 1 ? "secondItem" : "activeItem";
    if (this.inv[mine] === id) return true;
    if (id !== null && this.inv[other] === id) {
      this.inv[other] = this.inv[mine];
      this.tk.bus.emit("zelda:item:equipped", { itemId: this.inv[other], slot: slot === 1 ? 2 : 1 });
    }
    this.inv[mine] = id;
    this.tk.bus.emit("zelda:item:equipped", { itemId: id, slot });
    return true;
  }

  /** The item on an item button. */
  slotItem(slot: 1 | 2): string | null {
    return slot === 1 ? this.inv.activeItem : this.inv.secondItem;
  }

  /** Takes an item off both buttons (removed, switched off); the first button gets the next item. */
  private unassign(id: string): void {
    if (this.inv.secondItem === id) this.assign(2, null);
    if (this.inv.activeItem === id) this.equip(this.quickItems().find((x) => x !== this.inv.secondItem) ?? null);
  }

  /** Owned items usable from the quick slot, in configured order. */
  quickItems(): string[] {
    const owned = this.inv.owned;
    const order = this.tk.config.inventory.order;
    const result: string[] = [];
    for (const id of order) if (owned.includes(id) && this.isQuickUsable(id)) result.push(id);
    for (const id of owned) if (!result.includes(id) && this.isQuickUsable(id)) result.push(id);
    return result;
  }

  private isQuickUsable(id: string): boolean {
    const def = this.tk.items.get(id);
    return !!def && def.quickUse && this.isAbilityEnabled(id);
  }

  cycle(direction: 1 | -1): string | null {
    // The item on the second button stays there.
    const list = this.quickItems().filter((id) => id !== this.inv.secondItem);
    if (list.length === 0) {
      this.equip(null);
      return null;
    }
    const idx = this.inv.activeItem ? list.indexOf(this.inv.activeItem) : -1;
    const next = list[(idx + direction + list.length) % list.length];
    this.equip(next);
    return next;
  }

  isAbilityEnabled(id: string): boolean {
    return this.tk.state.abilities[id] !== false;
  }

  setAbility(id: string, enabled: boolean): void {
    if (enabled) delete this.tk.state.abilities[id];
    else this.tk.state.abilities[id] = false;
    this.tk.bus.emit("zelda:ability:changed", { ability: id, enabled });
    if (!enabled) this.unassign(id);
  }

  displayName(id: string): string {
    const def = this.tk.items.get(id);
    if (def?.name) return this.tk.i18n.text(def.name, id);
    const key = `item.${id}.name`;
    return this.tk.i18n.has(key) ? this.tk.i18n.t(key) : id;
  }

  displayDescription(id: string): string {
    const def = this.tk.items.get(id);
    if (def?.description) return this.tk.i18n.text(def.description, "");
    const key = `item.${id}.desc`;
    return this.tk.i18n.has(key) ? this.tk.i18n.t(key) : "";
  }

  private setCount(id: string, value: number): void {
    const max = this.capacity(id);
    const v = Math.max(0, Math.min(max, Math.round(value)));
    this.inv.counts[id] = v;
    this.tk.bus.emit("zelda:resource:changed", { resource: id, value: v, max });
  }

  private addOwned(id: string): boolean {
    if (this.inv.owned.includes(id)) return false;
    this.inv.owned.push(id);
    // A new usable item goes on a free item button (the first, else the second).
    if (this.tk.config.inventory.autoEquipFirst && this.isQuickUsable(id)) {
      if (this.inv.activeItem === null) this.equip(id);
      else if (this.inv.secondItem === null && this.tk.config.inventory.autoEquipSecond) this.assign(2, id);
    }
    return true;
  }
}
